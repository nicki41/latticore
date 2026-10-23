import type { Readable } from "node:stream";
import Docker from "dockerode";
import type { ServerRuntime } from "@minecraftpanel/shared";
import { env } from "../../config/env.js";
import { resolveHostDataPath } from "../../config/hostDataPath.js";
import { logger } from "../../lib/logger.js";

export const CONTAINER_GAME_PORT = 25565;
export const CONTAINER_RCON_PORT = 25575;
const CONTAINER_PREFIX = "mcpanel-";

export interface CreateContainerOptions {
  serverId: string;
  containerName: string;
  runtime: ServerRuntime;
  mcVersion: string;
  hostPort: number;
  /** Extra ports published 1:1 (host==container, tcp+udp) alongside hostPort — see ServerAllocation. */
  extraPorts?: number[];
  memoryMb: number;
  cpuCores: number;
  /** Must be true — the caller (MinecraftServerManager) is responsible for only ever passing the user's actual, explicit consent through here. */
  eulaAccepted: boolean;
  /** LEGACY only — from MinecraftServerProvider#resolveEnv(): TYPE plus any loader/build pin. */
  softwareEnv?: Record<string, string>;
  /** LEGACY only. */
  rconPassword?: string;
  /** PANEL_MANAGED only — resolved by ServerInstaller via runtimeImages.resolveRuntimeImageTag(). */
  javaImageTag?: string;
}

export interface RunInstallerOptions {
  serverId: string;
  /** Distinct from the server's own long-lived container name — both may briefly coexist during a reinstall. */
  containerName: string;
  javaImageTag: string;
  memoryMb: number;
  /** Everything after `java` on the command line; runs with /data (the server's data dir) as its working directory. */
  javaArgs: string[];
  timeoutMs: number;
}

export interface InstallerRunResult {
  exitCode: number;
  /** Tail of the installer's combined stdout/stderr, for error reporting. */
  output: string;
}

export interface ContainerStats {
  cpuPercent: number;
  memoryUsageBytes: number;
  memoryLimitBytes: number;
  /** Cumulative bytes received/sent since the container started, summed across every network interface. */
  networkRxBytes: number;
  networkTxBytes: number;
  startedAt: string | null;
}

export class DockerMinecraftRuntime {
  private readonly docker: Docker;

  constructor() {
    this.docker = new Docker({ socketPath: env.DOCKER_SOCKET_PATH });
  }

  static containerNameFor(serverId: string): string {
    return `${CONTAINER_PREFIX}${serverId}`;
  }

  async ensureNetwork(): Promise<void> {
    const networks = await this.docker.listNetworks({ filters: JSON.stringify({ name: [env.MINECRAFT_NETWORK] }) });
    if (networks.some((n) => n.Name === env.MINECRAFT_NETWORK)) return;
    await this.docker.createNetwork({ Name: env.MINECRAFT_NETWORK, Driver: "bridge", CheckDuplicate: true });
    logger.info({ network: env.MINECRAFT_NETWORK }, "Created Minecraft Docker network");
  }

  /**
   * createContainer's Docker API call fails outright with "No such image"
   * if it isn't already present locally — unlike the `docker` CLI, the API
   * never pulls implicitly. First server creation on a fresh host would
   * otherwise always fail; this makes that a one-time, automatic wait
   * instead of a manual `docker pull` the user has to know to run.
   */
  async ensureImage(image: string): Promise<void> {
    try {
      await this.docker.getImage(image).inspect();
      return;
    } catch (err) {
      if (!isDockerStatus(err, 404)) throw err;
    }

    logger.info({ image }, "Minecraft server image not present locally — pulling (first use only)...");
    const stream = await this.docker.pull(image);
    await new Promise<void>((resolve, reject) => {
      this.docker.modem.followProgress(stream, (err: Error | null) => (err ? reject(err) : resolve()));
    });
    logger.info({ image }, "Image pull complete.");
  }

  /** Host-side path of a server's data dir, for bind mounts. Always forward-slash: it's interpreted by the Docker daemon (always Linux, even under Docker Desktop), never by the API process's own OS. */
  private async hostDataDirFor(serverId: string): Promise<string> {
    const hostDataPath = await resolveHostDataPath();
    return `${hostDataPath.replace(/\/+$/, "")}/servers/${serverId}`;
  }

