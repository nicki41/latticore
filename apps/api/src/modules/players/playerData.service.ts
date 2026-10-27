import fs from "node:fs/promises";
import path from "node:path";
import nbt from "prismarine-nbt";
import type { PrismaClient, Server } from "@prisma/client";
import type { PlayerGamemode, PlayerGamemodeDto, PlayerStatsDto } from "@latticore/shared";
import { env } from "../../config/env.js";
import { safeResolve } from "../../lib/safePath.js";
import { PropertiesDocument } from "../../lib/propertiesCodec.js";

const CM_PER_METER = 100;
const TICKS_PER_SECOND = 20;

/** Resolves the Minecraft world folder (level-name in server.properties, default "world") the same way ServerConfigService reads server.properties — deliberately excluded from the editable config schema (world-generation-time only), so read directly here instead. */
export async function resolveWorldRoot(server: Pick<Server, "dataDir">): Promise<string> {
  const root = path.join(env.DATA_PATH, server.dataDir);
  const propsPath = await safeResolve(root, "server.properties");
  const raw = await fs.readFile(propsPath, "utf8").catch(() => null);
  const levelName = raw ? (PropertiesDocument.parse(raw).get("level-name") ?? "world") : "world";
  return safeResolve(root, levelName);
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function ratio(numerator: number, denominator: number | null): number | null {
  if (!denominator) return null;
  return numerator / denominator;
}

/**
 * Vanilla/Fabric/Forge/NeoForge store per-player files flat under the world
 * folder (world/stats/<uuid>.json, world/playerdata/<uuid>.dat). Paper
 * reorganizes them under world/players/{stats,data}/ instead — confirmed
 * directly against a live Paper server's actual disk layout, not just
 * documented behavior. Every reader tries both locations rather than
 * branching on server.software, since that's strictly more robust than
 * trusting the DB's software field to always match what's really on disk.
 */
export function statsCandidatePaths(uuid: string): string[] {
  return [`players/stats/${uuid}.json`, `stats/${uuid}.json`];
}
export function playerDataCandidatePaths(uuid: string): string[] {
  return [`players/data/${uuid}.dat`, `playerdata/${uuid}.dat`];
}
export function playerDataOldCandidatePaths(uuid: string): string[] {
  return [`players/data/${uuid}.dat_old`, `playerdata/${uuid}.dat_old`];
}

async function resolveExistingPath(worldRoot: string, candidates: string[]): Promise<string | null> {
  for (const rel of candidates) {
    const abs = await safeResolve(worldRoot, rel);
    const stat = await fs.stat(abs).catch(() => null);
    if (stat) return abs;
  }
  return null;
}

/** Pure mapping from vanilla's stats/<uuid>.json shape to our curated DTO — exported separately so it's testable without touching the filesystem. */
export function mapStatsJson(raw: unknown): PlayerStatsDto {
  const stats = (raw as { stats?: Record<string, Record<string, number>> } | null)?.stats ?? {};
  const custom = stats["minecraft:custom"] ?? {};
  const killedBy = stats["minecraft:killed_by"] ?? {};

  const playtimeTicks = custom["minecraft:play_time"] ?? custom["minecraft:play_one_minute"];
  const playtimeSeconds = playtimeTicks !== undefined ? Math.round(num(playtimeTicks) / TICKS_PER_SECOND) : null;

  const cm = (key: string) => num(custom[key]);
  const walking = cm("minecraft:walk_one_cm") + cm("minecraft:walk_on_water_one_cm") + cm("minecraft:walk_under_water_one_cm") + cm("minecraft:crouch_one_cm");
  const sprinting = cm("minecraft:sprint_one_cm");
  const swimming = cm("minecraft:swim_one_cm");
  const flying = cm("minecraft:fly_one_cm") + cm("minecraft:aviate_one_cm");
  const boat = cm("minecraft:boat_one_cm");
  const minecart = cm("minecraft:minecart_one_cm");
  const mounted = cm("minecraft:horse_one_cm") + cm("minecraft:pig_one_cm") + cm("minecraft:strider_one_cm");
  const climbing = cm("minecraft:climb_one_cm");
  const falling = cm("minecraft:fall_one_cm");
  const totalCm = walking + sprinting + swimming + flying + boat + minecart + mounted + climbing + falling;

  const playerKills = num(custom["minecraft:player_kills"]);
  const deaths = num(custom["minecraft:deaths"]);
  const mobKills = num(custom["minecraft:mob_kills"]);

  const deathsToPlayersRaw = killedBy["minecraft:player"];
  const deathsToPlayers = deathsToPlayersRaw !== undefined ? num(deathsToPlayersRaw) : null;
  const deathsToMobs = Object.entries(killedBy)
    .filter(([key]) => key !== "minecraft:player")
    .reduce((sum, [, v]) => sum + num(v), 0);

  return {
    playtimeSeconds,
    distance: {
      walkingMeters: walking / CM_PER_METER,
      sprintingMeters: sprinting / CM_PER_METER,
      swimmingMeters: swimming / CM_PER_METER,
      flyingMeters: flying / CM_PER_METER,
      boatMeters: boat / CM_PER_METER,
      minecartMeters: minecart / CM_PER_METER,
      mountedMeters: mounted / CM_PER_METER,
      climbingMeters: climbing / CM_PER_METER,
      fallingMeters: falling / CM_PER_METER,
      totalMeters: totalCm / CM_PER_METER,
    },
    playerKills,
    deaths,
    deathsToPlayers,
    playerKdRatio: ratio(playerKills, deathsToPlayers),
    mobKills,
    deathsToMobs,
    mobKdRatio: ratio(mobKills, deathsToMobs || null),
  };
}

const GAMEMODE_BY_INT: Record<number, PlayerGamemode> = {
  0: "SURVIVAL",
  1: "CREATIVE",
  2: "ADVENTURE",
  3: "SPECTATOR",
};

/** Resolves a username to its Mojang UUID: tracked PlayerProfile first (indexed, fast), falling back to the same usercache.json scan PlayerService.list() uses for players the activity tracker hasn't seen yet. Standalone (not a class method) so other services can reuse it without instantiating PlayerDataService. */
export async function resolveUuid(prisma: PrismaClient, server: Server, username: string): Promise<string | null> {
  const usernameLower = username.toLowerCase();
  const profile = await prisma.playerProfile.findUnique({
    where: { serverId_usernameLower: { serverId: server.id, usernameLower } },
  });
  if (profile?.uuid) return profile.uuid;

  const root = path.join(env.DATA_PATH, server.dataDir);
  const cachePath = await safeResolve(root, "usercache.json");
  const raw = await fs.readFile(cachePath, "utf8").catch(() => null);
  if (!raw) return null;
  try {
    const entries = JSON.parse(raw) as { name: string; uuid: string }[];
    const match = Array.isArray(entries) ? entries.find((e) => e.name?.toLowerCase() === usernameLower) : null;
    return match?.uuid ?? null;
  } catch {
    return null;
  }
}

export class PlayerDataService {
  constructor(private readonly prisma: PrismaClient) {}

  async readStats(server: Server, uuid: string): Promise<PlayerStatsDto | null> {
    const worldRoot = await resolveWorldRoot(server);
    const statsPath = await resolveExistingPath(worldRoot, statsCandidatePaths(uuid));
    if (!statsPath) return null;
    const raw = await fs.readFile(statsPath, "utf8").catch(() => null);
    if (raw === null) return null;
    try {
      return mapStatsJson(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async readGamemode(server: Server, uuid: string): Promise<PlayerGamemodeDto> {
    const worldRoot = await resolveWorldRoot(server);
    const datPath = await resolveExistingPath(worldRoot, playerDataCandidatePaths(uuid));
    if (!datPath) return { gamemode: null };
    const buffer = await fs.readFile(datPath).catch(() => null);
    if (!buffer) return { gamemode: null };
    try {
      const { parsed } = await nbt.parse(buffer);
      const simplified = nbt.simplify(parsed) as { playerGameType?: number };
      const gamemode = typeof simplified.playerGameType === "number" ? (GAMEMODE_BY_INT[simplified.playerGameType] ?? null) : null;
      return { gamemode };
    } catch {
      return { gamemode: null };
    }
  }

  async resolveUuid(server: Server, username: string): Promise<string | null> {
    return resolveUuid(this.prisma, server, username);
  }
}
