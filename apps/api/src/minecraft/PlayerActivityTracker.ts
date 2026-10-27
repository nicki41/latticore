import type { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import type { PrismaClient } from "@prisma/client";
import { isProxySoftware, PROXY_SOFTWARE, type ServerSoftware, type ServerStatus } from "@latticore/shared";
import { logger } from "../lib/logger.js";
import { stripAnsi } from "../lib/ansi.js";
import { expireDueBans } from "../modules/players/playerBans.service.js";

const RECONCILE_MS = 60_000;
const STREAM_RETRY_MS = 5000;

/** The subset of MinecraftServerManager this tracker depends on — extracted so tests can inject a fake without a real Docker/RCON connection, same rationale as MinecraftRuntime in MinecraftServerManager.ts. */
export interface PlayerActivityManager {
  on(event: "status", listener: (serverId: string, status: ServerStatus) => void): unknown;
  off(event: "status", listener: (serverId: string, status: ServerStatus) => void): unknown;
  getLogStream(serverId: string, options?: { tail?: number }): Promise<Readable>;
  sendCommand(serverId: string, command: string, options?: { silent?: boolean }): Promise<string>;
}

/** Real Minecraft usernames only — guards every capture below against chat messages that happen to contain phrases like "joined the game" (e.g. a player literally typing that), since a genuine username never contains spaces or angle brackets. */
const VALID_USERNAME = /^[A-Za-z0-9_]{1,16}$/;

const UUID_LINE_RE = /UUID of player (\S+) is ([0-9a-fA-F-]{32,36})/;
const LOGIN_IP_LINE_RE = /(\S+)\[\/([^\]]+)\]\s+logged in with entity id/;
const JOINED_LINE_RE = /(?:^|:\s)(\S+) joined the game\s*$/;
const LEFT_LINE_RE = /(?:^|:\s)(\S+) left the game\s*$/;