  async createContainer(options: CreateContainerOptions): Promise<string> {
    await this.ensureNetwork();

    const hostDataDir = await this.hostDataDirFor(options.serverId);
    const extraPorts = options.extraPorts ?? [];
    const sharedHostConfig = {
      Memory: options.memoryMb * 1024 * 1024,
      MemorySwap: options.memoryMb * 1024 * 1024, // no swap beyond the memory limit
      NanoCpus: Math.round(options.cpuCores * 1e9),
      PidsLimit: 2048,
      RestartPolicy: { Name: "unless-stopped" },
      PortBindings: {
        [`${CONTAINER_GAME_PORT}/tcp`]: [{ HostPort: String(options.hostPort) }],
        ...extraPortBindings(extraPorts),
      },
      Binds: [`${hostDataDir}:/data`],
      LogConfig: { Type: "json-file", Config: { "max-size": "10m", "max-file": "3" } },
    };

    if (options.runtime === "PANEL_MANAGED") {
      const image = options.javaImageTag;
      if (!image) throw new Error("javaImageTag is required for a PANEL_MANAGED container.");
      await this.ensureImage(image);

      const container = await this.docker.createContainer({
        name: options.containerName,
        Image: image,
        // Only TZ (so log timestamps match the panel's timezone): eula.txt
        // and a fully-formed .mcpanel-launch.sh were already written onto
        // /data by ServerInstaller before this container was ever created —
        // see the entrypoint, which just verifies those exist and execs the
        // launch script.
        Env: [`TZ=${env.TZ}`],
        Tty: true,
        // Raw (non-multiplexed) attach for direct console access — no RCON
        // involved at all for this runtime kind. StdinOnce:false keeps
        // stdin open across multiple attach/detach cycles.
        OpenStdin: true,
        StdinOnce: false,
        AttachStdin: true,
        ExposedPorts: { [`${CONTAINER_GAME_PORT}/tcp`]: {}, ...extraExposedPorts(extraPorts) },
        HostConfig: {
          ...sharedHostConfig,
          // Unlike the itzg-based container: the panel creates /data itself
          // (already owned by uid 1000, matching this image's fixed
          // "mcserver" user — see runtime-images/*/Dockerfile), so there's
          // no root-at-boot chown/setuid step needed, and no elevated
          // capabilities to grant for one. This container never runs as
          // root at any point.
          CapDrop: ["ALL"],
          SecurityOpt: ["no-new-privileges:true"],
        },
        NetworkingConfig: { EndpointsConfig: { [env.MINECRAFT_NETWORK]: {} } },
        Labels: { "minecraftpanel.serverId": options.serverId },
      });
      return container.id;
    }

    await this.ensureImage(env.MINECRAFT_IMAGE);

    const envVars: Record<string, string> = {
      // Never default to accepted: absent explicit, validated consent this
      // must stay "FALSE" so the itzg image itself refuses to run the server.
      EULA: options.eulaAccepted ? "TRUE" : "FALSE",
      VERSION: options.mcVersion,
      MEMORY: `${options.memoryMb}M`,
      SERVER_PORT: String(CONTAINER_GAME_PORT),
      ENABLE_RCON: "true",
      RCON_PASSWORD: options.rconPassword ?? "",
      RCON_PORT: String(CONTAINER_RCON_PORT),
      UID: "1000",
      GID: "1000",
      TZ: env.TZ,
      // Deliberately no MOTD/MAX_PLAYERS/DIFFICULTY/MODE/ENABLE_WHITELIST/
      // ONLINE_MODE/PVP/VIEW_DISTANCE/SIMULATION_DISTANCE here: the itzg
      // image re-applies any of these that ARE set into server.properties
      // on *every* container start, which would silently stomp the panel's
      // own server.properties edits back to whatever these env vars were
      // frozen at when the container was created (env vars can't change
      // without recreating the container, but the file is meant to be
      // live-editable via Settings → Server Properties). The panel writes
      // server.properties directly instead — see
      // MinecraftServerManager.provisionInBackground() and
      // ServerConfigService.createWithDefaults().
      ...options.softwareEnv,
    };

    const container = await this.docker.createContainer({
      name: options.containerName,
      Image: env.MINECRAFT_IMAGE,
      Env: Object.entries(envVars).map(([k, v]) => `${k}=${v}`),
      // Raw (non-multiplexed) log/attach output and the interactive-console
      // mode the image documents itself for — see README for why we still
      // don't set OpenStdin (commands go through RCON instead).
      Tty: true,
      ExposedPorts: { [`${CONTAINER_GAME_PORT}/tcp`]: {}, ...extraExposedPorts(extraPorts) },
      HostConfig: {
        ...sharedHostConfig,
        // No CapDrop here (unlike the panel's own API container): the
        // itzg/docker-minecraft-server entrypoint starts as root and does
        // its own privilege drop to a "minecraft" user — chown'ing /data
        // and calling setuid()/setgid() — before the actual game process
        // ever runs. That needs CAP_CHOWN/CAP_SETUID/CAP_SETGID at minimum;
        // chasing this image's exact undocumented bootstrap requirements
        // capability-by-capability (found two so far just by testing) is
        // fragile and liable to break again on any image update, so this
        // relies on Docker's already-curated default capability set (far
        // narrower than the host's) instead. The end state is the same
        // either way — the long-running Minecraft process itself is
        // non-root — just via the image's own mechanism rather than ours.
        SecurityOpt: ["no-new-privileges:true"],
      },
      NetworkingConfig: { EndpointsConfig: { [env.MINECRAFT_NETWORK]: {} } },
      Labels: { "minecraftpanel.serverId": options.serverId },
    });

    return container.id;
  }

