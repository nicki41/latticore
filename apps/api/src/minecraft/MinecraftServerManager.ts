import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import type { Readable } from "node:stream";
import type { PrismaClient, Server } from "@prisma/client";
import type { ServerSoftware, ServerStatus } from "@minecraftpanel/shared";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { getDirectorySize } from "../lib/fsUtils.js";
import { stripAnsi } from "../lib/ansi.js";
import { BadRequestError, ConflictError, NotFoundError } from "../lib/errors.js";
import { getProvider, type MinecraftServerProvider } from "./providers/index.js";
import {
  CONTAINER_RCON_PORT,
  DockerMinecraftRuntime,
  type ContainerStats,
  type CreateContainerOptions,
} from "./runtime/DockerMinecraftRuntime.js";
import { RconClient } from "./runtime/RconClient.js";
import { deriveRconPassword } from "./runtime/rconSecret.js";
import { AttachConsoleSession } from "./runtime/AttachConsoleSession.js";
import { ServerInstaller, type InstallerRuntime } from "./install/ServerInstaller.js";
import { ServerConfigService } from "../modules/serverConfig/serverConfig.service.js";
import type Docker from "dockerode";
import type { Readable as NodeReadable } from "node:stream";

/** Minecraft's own boot-complete line — printed by the same underlying vanilla DedicatedServer sequence Paper/Fabric/Forge/NeoForge all wrap, so one regex covers all five software types. Always English regardless of locale/motd, since the server console isn't localized. */
const READY_LINE = /Done \([\d.,]+s\)! For help, type "help"/;

/**
 * Statuses owned by an in-flight lifecycle operation. reconcile() never
 * touches these (it would race the operation itself), which is exactly why
 * every operation below settles its own status on failure, and why
 * recoverInterruptedOperations() exists for the one case no operation can
 * clean up after itself: the panel process restarting mid-operation.
 */
const TRANSITIONAL_STATUSES: readonly ServerStatus[] = ["CREATING", "INSTALLING", "STARTING", "STOPPING", "DELETING"];

/** The subset of DockerMinecraftRuntime that MinecraftServerManager depends on — extracted so tests can inject a fake without touching a real Docker daemon. */
export interface MinecraftRuntime extends InstallerRuntime {
  createContainer(options: CreateContainerOptions): Promise<string>;
  start(containerId: string): Promise<void>;
  stop(containerId: string, timeoutSeconds?: number): Promise<void>;
  restart(containerId: string, timeoutSeconds?: number): Promise<void>;
  remove(containerId: string, force?: boolean): Promise<void>;
  inspect(containerId: string): Promise<Docker.ContainerInspectInfo | null>;
  getStats(containerId: string): Promise<ContainerStats | null>;
  getLogStream(containerId: string, options?: { tail?: number; since?: number }): Promise<NodeReadable>;
  /** One-shot (non-following) log read — `since` is a Unix timestamp in seconds. */
  readLogs(containerId: string, options?: { tail?: number; since?: number }): Promise<string>;
  getContainer(containerId: string): Docker.Container;
}

export interface CreateServerInput {
  name: string;
  description?: string;
  software: ServerSoftware;
  mcVersion: string;
  memoryMb: number;
  cpuCores: number;
  diskLimitMb?: number;
  port?: number;
  /** Must be true — enforced by createServerSchema (z.literal(true)) before this ever reaches here; re-checked defensively below. */
  eulaAccepted: boolean;
}

export interface ReinstallServerInput {
  /** Switch to a different Minecraft version of the same software — omitted means "same version, latest build" (e.g. a newer Paper build or Forge loader). */
  mcVersion?: string;
}

export interface UpdateServerSettingsInput {
  name?: string;
  description?: string | null;
  memoryMb?: number;
  cpuCores?: number;
  diskLimitMb?: number | null;
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return slug || "server";
}

