import path from "node:path";
import type { PrismaClient, Server } from "@prisma/client";
import {
  compareMcVersions,
  effectiveServerPermissions,
  isProxySoftware,
  NETWORK_BACKEND_SOFTWARE,
  type AccessLevel,
  type AddNetworkBackendInput,
  type NetworkBackendDto,
  type NetworkCandidateDto,
  type NetworkChangeResultDto,
  type NetworkDto,
  type NetworkMembershipDto,
  type Permission,
  type ServerSoftware,
  type ServerStatus,
} from "@minecraftpanel/shared";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../lib/errors.js";
import type { AuthenticatedUser } from "../auth/auth.service.js";
import type { MinecraftServerManager } from "../../minecraft/MinecraftServerManager.js";
import { configureBackendForwarding, readOrCreateVelocitySecret, writeProxyConfig, type BackendForwarding } from "../../minecraft/proxy/proxyConfig.js";

/** Velocity's [servers] table reserves `try` for the join order. */
const RESERVED_NAMES = new Set(["try"]);
/** Velocity's modern forwarding is understood by Paper from 1.13 on. */
const MIN_VELOCITY_BACKEND_VERSION = "1.13";
const RELOAD_TIMEOUT_MS = 15_000;

type ProxySoftware = "VELOCITY" | "BUNGEECORD";

function slugName(serverName: string): string {
  const slug = serverName
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[-_]+|-+$/g, "")
    .slice(0, 32);
  return slug || "server";
}

function isRunning(status: string): boolean {
  return status === "RUNNING" || status === "STARTING";
}

/**
 * Proxy networks: a Velocity/BungeeCord server and the servers behind it.
 * The DB (ServerNetworkMember) is the source of truth; every change is
 * written straight into the proxy's config and the backend's forwarding
 * settings (see minecraft/proxy/proxyConfig.ts) and picked up live where
 * the proxy supports it — the admin never edits velocity.toml, secrets,
 * online-mode or ports by hand.
 */