  async start(containerId: string): Promise<void> {
    try {
      await this.docker.getContainer(containerId).start();
    } catch (err) {
      if (!isDockerStatus(err, 304)) throw err; // 304 = already running
    }
  }

  // 90s, not Docker's 10s default: Paper's own shutdown sequence (chunk
  // system halt, chunk I/O halt, worker pool, I/O pool — see
  // ChunkHolderManager's log lines) reserves up to 60s per stage. A shorter
  // window means Docker SIGKILLs a server that's still mid-save, which then
  // reports a non-zero exit code even though the panel asked it to stop —
  // see mapDockerStateToStatus()'s handling of an already-STOPPED server.
  async stop(containerId: string, timeoutSeconds = 90): Promise<void> {
    try {
      await this.docker.getContainer(containerId).stop({ t: timeoutSeconds });
    } catch (err) {
      // 304 = already stopped, 404 = already gone (removed out-of-band) —
      // either way the goal "not running" is already met.
      if (!isDockerStatus(err, 304) && !isDockerStatus(err, 404)) throw err;
    }
  }

  async restart(containerId: string, timeoutSeconds = 90): Promise<void> {
    await this.docker.getContainer(containerId).restart({ t: timeoutSeconds });
  }

  async remove(containerId: string, force = true): Promise<void> {
    try {
      await this.docker.getContainer(containerId).remove({ force, v: true });
    } catch (err) {
      if (!isDockerStatus(err, 404)) throw err;
    }
  }

  async inspect(containerId: string): Promise<Docker.ContainerInspectInfo | null> {
    try {
      return await this.docker.getContainer(containerId).inspect();
    } catch (err) {
      if (isDockerStatus(err, 404)) return null;
      throw err;
    }
  }

  async getStats(containerId: string): Promise<ContainerStats | null> {
    try {
      const container = this.docker.getContainer(containerId);
      const [stats, info] = await Promise.all([container.stats({ stream: false }), container.inspect()]);
      return {
        ...computeStats(stats as unknown as DockerStatsPayload),
        startedAt: info.State.Running ? info.State.StartedAt : null,
      };
    } catch (err) {
      if (isDockerStatus(err, 404)) return null;
      throw err;
    }
  }

  /** Live-following log stream (raw text — container runs with Tty:true, so no demuxing needed). */
  getLogStream(containerId: string, options: { tail?: number; since?: number } = {}): Promise<Readable> {
    return this.docker.getContainer(containerId).logs({
      follow: true,
      stdout: true,
      stderr: true,
      tail: options.tail ?? 200,
      since: options.since,
      timestamps: false,
    }) as unknown as Promise<Readable>;
  }

  async readLogs(containerId: string, options: { tail?: number; since?: number } = {}): Promise<string> {
    try {
      const raw = (await this.docker.getContainer(containerId).logs({
        follow: false,
        stdout: true,
        stderr: true,
        tail: options.tail ?? 500,
        since: options.since,
        timestamps: false,
      })) as unknown as Buffer;
      return raw.toString("utf8");
    } catch (err) {
      if (isDockerStatus(err, 404)) return "";
      throw err;
    }
  }