function generateContainerName(serverName: string): string {
  return `mcpanel-${slugify(serverName)}-${crypto.randomBytes(4).toString("hex")}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface MinecraftServerManager {
  on(event: "status", listener: (serverId: string, status: ServerStatus) => void): this;
  emit(event: "status", serverId: string, status: ServerStatus): boolean;
}

/**
 * Owns the full server lifecycle (create/install/start/stop/restart/
 * delete), port allocation, and status reconciliation against Docker's
 * actual state. Talks to Docker exclusively through DockerMinecraftRuntime
 * and to version metadata exclusively through the provider registry —
 * nothing else in the app touches either directly.
 */
export class MinecraftServerManager extends EventEmitter {
  private readonly runtime: MinecraftRuntime;
  private readonly configService = new ServerConfigService();
  private readonly installer: ServerInstaller;
  /** One AttachConsoleSession per PANEL_MANAGED server currently known about — see getOrCreateAttachSession(). */
  private readonly attachSessions = new Map<string, AttachConsoleSession>();
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    runtime: MinecraftRuntime = new DockerMinecraftRuntime(),
  ) {
    super();
    this.runtime = runtime;
    this.installer = new ServerInstaller(runtime);
  }

  startReconciler(intervalMs = 5000): void {
    if (this.reconcileTimer) return;
    this.reconcileTimer = setInterval(() => {
      this.reconcile().catch((err) => logger.error({ err }, "Server status reconcile failed"));
    }, intervalMs);
    this.reconcileTimer.unref?.();
  }

  stopReconciler(): void {
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    this.reconcileTimer = null;
  }

  async listVersions(software: ServerSoftware) {
    return getProvider(software).listVersions();
  }

  async createServer(input: CreateServerInput): Promise<Server> {
    // Defensive re-check: createServerSchema already requires this to be the
    // literal `true`, but createServer() is a public method other code could
    // call directly, so never fall back to "accepted" here either.
    if (input.eulaAccepted !== true) {
      throw new BadRequestError("The Minecraft EULA must be explicitly accepted to create a server.");
    }

    const provider = getProvider(input.software);
    const versions = await provider.listVersions();
    if (!versions.some((v) => v.id === input.mcVersion)) {
      throw new BadRequestError(`Unknown ${input.software} version: ${input.mcVersion}`);
    }

    const port = input.port ?? (await this.allocateFreePort());
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new BadRequestError("Port must be an integer between 1 and 65535.");
    }
    const conflict = await this.findPortConflict(port);
    if (conflict) throw new ConflictError(conflict);

    const server = await this.prisma.server.create({
      data: {
        name: input.name,
        description: input.description,
        software: input.software,
        mcVersion: input.mcVersion,
        runtime: "PANEL_MANAGED",
        containerName: generateContainerName(input.name),
        port,
        memoryMb: input.memoryMb,
        cpuCores: input.cpuCores,
        diskLimitMb: input.diskLimitMb,
        status: "CREATING",
        dataDir: "servers/pending", // replaced immediately below once we know the id
        eulaAccepted: true,
      },
    });

    const dataDir = `servers/${server.id}`;
    await this.prisma.server.update({ where: { id: server.id }, data: { dataDir } });
    await fs.mkdir(this.absoluteDataPath(dataDir), { recursive: true });

    this.provisionInBackground(server.id, provider).catch((err) => this.handleProvisioningFailure(server.id, err));

    return { ...server, dataDir };
  }

  /**
   * Recreates the container from the current DB row before starting it (see
   * restartServer() for why), so Start after a Settings change applies the
   * new RAM/CPU limits and port allocations instead of booting the stale
   * container. Idempotent: starting a server that's already running or
   * already booting is a no-op, not an error — a scheduled "Start" step on
   * an already-running server must not wedge it in STARTING.
   */
  async startServer(serverId: string): Promise<void> {
    const server = await this.requireServer(serverId);
    if (!server.containerId) throw new ConflictError("Server has no container yet.");
    if (server.status === "RUNNING" || server.status === "STARTING") return;
    this.assertNotBusy(server, "start");

    await this.updateStatus(serverId, "STARTING");
    let containerId: string;
    try {
      containerId = await this.recreateContainer(server);
      await this.runtime.start(containerId);
    } catch (err) {
      await this.settleAfterFailure(serverId, "Failed to start the server", err);
      throw err;
    }
    this.watchBoot(serverId, server.runtime, containerId);
  }

  async stopServer(serverId: string): Promise<void> {
    const server = await this.requireServer(serverId);
    if (!server.containerId) throw new ConflictError("Server has no container yet.");
    if (server.status === "STOPPED") return;
    this.assertNotBusy(server, "stop", ["STARTING"]);

    await this.updateStatus(serverId, "STOPPING");
    try {
      await this.runtime.stop(server.containerId);
    } catch (err) {
      await this.settleAfterFailure(serverId, "Failed to stop the server", err);
      throw err;
    }
    await this.updateStatus(serverId, "STOPPED");
  }

  /**
   * Always recreates the container (stop + remove + create + start) rather
   * than a plain `docker restart` — Docker freezes a container's env vars
   * and HostConfig (memory/CPU limits) at creation time, so a plain restart
   * would silently keep serving the OLD resource limits even after the DB
   * row (and thus Settings → Resources) says otherwise. Recreating with the
   * *current* DB values on every restart is what makes "Restart" actually
   * mean "apply my latest settings" — the bind-mounted data directory (and
   * therefore server.properties, worlds, plugins, etc.) is untouched either
   * way, since none of that lives in the container's own writable layer.
   */
  async restartServer(serverId: string): Promise<void> {
    const server = await this.requireServer(serverId);
    if (!server.containerId) throw new ConflictError("Server has no container yet.");
    this.assertNotBusy(server, "restart", ["STARTING"]);

    await this.updateStatus(serverId, "STOPPING");
    let containerId: string;
    try {
      containerId = await this.recreateContainer(server);
      await this.updateStatus(serverId, "STARTING");
      await this.runtime.start(containerId);
    } catch (err) {
      await this.settleAfterFailure(serverId, "Failed to restart the server", err);
      throw err;
    }
    this.watchBoot(serverId, server.runtime, containerId);
  }

  /**
   * Re-runs the install pipeline in place — same software, either the same
   * Minecraft version (picking up the newest build/loader, e.g. after an
   * "update available" notification) or a different one. World data,
   * configs, and plugins/mods in the data directory are left untouched; only
   * the server jar/libraries and launch script are replaced. Also the
   * recovery path for an install that failed or was interrupted.
   */
  async reinstallServer(serverId: string, input: ReinstallServerInput = {}): Promise<void> {
    const server = await this.requireServer(serverId);
    if (server.runtime !== "PANEL_MANAGED") {
      throw new ConflictError("Legacy servers can't be reinstalled — create a new server instead.");
    }
    if (server.status !== "STOPPED" && server.status !== "ERROR") {
      throw new ConflictError("Stop the server before reinstalling it.");
    }

    const provider = getProvider(server.software as ServerSoftware);
    const mcVersion = input.mcVersion ?? server.mcVersion;
    if (mcVersion !== server.mcVersion) {
      const versions = await provider.listVersions();
      if (!versions.some((v) => v.id === mcVersion)) {
        throw new BadRequestError(`Unknown ${server.software} version: ${mcVersion}`);
      }
    }

    this.closeAttachSession(serverId);
    if (server.containerId) await this.runtime.remove(server.containerId, true);
    await this.prisma.server.update({ where: { id: serverId }, data: { containerId: null, mcVersion } });
    await this.updateStatus(serverId, "INSTALLING");

    this.provisionInBackground(serverId, provider).catch((err) => this.handleProvisioningFailure(serverId, err));
  }

  /**
   * Called once at boot: an operation that was in flight when the panel
   * process last stopped (update, crash, host reboot) left its server in a
   * transitional status that reconcile() deliberately never touches. Settle
   * each one against what Docker reports now — or, for a server that was
   * still booting, resume watching for its ready line.
   */
  async recoverInterruptedOperations(): Promise<void> {
    const stuck = await this.prisma.server.findMany({ where: { status: { in: [...TRANSITIONAL_STATUSES] } } });

    for (const server of stuck) {
      try {
        const info = server.containerId ? await this.runtime.inspect(server.containerId) : null;

        if (info?.State.Running) {
          if (server.status === "STARTING" && !(await this.hasBootedSince(server, info))) {
            this.watchBoot(server.id, server.runtime, server.containerId!);
          } else {
            await this.updateStatus(server.id, "RUNNING");
          }
        } else if (info && server.status !== "CREATING" && server.status !== "INSTALLING") {
          await this.updateStatus(server.id, "STOPPED");
        } else {
          const detail =
            server.status === "DELETING"
              ? "Deletion was interrupted by a panel restart — delete the server again."
              : "Installation was interrupted by a panel restart — use Reinstall to try again.";
          await this.updateStatus(server.id, "ERROR", { statusDetail: detail });
        }
        logger.info({ serverId: server.id, previousStatus: server.status }, "Recovered server from an interrupted operation");
      } catch (err) {
        logger.error({ err, serverId: server.id }, "Failed to recover server from an interrupted operation");
      }
    }
  }

  /**
   * Null if `port` is free instance-wide, otherwise a human-readable reason.
   * Docker can bind each host port only once, no matter whether it's some
   * server's primary game port or an extra allocation — so both tables are
   * checked, always. Deliberately never names the other server: the caller
   * may not have access to it.
   */
  async findPortConflict(port: number, options: { serverId?: string } = {}): Promise<string | null> {
    const primary = await this.prisma.server.findUnique({ where: { port }, select: { id: true } });
    if (primary) {
      return primary.id === options.serverId
        ? `Port ${port} is already this server's primary port.`
        : `Port ${port} is already used by another server.`;
    }
    const allocation = await this.prisma.serverAllocation.findUnique({ where: { port }, select: { serverId: true } });
    if (allocation) {
      return allocation.serverId === options.serverId
        ? `Port ${port} is already allocated to this server.`
        : `Port ${port} is already allocated to another server.`;
    }
    return null;
  }

  /** Returns the new container's id (also persisted on the row). */
  private async recreateContainer(server: Server): Promise<string> {
    this.closeAttachSession(server.id); // bound to the old container — a fresh one gets created against the new containerId on next use

    // Graceful stop before the force-remove below — force-removing a
    // running container skips straight to SIGKILL, giving the Minecraft
    // process no chance to save. runtime.stop() sends SIGTERM and waits
    // (see its own comment for why the timeout is as long as it is), so
    // by the time remove() runs the process has normally already exited.
    await this.runtime.stop(server.containerId!);

    const extraPorts = (await this.prisma.serverAllocation.findMany({ where: { serverId: server.id } })).map((a) => a.port);

    if (server.runtime === "PANEL_MANAGED") {
      // Reuse exactly what was installed — an ordinary Restart must never
      // silently roll the server onto a different build (unlike legacy
      // Paper/Fabric, which re-resolve "latest" via the image on every
      // recreate). The launch script IS regenerated, though: it bakes in
      // -Xms/-Xmx from memoryMb, which Settings → Resources may have just
      // changed, and that must take effect on Restart same as it always
      // has for the legacy path's MEMORY env var.
      if (!server.javaImageTag) throw new ConflictError("Server has no installed runtime image to restart with.");
      await this.installer.refreshLaunchScript(server);

      await this.runtime.remove(server.containerId!, true);
      const containerId = await this.runtime.createContainer({
        serverId: server.id,
        containerName: server.containerName,
        runtime: "PANEL_MANAGED",
        mcVersion: server.mcVersion,
        hostPort: server.port,
        extraPorts,
        memoryMb: server.memoryMb,
        cpuCores: server.cpuCores,
        eulaAccepted: server.eulaAccepted,
        javaImageTag: server.javaImageTag,
      });
      await this.prisma.server.update({ where: { id: server.id }, data: { containerId } });
      return containerId;
    }

    const provider = getProvider(server.software as ServerSoftware);
    const softwareEnv = await provider.resolveEnv(server.mcVersion);
    const rconPassword = deriveRconPassword(server.id);

    await this.runtime.remove(server.containerId!, true);
    const containerId = await this.runtime.createContainer({
      serverId: server.id,
      containerName: server.containerName,
      runtime: "LEGACY",
      softwareEnv,
      mcVersion: server.mcVersion,
      hostPort: server.port,
      extraPorts,
      memoryMb: server.memoryMb,
      cpuCores: server.cpuCores,
      rconPassword,
      eulaAccepted: server.eulaAccepted,
    });
    await this.prisma.server.update({ where: { id: server.id }, data: { containerId } });
    return containerId;
  }

  async deleteServer(serverId: string, options: { keepFiles?: boolean } = {}): Promise<void> {
    const server = await this.requireServer(serverId);
    await this.updateStatus(serverId, "DELETING");
    this.closeAttachSession(serverId);

    if (server.containerId) {
      try {
        await this.runtime.remove(server.containerId, true);
      } catch (err) {
        await this.settleAfterFailure(serverId, "Failed to delete the server's container", err);
        throw err;
      }
    }
    if (!options.keepFiles) {
      await fs.rm(this.absoluteDataPath(server.dataDir), { recursive: true, force: true }).catch((err) => {
        logger.warn({ err, serverId }, "Failed to remove server data directory");
      });
    }
    await this.prisma.server.delete({ where: { id: serverId } });
  }

  async updateSettings(serverId: string, input: UpdateServerSettingsInput): Promise<Server> {
    const server = await this.requireServer(serverId);
    const updated = await this.prisma.server.update({ where: { id: serverId }, data: input });

    // Resource limits are baked into the container at creation time; they
    // only take effect once restartServer() recreates the container with
    // these new values. That's communicated in the UI (the restart-required
    // dialog) rather than force-restarting a running server out from under
    // players.
    if (server.memoryMb !== updated.memoryMb || server.cpuCores !== updated.cpuCores) {
      logger.info({ serverId }, "Resource limits changed; will apply on next restart");
    }
    return updated;
  }

  async getStats(serverId: string): Promise<ContainerStats | null> {
    const server = await this.requireServer(serverId);
    if (!server.containerId) return null;
    return this.runtime.getStats(server.containerId);
  }

  async getDiskUsageBytes(serverId: string): Promise<number> {
    const server = await this.requireServer(serverId);
    return getDirectorySize(this.absoluteDataPath(server.dataDir));
  }

  async getLogStream(serverId: string, options: { tail?: number } = {}): Promise<Readable> {
    const server = await this.requireServer(serverId);
    if (!server.containerId) throw new ConflictError("Server has no container yet.");

    if (server.runtime === "PANEL_MANAGED") {
      const session = this.getOrCreateAttachSession(server.id, server.containerId);
      await session.open();
      return this.attachToReadable(session, options.tail);
    }

    return this.runtime.getLogStream(server.containerId, options);
  }

  createRconClient(server: Pick<Server, "id" | "containerName">): RconClient {
    return new RconClient(server.containerName, CONTAINER_RCON_PORT, deriveRconPassword(server.id));
  }

  /** Best-effort: not every command needs a reply the caller cares about (e.g. console input echoed from the UI). */
  /**
   * `silent` (PANEL_MANAGED only — RCON never touched the visible console
   * either way): pass true for commands the panel issues for its own
   * bookkeeping (periodic `list` polling, moderation actions triggered from
   * the UI) rather than something a human typed into the Console tab, so it
   * doesn't spam the live feed. Defaults to false — visible — matching a
   * user-typed command's existing echo+response behavior.
   */
  async sendCommand(serverId: string, command: string, options: { silent?: boolean; timeoutMs?: number; waitFor?: RegExp } = {}): Promise<string> {
    const server = await this.requireServer(serverId);
    if (server.status !== "RUNNING") throw new ConflictError("Server is not running.");

    if (server.runtime === "PANEL_MANAGED") {
      if (!server.containerId) throw new ConflictError("Server has no container yet.");
      const session = this.getOrCreateAttachSession(server.id, server.containerId);
      await session.open();
      return session.sendCommand(command, { silent: options.silent, timeoutMs: options.timeoutMs, waitFor: options.waitFor });
    }

    const rcon = this.createRconClient(server);
    try {
      return await rcon.send(command);
    } finally {
      rcon.disconnect();
    }
  }

  /** Adapts an AttachConsoleSession's line feed (backlog + live) into a plain Readable, matching the shape DockerMinecraftRuntime.getLogStream() returns for LEGACY — so ServerLiveSession/PlayerActivityTracker don't need to know which runtime kind they're reading from. */
  private attachToReadable(session: AttachConsoleSession, tail?: number): Readable {
    const pass = new PassThrough();
    const backlog = session.getBacklog();
    for (const line of tail !== undefined ? backlog.slice(-tail) : backlog) {
      pass.write(`${line.text}\n`);
    }
    const unsubscribe = session.onLine((line) => {
      if (!pass.destroyed) pass.write(`${line.text}\n`);
    });
    pass.once("close", unsubscribe);
    return pass;
  }

  /** Re-derives the resolveEnv() the running container was actually created with — used by installers/plugin logic that need to know the loader family. */
  async resolveProviderEnv(server: Pick<Server, "software" | "mcVersion">): Promise<Record<string, string>> {
    return getProvider(server.software as ServerSoftware).resolveEnv(server.mcVersion);
  }

  /** Periodic safety net: reconciles DB status against real Docker state (crashes, OOM kills, manual `docker stop`, etc.). */
  async reconcile(): Promise<void> {
    const servers = await this.prisma.server.findMany({
      where: { containerId: { not: null }, status: { notIn: [...TRANSITIONAL_STATUSES] } },
    });

    for (const server of servers) {
      try {
        const info = await this.runtime.inspect(server.containerId!);
        const next = mapDockerStateToStatus(info, server.status as ServerStatus);
        if (next && next !== server.status) {
          await this.updateStatus(server.id, next, next === "ERROR" ? { statusDetail: info?.State.Error || undefined } : {});
        }
      } catch (err) {
        logger.error({ err, serverId: server.id }, "Failed to reconcile server status");
      }
    }
  }

  private async provisionInBackground(serverId: string, provider: MinecraftServerProvider): Promise<void> {
    const server = await this.prisma.server.findUniqueOrThrow({ where: { id: serverId } });
    if (!server.eulaAccepted) {
      await this.updateStatus(serverId, "ERROR", { statusDetail: "Minecraft EULA was not accepted; the server was not provisioned." });
      return;
    }
    // Owns server.properties from the very start: written before the
    // container ever boots, and — since createContainer() no longer passes
    // any of the corresponding env vars — never touched by the image
    // itself afterward. See the note in DockerMinecraftRuntime.createContainer().
    // (mkdir first: a reinstall may run against a data dir someone emptied by hand.)
    await fs.mkdir(this.absoluteDataPath(server.dataDir), { recursive: true });
    await this.configService.createWithDefaults(server, "server-properties");

    const extraPorts = (await this.prisma.serverAllocation.findMany({ where: { serverId: server.id } })).map((a) => a.port);

    if (server.runtime === "PANEL_MANAGED") {
      // INSTALLING covers the actual download/verify (or, for Forge/NeoForge,
      // the ephemeral installer container) — set BEFORE that work starts,
      // since it's real, panel-observed work instead of a label slapped on
      // "container exists, itzg is doing who-knows-what."
      await this.updateStatus(serverId, "INSTALLING");
      const plan = await provider.resolveInstallPlan(server.mcVersion);
      const result = await this.installer.install(server, plan);
      await this.prisma.server.update({
        where: { id: serverId },
        data: { buildVersion: result.buildVersion, javaImageTag: result.javaImageTag, installManifest: result.installManifest },
      });

      const containerId = await this.runtime.createContainer({
        serverId: server.id,
        containerName: server.containerName,
        runtime: "PANEL_MANAGED",
        mcVersion: server.mcVersion,
        hostPort: server.port,
        extraPorts,
        memoryMb: server.memoryMb,
        cpuCores: server.cpuCores,
        eulaAccepted: server.eulaAccepted,
        javaImageTag: result.javaImageTag,
      });

      await this.updateStatus(serverId, "STARTING", { containerId });
      await this.runtime.start(containerId);
      await this.waitUntilReady(server, containerId, 15 * 60 * 1000); // modded servers can take a while to install
      return;
    }

    const softwareEnv = await provider.resolveEnv(server.mcVersion);
    const rconPassword = deriveRconPassword(server.id);

    const containerId = await this.runtime.createContainer({
      serverId: server.id,
      containerName: server.containerName,
      runtime: "LEGACY",
      softwareEnv,
      mcVersion: server.mcVersion,
      hostPort: server.port,
      extraPorts,
      memoryMb: server.memoryMb,
      cpuCores: server.cpuCores,
      rconPassword,
      eulaAccepted: server.eulaAccepted,
    });

    await this.updateStatus(serverId, "INSTALLING", { containerId });
    await this.runtime.start(containerId);
    await this.waitUntilRunningOrFailed(serverId, containerId, 15 * 60 * 1000); // modded servers can take a while to install
  }

  /** Picks the right "wait for ready" strategy per runtime kind — PANEL_MANAGED watches the console for Minecraft's own ready line (accurate); LEGACY falls back to polling Docker's coarse State.Running (all it's ever had, unchanged). */
  private waitUntilReady(server: Pick<Server, "id" | "runtime">, containerId: string, timeoutMs = 5 * 60 * 1000): Promise<void> {
    return server.runtime === "PANEL_MANAGED"
      ? this.waitForReadyLine(server.id, containerId, timeoutMs)
      : this.waitUntilRunningOrFailed(server.id, containerId, timeoutMs);
  }

  /** Fire-and-forget waitUntilReady() for a container that's already been started. */
  private watchBoot(serverId: string, runtime: string, containerId: string): void {
    this.waitUntilReady({ id: serverId, runtime }, containerId).catch((err) => logger.error({ err, serverId }, "Post-start reconcile failed"));
  }

  /** Whether a running PANEL_MANAGED container already printed its ready line since it last started — LEGACY has no ready line, so "running" is all it ever gets. */
  private async hasBootedSince(server: Pick<Server, "runtime" | "containerId">, info: Docker.ContainerInspectInfo): Promise<boolean> {
    if (server.runtime !== "PANEL_MANAGED") return true;
    const startedAtSeconds = Math.floor(Date.parse(info.State.StartedAt) / 1000);
    const logs = await this.runtime.readLogs(server.containerId!, Number.isFinite(startedAtSeconds) ? { since: startedAtSeconds } : {});
    return READY_LINE.test(stripAnsi(logs));
  }

  /** Rejects an operation while another one owns the server's status — `allowed` lists transitional statuses this particular operation may interrupt (e.g. stopping a server that's still booting). */
  private assertNotBusy(server: Pick<Server, "status">, action: string, allowed: readonly ServerStatus[] = []): void {
    const status = server.status as ServerStatus;
    if (TRANSITIONAL_STATUSES.includes(status) && !allowed.includes(status)) {
      throw new ConflictError(`Can't ${action} the server while it's ${status.toLowerCase()}.`);
    }
  }

  /** After a lifecycle operation failed midway, puts the status back in line with what Docker actually reports instead of leaving it parked in a transitional status reconcile() would never revisit. */
  private async settleAfterFailure(serverId: string, what: string, err: unknown): Promise<void> {
    logger.error({ err, serverId }, what);
    try {
      const server = await this.prisma.server.findUnique({ where: { id: serverId } });
      if (!server) return;
      const info = server.containerId ? await this.runtime.inspect(server.containerId).catch(() => null) : null;
      if (info?.State.Running) {
        await this.updateStatus(serverId, "RUNNING");
      } else {
        await this.updateStatus(serverId, "ERROR", { statusDetail: `${what}: ${describeError(err)}` });
      }
    } catch (settleErr) {
      logger.error({ err: settleErr, serverId }, "Failed to settle server status after a failed operation");
    }
  }

  private handleProvisioningFailure(serverId: string, err: unknown): void {
    logger.error({ err, serverId }, "Server provisioning failed");
    this.updateStatus(serverId, "ERROR", { statusDetail: `Installation failed: ${describeError(err)}` }).catch(() => {});
  }

  private async waitForReadyLine(serverId: string, containerId: string, timeoutMs: number): Promise<void> {
    const session = this.getOrCreateAttachSession(serverId, containerId);
    try {
      await session.open();
    } catch (err) {
      logger.error({ err, serverId }, "Failed to open console attach session");
      await this.updateStatus(serverId, "ERROR", { statusDetail: "Failed to open a console connection to the container." });
      return;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      let unsubscribeLine = () => {};
      let unsubscribeClose = () => {};

      const finish = (fn: () => Promise<void>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribeLine();
        unsubscribeClose();
        fn()
          .catch((err) => logger.error({ err, serverId }, "Failed to update status after waitForReadyLine"))
          .finally(resolve);
      };

      const timer = setTimeout(() => {
        finish(() => this.updateStatus(serverId, "ERROR", { statusDetail: "Timed out waiting for the server to become ready." }));
      }, timeoutMs);

      unsubscribeLine = session.onLine((line) => {
        if (READY_LINE.test(stripAnsi(line.text))) {
          finish(() => this.updateStatus(serverId, "RUNNING"));
        }
      });

      unsubscribeClose = session.onClose(() => {
        finish(async () => {
          const info = await this.runtime.inspect(containerId);
          const exitCode = info?.State.ExitCode;
          const detail = exitCode ? `Container exited with code ${exitCode}.` : null;
          await this.updateStatus(serverId, detail ? "ERROR" : "STOPPED", { statusDetail: detail });
        });
      });
    });
  }

  private getOrCreateAttachSession(serverId: string, containerId: string): AttachConsoleSession {
    let session = this.attachSessions.get(serverId);
    if (!session) {
      session = new AttachConsoleSession(this.runtime.getContainer(containerId));
      this.attachSessions.set(serverId, session);
    }
    return session;
  }

  private closeAttachSession(serverId: string): void {
    const session = this.attachSessions.get(serverId);
    if (!session) return;
    this.attachSessions.delete(serverId);
    session.close();
  }

  private async waitUntilRunningOrFailed(serverId: string, containerId: string, timeoutMs = 5 * 60 * 1000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const info = await this.runtime.inspect(containerId);
      if (!info) {
        await this.updateStatus(serverId, "ERROR", { statusDetail: "Container disappeared while starting." });
        return;
      }
      if (info.State.Running) {
        await this.updateStatus(serverId, "RUNNING");
        return;
      }
      if (info.State.Status === "exited") {
        const detail = info.State.ExitCode === 0 ? null : `Container exited with code ${info.State.ExitCode}.`;
        await this.updateStatus(serverId, detail ? "ERROR" : "STOPPED", { statusDetail: detail });
        return;
      }
      await sleep(2000);
    }
    await this.updateStatus(serverId, "ERROR", { statusDetail: "Timed out waiting for the server to become ready." });
  }

  private async updateStatus(
    serverId: string,
    status: ServerStatus,
    extra: { containerId?: string; statusDetail?: string | null } = {},
  ): Promise<void> {
    await this.prisma.server.update({
      where: { id: serverId },
      data: {
        status,
        statusDetail: extra.statusDetail !== undefined ? extra.statusDetail : status === "ERROR" ? undefined : null,
        ...(extra.containerId ? { containerId: extra.containerId } : {}),
      },
    });
    this.emit("status", serverId, status);
  }

  /** Lowest port in MC_PORT_RANGE_MIN..MAX that's neither a primary port nor an extra allocation anywhere — see findPortConflict(). */
  private async allocateFreePort(): Promise<number> {
    const [servers, allocations] = await Promise.all([
      this.prisma.server.findMany({ select: { port: true } }),
      this.prisma.serverAllocation.findMany({ select: { port: true } }),
    ]);
    const used = new Set([...servers, ...allocations].map((row) => row.port));
    for (let port = env.MC_PORT_RANGE_MIN; port <= env.MC_PORT_RANGE_MAX; port++) {
      if (!used.has(port)) return port;
    }
    throw new ConflictError("No free ports left in the configured MC_PORT_RANGE_MIN..MC_PORT_RANGE_MAX range.");
  }

  private async requireServer(serverId: string): Promise<Server> {
    const server = await this.prisma.server.findUnique({ where: { id: serverId } });
    if (!server) throw new NotFoundError("Server not found.");
    return server;
  }

  private absoluteDataPath(relativeDataDir: string): string {
    return path.join(env.DATA_PATH, relativeDataDir);
  }
}

/** A short, user-presentable reason for statusDetail — Docker/installer errors carry useful text (e.g. "port is already allocated"), but keep it to one line of reasonable length. */
function describeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const oneLine = message.replace(/\s+/g, " ").trim();
  return oneLine.length > 300 ? `${oneLine.slice(0, 297)}...` : oneLine || "unknown error";
}

function mapDockerStateToStatus(
  info: Awaited<ReturnType<DockerMinecraftRuntime["inspect"]>>,
  current: ServerStatus,
): ServerStatus | null {
  if (!info) return "ERROR";
  if (info.State.Running) return current === "RUNNING" ? null : "RUNNING";
  if (info.State.Status === "exited") {
    // A server already marked STOPPED got there via an explicit user
    // action (stopServer/restartServer), which decides that status itself
    // once runtime.stop()/remove() resolves. Don't second-guess it here
    // based on the exit code alone — a slow graceful shutdown that blew
    // past the stop timeout and got SIGKILLed still exits non-zero, but
    // that's "stopped, the hard way," not a crash. ERROR is for a server
    // that dies unexpectedly while nothing asked it to stop.
    if (current === "STOPPED") return null;
    return info.State.ExitCode === 0 ? "STOPPED" : "ERROR";
  }
  return null;
}