function parseOnlineNames(listResponse: string): string[] {
  // "There are 2 of a max of 20 players online: Alice, Bob" — same shape PlayerService.getOnlinePlayerNames() parses.
  const match = /:\s*(.+)$/.exec(listResponse.trim());
  if (!match?.[1]) return [];
  return match[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

interface TrackedServer {
  stream: Readable | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Background collector that follows every RUNNING server's log output to
 * populate PlayerProfile (first/last seen, cumulative playtime, last IP) —
 * independent of whether anyone has the Players page open, mirroring
 * MetricsHistoryCollector's always-on-regardless-of-viewers design. Op/
 * whitelist/ban status is NOT tracked here; that stays live via
 * PlayerService reading ops.json/whitelist.json/banned-players.json + RCON.
 *
 * Join/leave detection is log-line based (Minecraft doesn't expose player
 * IP or session timing over RCON), backstopped by a periodic RCON `list`
 * reconciliation that closes sessions missed by a dropped log line (kicks,
 * crashes) and seeds sessions for players already online when this tracker
 * (re)starts.
 *
 * Also emits "playerJoin"/"playerLeave" — from openSession/closeOpenSession
 * specifically, the two primitives shared by both the log-line path and the
 * RCON reconcile path, so the notification dispatcher (see
 * modules/notifications/) sees a join/leave exactly once regardless of
 * which path detected it.
 */
export class PlayerActivityTracker extends EventEmitter {
  private tracked = new Map<string, TrackedServer>();
  private periodicTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly manager: PlayerActivityManager,
  ) {
    super();
  }

  start(): void {
    if (this.periodicTimer) return;
    this.manager.on("status", this.handleStatusChange);
    this.periodicTimer = setInterval(() => void this.reconcileAll(), RECONCILE_MS);
    this.periodicTimer.unref?.();
    void this.bootstrap();
  }

  stop(): void {
    this.disposed = true;
    this.manager.off("status", this.handleStatusChange);
    if (this.periodicTimer) clearInterval(this.periodicTimer);
    this.periodicTimer = null;
    for (const serverId of [...this.tracked.keys()]) this.stopTracking(serverId);
  }

  private async bootstrap(): Promise<void> {
    const servers = await this.prisma.server.findMany({ where: { status: "RUNNING", software: { notIn: [...PROXY_SOFTWARE] } }, select: { id: true } });
    await Promise.all(servers.map((s) => this.ensureTracking(s.id)));
  }

  private handleStatusChange = (serverId: string, status: ServerStatus): void => {
    if (status === "RUNNING") {
      void this.ensureTracking(serverId);
      return;
    }
    this.stopTracking(serverId);
    void this.closeAllOpenSessions(serverId).catch((err) => logger.debug({ err, serverId }, "Failed to close player sessions on stop"));
  };

  private async ensureTracking(serverId: string): Promise<void> {
    if (this.disposed || this.tracked.has(serverId)) return;
    // Proxies log joins in their own format and have no `list`/whitelist/
    // bans of their own — player history lives on the backends.
    const server = await this.prisma.server.findUnique({ where: { id: serverId }, select: { software: true } }).catch(() => null);
    if (server && isProxySoftware(server.software as ServerSoftware)) return;
    if (this.disposed || this.tracked.has(serverId)) return;
    const state: TrackedServer = { stream: null, retryTimer: null };
    this.tracked.set(serverId, state);
    await this.reconcileServer(serverId).catch((err) => logger.debug({ err, serverId }, "Initial player-activity reconcile failed"));
    await this.openStream(serverId, state);
  }

  private stopTracking(serverId: string): void {
    const state = this.tracked.get(serverId);
    if (!state) return;
    this.tracked.delete(serverId);
    if (state.retryTimer) clearTimeout(state.retryTimer);
    state.stream?.destroy();
  }

  private async openStream(serverId: string, state: TrackedServer): Promise<void> {
    if (this.disposed || !this.tracked.has(serverId)) return;
    try {
      const stream = await this.manager.getLogStream(serverId, { tail: 0 });
      if (this.disposed || !this.tracked.has(serverId)) {
        stream.destroy();
        return;
      }
      state.stream = stream;
      stream.on("data", (chunk: Buffer) => this.handleLogChunk(serverId, chunk));
      stream.on("error", (err) => {
        logger.debug({ err, serverId }, "Player activity log stream error");
        this.handleStreamEnded(serverId, state);
      });
      stream.on("close", () => this.handleStreamEnded(serverId, state));
    } catch {
      this.scheduleRetry(serverId, state);
    }
  }

  private handleStreamEnded(serverId: string, state: TrackedServer): void {
    state.stream = null;
    if (!this.disposed && this.tracked.has(serverId)) this.scheduleRetry(serverId, state);
  }

  private scheduleRetry(serverId: string, state: TrackedServer): void {
    if (state.retryTimer || this.disposed) return;
    state.retryTimer = setTimeout(() => {
      state.retryTimer = null;
      void this.openStream(serverId, state);
    }, STREAM_RETRY_MS);
    state.retryTimer.unref?.();
  }

  private handleLogChunk(serverId: string, chunk: Buffer): void {
    const text = stripAnsi(chunk.toString("utf8"));
    for (const rawLine of text.split(/\r?\n/)) {
      if (rawLine.length === 0) continue;
      this.handleLine(serverId, rawLine);
    }
  }

  private handleLine(serverId: string, line: string): void {
    const uuidMatch = UUID_LINE_RE.exec(line);
    if (uuidMatch) {
      const username = uuidMatch[1]!;
      const uuid = uuidMatch[2]!;
      if (VALID_USERNAME.test(username)) {
        void this.recordUuid(serverId, username, uuid).catch((err) => logger.debug({ err, serverId }, "recordUuid failed"));
        return;
      }
    }
    const loginMatch = LOGIN_IP_LINE_RE.exec(line);
    if (loginMatch) {
      const username = loginMatch[1]!;
      const rawIp = loginMatch[2]!;
      if (VALID_USERNAME.test(username)) {
        const ip = rawIp.replace(/:\d+$/, "");
        void this.recordIp(serverId, username, ip).catch((err) => logger.debug({ err, serverId }, "recordIp failed"));
        return;
      }
    }
    const joinedMatch = JOINED_LINE_RE.exec(line);
    if (joinedMatch) {
      const username = joinedMatch[1]!;
      if (VALID_USERNAME.test(username)) {
        void this.recordJoin(serverId, username).catch((err) => logger.debug({ err, serverId }, "recordJoin failed"));
        return;
      }
    }
    const leftMatch = LEFT_LINE_RE.exec(line);
    if (leftMatch) {
      const username = leftMatch[1]!;
      if (VALID_USERNAME.test(username)) {
        void this.recordLeave(serverId, username).catch((err) => logger.debug({ err, serverId }, "recordLeave failed"));
      }
    }
  }

  /** A UUID we already know under a different username reappearing means a rename — logged as history, not merged (see PlayerNameHistory's schema comment for why). */
  private async recordUuid(serverId: string, username: string, uuid: string): Promise<void> {
    const usernameLower = username.toLowerCase();
    const priorByUuid = await this.prisma.playerProfile.findFirst({
      where: { serverId, uuid, usernameLower: { not: usernameLower } },
    });
    if (priorByUuid) {
      await this.prisma.playerNameHistory.create({ data: { serverId, uuid, username } });
    }
    await this.prisma.playerProfile.upsert({
      where: { serverId_usernameLower: { serverId, usernameLower } },
      create: { serverId, usernameLower, username, uuid },
      update: { username, uuid },
    });
  }

  private async recordIp(serverId: string, username: string, ip: string): Promise<void> {
    const usernameLower = username.toLowerCase();
    await this.prisma.playerProfile.upsert({
      where: { serverId_usernameLower: { serverId, usernameLower } },
      create: { serverId, usernameLower, username, lastIp: ip },
      update: { username, lastIp: ip },
    });
    const lastEntry = await this.prisma.playerIpHistory.findFirst({
      where: { serverId, usernameLower },
      orderBy: { seenAt: "desc" },
    });
    if (lastEntry?.ip !== ip) {
      await this.prisma.playerIpHistory.create({ data: { serverId, usernameLower, ip } });
    }
  }

  private async openSession(serverId: string, usernameLower: string, startedAt: Date, username: string): Promise<void> {
    await this.prisma.playerSession.create({ data: { serverId, usernameLower, startedAt } });
    this.emit("playerJoin", serverId, username);
  }

  private async closeOpenSession(serverId: string, usernameLower: string, endedAt: Date, username: string): Promise<void> {
    const session = await this.prisma.playerSession.findFirst({
      where: { serverId, usernameLower, endedAt: null },
      orderBy: { startedAt: "desc" },
    });
    if (!session) return;
    const durationSeconds = Math.max(0, Math.round((endedAt.getTime() - session.startedAt.getTime()) / 1000));
    await this.prisma.playerSession.update({ where: { id: session.id }, data: { endedAt, durationSeconds } });
    this.emit("playerLeave", serverId, username);
  }

  private async recordJoin(serverId: string, username: string): Promise<void> {
    const usernameLower = username.toLowerCase();
    const now = new Date();
    const existing = await this.prisma.playerProfile.findUnique({ where: { serverId_usernameLower: { serverId, usernameLower } } });
    await this.prisma.playerProfile.upsert({
      where: { serverId_usernameLower: { serverId, usernameLower } },
      create: { serverId, usernameLower, username, firstSeenAt: now, lastSeenAt: now, currentSessionStartedAt: now },
      update: { username, lastSeenAt: now, currentSessionStartedAt: now, firstSeenAt: existing?.firstSeenAt ?? now },
    });
    await this.openSession(serverId, usernameLower, now, username);
  }

  private async recordLeave(serverId: string, username: string): Promise<void> {
    const usernameLower = username.toLowerCase();
    const now = new Date();
    const existing = await this.prisma.playerProfile.findUnique({ where: { serverId_usernameLower: { serverId, usernameLower } } });
    if (!existing?.currentSessionStartedAt) {
      // No open session on record (e.g. tracker started mid-session and reconcile hasn't run yet) — just bump lastSeenAt.
      await this.prisma.playerProfile.upsert({
        where: { serverId_usernameLower: { serverId, usernameLower } },
        create: { serverId, usernameLower, username, lastSeenAt: now },
        update: { username, lastSeenAt: now },
      });
      return;
    }
    const deltaSeconds = Math.max(0, Math.round((now.getTime() - existing.currentSessionStartedAt.getTime()) / 1000));
    await this.prisma.playerProfile.update({
      where: { serverId_usernameLower: { serverId, usernameLower } },
      data: { lastSeenAt: now, currentSessionStartedAt: null, totalPlaytimeSeconds: existing.totalPlaytimeSeconds + deltaSeconds },
    });
    await this.closeOpenSession(serverId, usernameLower, now, username);
  }

  private async reconcileAll(): Promise<void> {
    for (const serverId of this.tracked.keys()) {
      await this.reconcileServer(serverId).catch((err) => logger.debug({ err, serverId }, "Player activity reconcile failed"));
    }
  }

  /** RCON `list` is ground truth: closes sessions a dropped log line missed (kick/crash), and seeds sessions for players already online when tracking (re)starts. Also where due tempbans get auto-pardoned, piggybacking on this already-scheduled per-server tick. */
  private async reconcileServer(serverId: string): Promise<void> {
    await expireDueBans(this.prisma, this.manager, serverId).catch((err) => logger.debug({ err, serverId }, "expireDueBans failed"));

    let onlineNames: string[];
    try {
      const response = await this.manager.sendCommand(serverId, "list", { silent: true });
      onlineNames = parseOnlineNames(response).filter((n) => VALID_USERNAME.test(n));
    } catch {
      return; // RCON not ready yet, or server isn't actually running — skip this tick
    }
    const onlineByLower = new Map(onlineNames.map((n) => [n.toLowerCase(), n]));
    const now = new Date();

    const openSessions = await this.prisma.playerProfile.findMany({
      where: { serverId, currentSessionStartedAt: { not: null } },
    });
    for (const profile of openSessions) {
      if (onlineByLower.has(profile.usernameLower)) continue;
      const deltaSeconds = Math.max(0, Math.round((now.getTime() - profile.currentSessionStartedAt!.getTime()) / 1000));
      await this.prisma.playerProfile.update({
        where: { id: profile.id },
        data: { lastSeenAt: now, currentSessionStartedAt: null, totalPlaytimeSeconds: profile.totalPlaytimeSeconds + deltaSeconds },
      });
      await this.closeOpenSession(serverId, profile.usernameLower, now, profile.username);
    }

    const trackedLower = new Set(openSessions.map((p) => p.usernameLower));
    for (const [usernameLower, username] of onlineByLower) {
      if (trackedLower.has(usernameLower)) continue;
      await this.prisma.playerProfile.upsert({
        where: { serverId_usernameLower: { serverId, usernameLower } },
        create: { serverId, usernameLower, username, firstSeenAt: now, lastSeenAt: now, currentSessionStartedAt: now },
        update: { username, lastSeenAt: now, currentSessionStartedAt: now },
      });
      await this.openSession(serverId, usernameLower, now, username);
    }
  }

  private async closeAllOpenSessions(serverId: string): Promise<void> {
    const now = new Date();
    const open = await this.prisma.playerProfile.findMany({ where: { serverId, currentSessionStartedAt: { not: null } } });
    for (const profile of open) {
      const deltaSeconds = Math.max(0, Math.round((now.getTime() - profile.currentSessionStartedAt!.getTime()) / 1000));
      await this.prisma.playerProfile.update({
        where: { id: profile.id },
        data: { lastSeenAt: now, currentSessionStartedAt: null, totalPlaytimeSeconds: profile.totalPlaytimeSeconds + deltaSeconds },
      });
      await this.closeOpenSession(serverId, profile.usernameLower, now, profile.username);
    }
  }
}