export class NetworkService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly manager: MinecraftServerManager,
  ) {}

  async getNetwork(proxy: Server, viewer: AuthenticatedUser): Promise<NetworkDto> {
    const software = this.requireProxy(proxy);
    const members = await this.prisma.serverNetworkMember.findMany({
      where: { proxyServerId: proxy.id },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      include: { backend: true },
    });
    const backends: NetworkBackendDto[] = [];
    for (const member of members) {
      const visible = await this.can(viewer, member.backendServerId, "servers.view");
      backends.push({
        memberId: member.id,
        name: member.name,
        priority: member.priority,
        server: visible
          ? {
              id: member.backend.id,
              name: member.backend.name,
              software: member.backend.software as ServerSoftware,
              mcVersion: member.backend.mcVersion,
              status: member.backend.status as ServerStatus,
            }
          : null,
      });
    }
    return { proxyId: proxy.id, forwardingMode: software === "VELOCITY" ? "modern" : "legacy", backends };
  }

  /** Every server the viewer may reconfigure, with why it can't join this network where it can't. */
  async listCandidates(proxy: Server, viewer: AuthenticatedUser): Promise<NetworkCandidateDto[]> {
    this.requireProxy(proxy);
    const servers = await this.prisma.server.findMany({
      where: { id: { not: proxy.id } },
      orderBy: { name: "asc" },
      include: { networkMembership: { include: { proxy: { select: { name: true } } } } },
    });
    const candidates: NetworkCandidateDto[] = [];
    for (const server of servers) {
      if (server.networkMembership?.proxyServerId === proxy.id) continue; // already in this network
      if (!(await this.can(viewer, server.id, "servers.settings.edit"))) continue;
      candidates.push({
        id: server.id,
        name: server.name,
        software: server.software as ServerSoftware,
        mcVersion: server.mcVersion,
        status: server.status as ServerStatus,
        unsupportedReason: this.unsupportedReason(proxy, server, server.networkMembership?.proxy.name ?? null),
      });
    }
    return candidates;
  }

  async addBackend(proxy: Server, input: AddNetworkBackendInput, viewer: AuthenticatedUser): Promise<NetworkChangeResultDto> {
    const software = this.requireProxy(proxy);
    const backend = await this.prisma.server.findUnique({
      where: { id: input.serverId },
      include: { networkMembership: { include: { proxy: { select: { name: true } } } } },
    });
    // Same 404 as requireServerAccess: don't reveal servers the viewer can't manage.
    if (!backend || backend.id === proxy.id || !(await this.can(viewer, backend.id, "servers.settings.edit"))) {
      throw new NotFoundError("Server not found.");
    }
    if (backend.networkMembership?.proxyServerId === proxy.id) throw new ConflictError(`${backend.name} is already in this network.`);
    const reason = this.unsupportedReason(proxy, backend, backend.networkMembership?.proxy.name ?? null);
    if (reason) throw new ConflictError(reason);

    const existing = await this.prisma.serverNetworkMember.findMany({ where: { proxyServerId: proxy.id }, select: { name: true, priority: true } });
    const taken = new Set(existing.map((m) => m.name));
    const name = input.name ?? this.uniqueName(slugName(backend.name), taken);
    if (RESERVED_NAMES.has(name)) throw new BadRequestError(`"${name}" is reserved by the proxy — pick another name.`);
    if (taken.has(name)) throw new ConflictError(`This network already has a server called "${name}".`);

    await this.prisma.serverNetworkMember.create({
      data: { proxyServerId: proxy.id, backendServerId: backend.id, name, priority: Math.max(-1, ...existing.map((m) => m.priority)) + 1 },
    });
    await configureBackendForwarding(this.root(backend), backend.mcVersion, await this.forwardingFor(software, proxy));
    await this.prisma.server.update({ where: { id: backend.id }, data: { exposePort: false } });

    return this.finish(proxy, viewer, { additive: true, backendRestartRequired: isRunning(backend.status) });
  }

  async removeBackend(proxy: Server, memberId: string, viewer: AuthenticatedUser): Promise<NetworkChangeResultDto> {
    this.requireProxy(proxy);
    const member = await this.prisma.serverNetworkMember.findUnique({ where: { id: memberId }, include: { backend: true } });
    if (!member || member.proxyServerId !== proxy.id) throw new NotFoundError("Network member not found.");

    await this.prisma.serverNetworkMember.delete({ where: { id: member.id } });
    await this.makeStandalone(member.backend);
    return this.finish(proxy, viewer, { additive: false, backendRestartRequired: isRunning(member.backend.status) });
  }

  async reorder(proxy: Server, memberIds: string[], viewer: AuthenticatedUser): Promise<NetworkChangeResultDto> {
    this.requireProxy(proxy);
    const members = await this.prisma.serverNetworkMember.findMany({ where: { proxyServerId: proxy.id }, select: { id: true } });
    const known = new Set(members.map((m) => m.id));
    if (memberIds.length !== known.size || new Set(memberIds).size !== known.size || !memberIds.every((id) => known.has(id))) {
      throw new BadRequestError("The new order must list every server of the network exactly once.");
    }
    await this.prisma.$transaction(memberIds.map((id, priority) => this.prisma.serverNetworkMember.update({ where: { id }, data: { priority } })));
    return this.finish(proxy, viewer, { additive: true, backendRestartRequired: false });
  }

  /** The network a server belongs to as a backend, for its own pages. */
  async membershipFor(serverId: string, viewer: AuthenticatedUser): Promise<NetworkMembershipDto | null> {
    const member = await this.prisma.serverNetworkMember.findUnique({
      where: { backendServerId: serverId },
      include: { proxy: { select: { name: true } } },
    });
    if (!member) return null;
    const proxyVisible = await this.can(viewer, member.proxyServerId, "servers.view");
    return { proxyId: member.proxyServerId, proxyName: proxyVisible ? member.proxy.name : null, name: member.name };
  }

  /** Before deleting a proxy: every backend goes back to standalone (online-mode on, port published again). */
  async dissolve(proxy: Server): Promise<void> {
    const members = await this.prisma.serverNetworkMember.findMany({ where: { proxyServerId: proxy.id }, include: { backend: true } });
    for (const member of members) {
      await this.makeStandalone(member.backend).catch((err) => logger.error({ err, serverId: member.backendServerId }, "Failed to reset backend after its proxy was removed"));
    }
    await this.prisma.serverNetworkMember.deleteMany({ where: { proxyServerId: proxy.id } });
  }

  /** Before deleting a backend: drop it from its proxy's config so the proxy doesn't keep pointing at it. */
  async leaveNetwork(backend: Server): Promise<void> {
    const member = await this.prisma.serverNetworkMember.findUnique({ where: { backendServerId: backend.id }, include: { proxy: true } });
    if (!member) return;
    await this.prisma.serverNetworkMember.delete({ where: { id: member.id } });
    await this.applyProxyConfig(member.proxy, { additive: false }).catch((err) =>
      logger.error({ err, serverId: member.proxyServerId }, "Failed to update proxy config after a backend was removed"),
    );
  }

  private unsupportedReason(proxy: Server, server: Server, otherProxyName: string | null): string | null {
    if (otherProxyName !== null) return `Already behind ${otherProxyName}`;
    if (isProxySoftware(server.software as ServerSoftware)) return "A proxy can't sit behind another proxy";
    if (server.runtime !== "PANEL_MANAGED") return "Legacy servers can't be configured automatically";
    if (!NETWORK_BACKEND_SOFTWARE.includes(server.software as ServerSoftware)) {
      return "Automatic proxy setup currently supports Paper servers (Fabric/Forge need a proxy mod)";
    }
    if (proxy.software === "VELOCITY" && compareMcVersions(server.mcVersion, MIN_VELOCITY_BACKEND_VERSION) < 0) {
      return `Velocity forwarding needs Paper ${MIN_VELOCITY_BACKEND_VERSION} or newer — use BungeeCord for older servers`;
    }
    return null;
  }

  private async forwardingFor(software: ProxySoftware, proxy: Server): Promise<BackendForwarding> {
    return software === "VELOCITY" ? { mode: "velocity", secret: await readOrCreateVelocitySecret(this.root(proxy)) } : { mode: "bungeecord" };
  }

  private async makeStandalone(backend: Server): Promise<void> {
    await configureBackendForwarding(this.root(backend), backend.mcVersion, { mode: "none" });
    await this.prisma.server.update({ where: { id: backend.id }, data: { exposePort: true } });
  }

  private async finish(
    proxy: Server,
    viewer: AuthenticatedUser,
    change: { additive: boolean; backendRestartRequired: boolean },
  ): Promise<NetworkChangeResultDto> {
    const { reloaded, restartRequired } = await this.applyProxyConfig(proxy, change);
    return {
      network: await this.getNetwork(proxy, viewer),
      proxyReloaded: reloaded,
      proxyRestartRequired: restartRequired,
      backendRestartRequired: change.backendRestartRequired,
    };
  }

  /**
   * Rewrites the proxy's server list and, if it's running, reloads it live:
   * Velocity reloads its whole config (`velocity reload`); BungeeCord's
   * `greload` can add servers but refuses to drop one ("Server removed on
   * reload!"), so a removal there needs a proxy restart.
   */
  private async applyProxyConfig(proxy: Server, change: { additive: boolean }): Promise<{ reloaded: boolean; restartRequired: boolean }> {
    const software = this.requireProxy(proxy);
    await writeProxyConfig(software, this.root(proxy), await this.manager.proxyBackendEntries(proxy.id));

    const current = await this.prisma.server.findUnique({ where: { id: proxy.id }, select: { status: true } });
    if (current?.status !== "RUNNING") return { reloaded: false, restartRequired: false };
    if (software === "BUNGEECORD" && !change.additive) return { reloaded: false, restartRequired: true };

    try {
      if (software === "VELOCITY") {
        const reply = await this.manager.sendCommand(proxy.id, "velocity reload", {
          silent: true,
          timeoutMs: RELOAD_TIMEOUT_MS,
          waitFor: /successfully reloaded|Unable to reload/i,
        });
        const ok = /successfully reloaded/i.test(reply);
        return { reloaded: ok, restartRequired: !ok };
      }
      await this.manager.sendCommand(proxy.id, "greload", { silent: true, timeoutMs: RELOAD_TIMEOUT_MS });
      return { reloaded: true, restartRequired: false };
    } catch (err) {
      logger.warn({ err, serverId: proxy.id }, "Live proxy reload failed; a restart will apply the change");
      return { reloaded: false, restartRequired: true };
    }
  }

  private requireProxy(server: Server): ProxySoftware {
    if (!isProxySoftware(server.software as ServerSoftware)) {
      throw new BadRequestError("Only Velocity and BungeeCord servers have a network.");
    }
    return server.software as ProxySoftware;
  }

  private uniqueName(base: string, taken: Set<string>): string {
    const start = RESERVED_NAMES.has(base) ? `${base}-server` : base;
    if (!taken.has(start)) return start;
    for (let i = 2; ; i++) {
      const candidate = `${start.slice(0, 28)}-${i}`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  /** Same rule requireServerAccess applies per request, for a server other than the one in the URL. */
  private async can(viewer: AuthenticatedUser, serverId: string, permission: Permission): Promise<boolean> {
    if (viewer.isOwner) return true;
    const access = await this.prisma.serverAccess.findUnique({ where: { userId_serverId: { userId: viewer.id, serverId } } });
    return effectiveServerPermissions([...viewer.permissions], (access?.level as AccessLevel | undefined) ?? null).has(permission);
  }

  private root(server: Pick<Server, "dataDir">): string {
    return path.join(env.DATA_PATH, server.dataDir);
  }
}