  /**
   * Runs a one-off `java ...` in a throwaway container on the server's own
   * data dir and runtime image — used for Forge/NeoForge, whose installers
   * are real programs that patch and download the actual server files
   * rather than a single jar the panel could fetch itself. Same lockdown as
   * the long-lived server container (non-root, no capabilities, resource
   * limits); unlike it, it does need outbound network access, since the
   * installer downloads libraries and the vanilla server jar itself.
   * Always removed afterwards, success or not.
   */
  async runInstaller(options: RunInstallerOptions): Promise<InstallerRunResult> {
    await this.ensureNetwork();
    await this.ensureImage(options.javaImageTag);
    // A leftover from an earlier attempt that was interrupted mid-install
    // would otherwise make the create below fail with a name conflict.
    await this.remove(options.containerName, true);

    const container = await this.docker.createContainer({
      name: options.containerName,
      Image: options.javaImageTag,
      Entrypoint: ["java"],
      Cmd: options.javaArgs,
      WorkingDir: "/data",
      Env: [`TZ=${env.TZ}`],
      Tty: true, // raw, non-multiplexed log output
      HostConfig: {
        Memory: options.memoryMb * 1024 * 1024,
        MemorySwap: options.memoryMb * 1024 * 1024,
        PidsLimit: 2048,
        Binds: [`${await this.hostDataDirFor(options.serverId)}:/data`],
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges:true"],
        LogConfig: { Type: "json-file", Config: { "max-size": "10m", "max-file": "1" } },
      },
      NetworkingConfig: { EndpointsConfig: { [env.MINECRAFT_NETWORK]: {} } },
      Labels: { "minecraftpanel.serverId": options.serverId, "minecraftpanel.role": "installer" },
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await container.start();
      const exited = container.wait() as Promise<{ StatusCode: number }>;
      exited.catch(() => {}); // still pending if the timeout wins below — the force-remove then rejects it
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Installer did not finish within ${Math.round(options.timeoutMs / 60_000)} minutes.`)), options.timeoutMs);
      });
      const result = await Promise.race([exited, timeout]);
      const output = await this.readLogs(container.id, { tail: 200 });
      return { exitCode: result.StatusCode, output };
    } finally {
      clearTimeout(timer);
      await container.remove({ force: true }).catch((err) => logger.warn({ err, serverId: options.serverId }, "Failed to remove installer container"));
    }
  }

  getContainer(containerId: string): Docker.Container {
    return this.docker.getContainer(containerId);
  }
}

interface DockerStatsPayload {
  cpu_stats: {
    cpu_usage: { total_usage: number; percpu_usage?: number[] };
    system_cpu_usage?: number;
    online_cpus?: number;
  };
  precpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage?: number };
  memory_stats: { usage?: number; limit?: number; stats?: { cache?: number; inactive_file?: number } };
  networks?: Record<string, { rx_bytes?: number; tx_bytes?: number }>;
}

function computeStats(stats: DockerStatsPayload): Omit<ContainerStats, "startedAt"> {
  const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta = (stats.cpu_stats.system_cpu_usage ?? 0) - (stats.precpu_stats.system_cpu_usage ?? 0);
  const onlineCpus = stats.cpu_stats.online_cpus || stats.cpu_stats.cpu_usage.percpu_usage?.length || 1;
  const cpuPercent = systemDelta > 0 && cpuDelta > 0 ? (cpuDelta / systemDelta) * onlineCpus * 100 : 0;

  const memoryUsageBytes = stats.memory_stats.usage ?? 0;
  const memoryLimitBytes = stats.memory_stats.limit ?? 0;
  // Docker's raw "usage" includes reclaimable page cache; subtract it for a
  // number that more closely matches what a human expects "RAM used" to mean.
  const cacheBytes = stats.memory_stats.stats?.cache ?? stats.memory_stats.stats?.inactive_file ?? 0;

  let networkRxBytes = 0;
  let networkTxBytes = 0;
  for (const iface of Object.values(stats.networks ?? {})) {
    networkRxBytes += iface.rx_bytes ?? 0;
    networkTxBytes += iface.tx_bytes ?? 0;
  }

  return {
    cpuPercent: Math.round(cpuPercent * 10) / 10,
    memoryUsageBytes: Math.max(0, memoryUsageBytes - cacheBytes),
    memoryLimitBytes,
    networkRxBytes,
    networkTxBytes,
  };
}

// Extra allocations are published host==container on both protocols — the
// panel has no visibility into what a given plugin listens on internally,
// so it just opens the port the admin picked (same default Pterodactyl
// allocations use).
function extraPortBindings(ports: number[]): Record<string, { HostPort: string }[]> {
  const bindings: Record<string, { HostPort: string }[]> = {};
  for (const port of ports) {
    bindings[`${port}/tcp`] = [{ HostPort: String(port) }];
    bindings[`${port}/udp`] = [{ HostPort: String(port) }];
  }
  return bindings;
}

function extraExposedPorts(ports: number[]): Record<string, Record<string, never>> {
  const exposed: Record<string, Record<string, never>> = {};
  for (const port of ports) {
    exposed[`${port}/tcp`] = {};
    exposed[`${port}/udp`] = {};
  }
  return exposed;
}

function isDockerStatus(err: unknown, statusCode: number): boolean {
  return typeof err === "object" && err !== null && "statusCode" in err && (err as { statusCode: unknown }).statusCode === statusCode;
}
