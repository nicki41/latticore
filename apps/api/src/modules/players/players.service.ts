import fs from "node:fs/promises";
import path from "node:path";
import type { PrismaClient, Server } from "@prisma/client";
import { isProxySoftware, type PlayerDto, type ServerSoftware } from "@latticore/shared";
import { env } from "../../config/env.js";
import { safeResolve } from "../../lib/safePath.js";
import { BadRequestError, ConflictError } from "../../lib/errors.js";
import { MinecraftServerManager } from "../../minecraft/MinecraftServerManager.js";
import { resolveUuid, resolveWorldRoot, statsCandidatePaths, playerDataCandidatePaths, playerDataOldCandidatePaths } from "./playerData.service.js";
import { addOpsEntry, removeOpsEntry, addWhitelistEntry, removeWhitelistEntry, addBannedPlayerEntry, removeBannedPlayerEntry } from "./playerFileEdits.service.js";
import { logger } from "../../lib/logger.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const VALID_USERNAME = /^[A-Za-z0-9_]{1,16}$/;

/**
 * Usernames and kick/ban reasons get interpolated into RCON command
 * strings. RCON isn't a shell, so classic shell-injection doesn't apply,
 * but nothing stops a malformed value from breaking the intended command
 * or smuggling an extra one — validated the same way any user input feeding
 * a command interpreter should be, per spec's command-injection guidance.
 */
export function assertValidUsername(username: string): void {
  if (!VALID_USERNAME.test(username)) {
    throw new BadRequestError("Invalid Minecraft username.");
  }
}

export function sanitizeReason(reason: string | undefined): string | undefined {
  if (!reason) return undefined;
  const cleaned = reason.replace(/[\r\n]+/g, " ").trim();
  return cleaned || undefined;
}

function sanitizeMessage(message: string): string {
  const cleaned = message.replace(/[\r\n]+/g, " ").trim();
  if (!cleaned) throw new BadRequestError("Message cannot be empty.");
  return cleaned;
}

interface OpsEntry {
  uuid: string;
  name: string;
}
interface WhitelistEntry {
  uuid: string;
  name: string;
}
interface BannedPlayerEntry {
  uuid: string;
  name: string;
}
interface UserCacheEntry {
  name: string;
  uuid: string;
}

async function readJsonFile<T>(root: string, filename: string): Promise<T[]> {
  try {
    const filePath = await safeResolve(root, filename);
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * op/whitelist/ban/unban work whether the server is running or not: while
 * RUNNING they go through RCON (Minecraft then rewrites ops.json/
 * whitelist.json/banned-players.json itself); while stopped, this edits
 * those same JSON files directly (see playerFileEdits.service.ts) so the
 * change is picked up the next time the server starts. kick/message/
 * setGamemode stay RCON-only — they act on a live, connected player, which
 * only exists while the server is running.
 */
export class PlayerService {
  constructor(
    private readonly manager: MinecraftServerManager,
    private readonly prisma: PrismaClient,
  ) {}

  async list(server: Server): Promise<PlayerDto[]> {
    const root = path.join(env.DATA_PATH, server.dataDir);
    const [ops, whitelist, banned, cache, online, profiles] = await Promise.all([
      readJsonFile<OpsEntry>(root, "ops.json"),
      readJsonFile<WhitelistEntry>(root, "whitelist.json"),
      readJsonFile<BannedPlayerEntry>(root, "banned-players.json"),
      readJsonFile<UserCacheEntry>(root, "usercache.json"),
      this.getOnlinePlayerNames(server),
      this.prisma.playerProfile.findMany({ where: { serverId: server.id } }),
    ]);

    const byName = new Map<string, PlayerDto>();
    const ensure = (name: string, uuid: string | null): PlayerDto => {
      const key = name.toLowerCase();
      let entry = byName.get(key);
      if (!entry) {
        entry = {
          username: name,
          uuid,
          online: false,
          op: false,
          whitelisted: false,
          banned: false,
          firstSeenAt: null,
          lastSeenAt: null,
          playtimeSeconds: 0,
          lastIp: null,
        };
        byName.set(key, entry);
      } else if (!entry.uuid && uuid) {
        entry.uuid = uuid;
      }
      return entry;
    };

    for (const e of cache) ensure(e.name, e.uuid);
    for (const e of ops) ensure(e.name, e.uuid).op = true;
    for (const e of whitelist) ensure(e.name, e.uuid).whitelisted = true;
    for (const e of banned) ensure(e.name, e.uuid).banned = true;
    for (const name of online) ensure(name, null).online = true;

    const now = Date.now();
    for (const profile of profiles) {
      const entry = ensure(profile.username, profile.uuid);
      entry.firstSeenAt = profile.firstSeenAt?.toISOString() ?? null;
      entry.lastSeenAt = profile.lastSeenAt?.toISOString() ?? null;
      entry.lastIp = profile.lastIp;
      const liveSeconds = profile.currentSessionStartedAt
        ? Math.max(0, Math.round((now - profile.currentSessionStartedAt.getTime()) / 1000))
        : 0;
      entry.playtimeSeconds = profile.totalPlaytimeSeconds + liveSeconds;
    }

    return [...byName.values()].sort((a, b) => a.username.localeCompare(b.username));
  }

  private async getOnlinePlayerNames(server: Server): Promise<string[]> {
    // Proxies have no `list` (it would just time out) and no players of their own.
    if (server.status !== "RUNNING" || isProxySoftware(server.software as ServerSoftware)) return [];
    try {
      const response = await this.manager.sendCommand(server.id, "list", { silent: true });
      // "There are 2 of a max of 20 players online: Alice, Bob"
      const match = /:\s*(.+)$/.exec(response.trim());
      if (!match?.[1]) return [];
      return match[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  private async requireRunning(server: Server): Promise<void> {
    if (server.status !== "RUNNING") {
      throw new ConflictError("The server must be running to manage players.");
    }
  }

  async op(server: Server, username: string): Promise<void> {
    assertValidUsername(username);
    if (server.status === "RUNNING") {
      await this.manager.sendCommand(server.id, `op ${username}`, { silent: true });
      return;
    }
    await addOpsEntry(this.prisma, server, username);
  }

  async deop(server: Server, username: string): Promise<void> {
    assertValidUsername(username);
    if (server.status === "RUNNING") {
      await this.manager.sendCommand(server.id, `deop ${username}`, { silent: true });
      return;
    }
    await removeOpsEntry(server, username);
  }

  async whitelistAdd(server: Server, username: string): Promise<void> {
    assertValidUsername(username);
    if (server.status === "RUNNING") {
      await this.manager.sendCommand(server.id, `whitelist add ${username}`, { silent: true });
      return;
    }
    await addWhitelistEntry(this.prisma, server, username);
  }

  async whitelistRemove(server: Server, username: string): Promise<void> {
    assertValidUsername(username);
    if (server.status === "RUNNING") {
      await this.manager.sendCommand(server.id, `whitelist remove ${username}`, { silent: true });
      return;
    }
    await removeWhitelistEntry(server, username);
  }

  async kick(server: Server, username: string, reason?: string): Promise<void> {
    assertValidUsername(username);
    await this.requireRunning(server);
    const cleanReason = sanitizeReason(reason);
    await this.manager.sendCommand(server.id, cleanReason ? `kick ${username} ${cleanReason}` : `kick ${username}`, { silent: true });
  }

  async ban(server: Server, username: string, reason?: string): Promise<void> {
    assertValidUsername(username);
    const cleanReason = sanitizeReason(reason);
    if (server.status === "RUNNING") {
      await this.manager.sendCommand(server.id, cleanReason ? `ban ${username} ${cleanReason}` : `ban ${username}`, { silent: true });
      return;
    }
    await addBannedPlayerEntry(this.prisma, server, username, cleanReason, null);
  }

  async unban(server: Server, username: string): Promise<void> {
    assertValidUsername(username);
    if (server.status === "RUNNING") {
      await this.manager.sendCommand(server.id, `pardon ${username}`, { silent: true });
      return;
    }
    await removeBannedPlayerEntry(server, username);
  }

  /** Vanilla's /gamemode command requires the target to be online — same as kick, the UI disables the action while offline rather than this throwing (RCON just replies "No player was found" harmlessly). */
  async setGamemode(server: Server, username: string, mode: "SURVIVAL" | "CREATIVE" | "ADVENTURE" | "SPECTATOR"): Promise<void> {
    assertValidUsername(username);
    await this.requireRunning(server);
    await this.manager.sendCommand(server.id, `gamemode ${mode.toLowerCase()} ${username}`, { silent: true });
  }

  async message(server: Server, username: string, text: string): Promise<void> {
    assertValidUsername(username);
    await this.requireRunning(server);
    const cleanText = sanitizeMessage(text);
    await this.manager.sendCommand(server.id, `tell ${username} ${cleanText}`, { silent: true });
  }

  /**
   * Deletes a player's stats + playerdata files so they start completely
   * fresh on next join — irreversible, gated behind its own `players.wipe`
   * permission rather than reusing `players.ban`. If they're currently
   * online, kicks them first and gives the server a moment to finish
   * writing/closing their files before deleting, so a natural disconnect
   * later can't resurrect the files we just removed. Works even while the
   * server is stopped (pure filesystem op) — only the kick step needs it running.
   */
  async wipe(server: Server, username: string): Promise<void> {
    assertValidUsername(username);
    const uuid = await resolveUuid(this.prisma, server, username);
    if (!uuid) throw new BadRequestError("No known UUID for this player — nothing to wipe.");

    if (server.status === "RUNNING") {
      const online = (await this.getOnlinePlayerNames(server)).some((n) => n.toLowerCase() === username.toLowerCase());
      if (online) {
        await this.manager.sendCommand(server.id, `kick ${username} Your data is being reset by an administrator.`, { silent: true });
        await sleep(1000);
      }
    }

    const worldRoot = await resolveWorldRoot(server);
    // Deletes at every candidate location (vanilla flat layout AND Paper's
    // world/players/{stats,data} layout) rather than picking one — fs.rm
    // with force:true silently no-ops on whichever path doesn't exist, so
    // this is correct regardless of which layout this server actually uses.
    const targets = [...statsCandidatePaths(uuid), ...playerDataCandidatePaths(uuid), ...playerDataOldCandidatePaths(uuid)];
    for (const relPath of targets) {
      try {
        const filePath = await safeResolve(worldRoot, relPath);
        await fs.rm(filePath, { force: true });
      } catch (err) {
        logger.debug({ err, serverId: server.id, uuid, relPath }, "Failed to remove file during player wipe");
      }
    }
  }
}
