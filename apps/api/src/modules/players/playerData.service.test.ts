import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import nbt from "prismarine-nbt";
import type { Server } from "@prisma/client";
import { PlayerDataService, mapStatsJson, resolveWorldRoot } from "./playerData.service.js";

vi.mock("../../config/env.js", () => ({
  env: {
    get DATA_PATH() {
      return globalThis.__TEST_DATA_PATH__;
    },
  },
}));

declare global {
   
  var __TEST_DATA_PATH__: string;
}

function makeServer(overrides: Partial<Server> = {}): Server {
  return {
    id: "srv-1",
    dataDir: "server1",
     
    ...overrides,
  } as any as Server;
}

function makeFakePrisma(profileUuid: string | null = null) {
  return {
    playerProfile: {
      findUnique: vi.fn(async () => (profileUuid ? { uuid: profileUuid } : null)),
    },
     
  } as any;
}

describe("mapStatsJson", () => {
  it("maps playtime, distance breakdown, and kill/death stats from vanilla's stats JSON shape", () => {
    const raw = {
      stats: {
        "minecraft:custom": {
          "minecraft:play_time": 72000, // 3600s
          "minecraft:walk_one_cm": 100_000, // 1000m
          "minecraft:sprint_one_cm": 50_000, // 500m
          "minecraft:swim_one_cm": 10_000,
          "minecraft:fly_one_cm": 20_000,
          "minecraft:boat_one_cm": 5_000,
          "minecraft:minecart_one_cm": 3_000,
          "minecraft:horse_one_cm": 2_000,
          "minecraft:climb_one_cm": 1_000,
          "minecraft:fall_one_cm": 500,
          "minecraft:player_kills": 10,
          "minecraft:deaths": 5,
          "minecraft:mob_kills": 40,
        },
        "minecraft:killed_by": {
          "minecraft:player": 2,
          "minecraft:zombie": 2,
          "minecraft:skeleton": 1,
        },
      },
    };

    const dto = mapStatsJson(raw);

    expect(dto.playtimeSeconds).toBe(3600);
    expect(dto.distance.walkingMeters).toBe(1000);
    expect(dto.distance.sprintingMeters).toBe(500);
    expect(dto.distance.mountedMeters).toBe(20); // horse_one_cm only in this fixture
    expect(dto.distance.totalMeters).toBeCloseTo(1000 + 500 + 100 + 200 + 50 + 30 + 20 + 10 + 5, 5);
    expect(dto.playerKills).toBe(10);
    expect(dto.deaths).toBe(5);
    expect(dto.mobKills).toBe(40);
    expect(dto.deathsToPlayers).toBe(2);
    expect(dto.playerKdRatio).toBe(5); // 10 / 2
    expect(dto.deathsToMobs).toBe(3); // zombie(2) + skeleton(1), excluding player
    expect(dto.mobKdRatio).toBeCloseTo(40 / 3);
  });

  it("guards against divide-by-zero and missing data, defaulting to null ratios / null playtime / zero counts", () => {
    const dto = mapStatsJson({ stats: {} });

    expect(dto.playtimeSeconds).toBeNull();
    expect(dto.playerKills).toBe(0);
    expect(dto.deaths).toBe(0);
    expect(dto.deathsToPlayers).toBeNull(); // no killed_by.player entry at all
    expect(dto.playerKdRatio).toBeNull();
    expect(dto.deathsToMobs).toBe(0);
    expect(dto.mobKdRatio).toBeNull(); // deathsToMobs is 0
    expect(dto.distance.totalMeters).toBe(0);
  });

  it("falls back to the legacy minecraft:play_one_minute key when play_time is absent", () => {
    const dto = mapStatsJson({ stats: { "minecraft:custom": { "minecraft:play_one_minute": 200 } } });
    expect(dto.playtimeSeconds).toBe(10);
  });

  it("tolerates malformed/non-object input without throwing", () => {
    expect(() => mapStatsJson(null)).not.toThrow();
    expect(() => mapStatsJson(undefined)).not.toThrow();
    expect(mapStatsJson(null).playtimeSeconds).toBeNull();
  });
});

describe("PlayerDataService (filesystem I/O)", () => {
  let tmpDataPath: string;

  beforeEach(async () => {
    tmpDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "mcpanel-playerdata-"));
    globalThis.__TEST_DATA_PATH__ = tmpDataPath;
    await fs.mkdir(path.join(tmpDataPath, "server1", "world", "stats"), { recursive: true });
    await fs.mkdir(path.join(tmpDataPath, "server1", "world", "playerdata"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDataPath, { recursive: true, force: true });
  });

  describe("resolveWorldRoot", () => {
    it("defaults to 'world' when server.properties is missing or has no level-name", async () => {
      const root = await resolveWorldRoot(makeServer());
      expect(root).toBe(path.join(tmpDataPath, "server1", "world"));
    });

    it("honors a custom level-name from server.properties", async () => {
      await fs.mkdir(path.join(tmpDataPath, "server1", "myworld"), { recursive: true });
      await fs.writeFile(path.join(tmpDataPath, "server1", "server.properties"), "level-name=myworld\nmotd=Hi\n");
      const root = await resolveWorldRoot(makeServer());
      expect(root).toBe(path.join(tmpDataPath, "server1", "myworld"));
    });
  });

  describe("readStats", () => {
    it("reads and maps a real stats/<uuid>.json file", async () => {
      const uuid = "abc-123";
      await fs.writeFile(
        path.join(tmpDataPath, "server1", "world", "stats", `${uuid}.json`),
        JSON.stringify({ stats: { "minecraft:custom": { "minecraft:play_time": 200 } } }),
      );
      const service = new PlayerDataService(makeFakePrisma());
      const stats = await service.readStats(makeServer(), uuid);
      expect(stats?.playtimeSeconds).toBe(10);
    });

    it("returns null when the stats file doesn't exist", async () => {
      const service = new PlayerDataService(makeFakePrisma());
      const stats = await service.readStats(makeServer(), "nonexistent-uuid");
      expect(stats).toBeNull();
    });

    it("falls back to Paper's world/players/stats layout when the vanilla flat layout has no file (confirmed against a real Paper server)", async () => {
      const uuid = "paper-uuid";
      await fs.mkdir(path.join(tmpDataPath, "server1", "world", "players", "stats"), { recursive: true });
      await fs.writeFile(
        path.join(tmpDataPath, "server1", "world", "players", "stats", `${uuid}.json`),
        JSON.stringify({ stats: { "minecraft:custom": { "minecraft:play_time": 400 } } }),
      );
      const service = new PlayerDataService(makeFakePrisma());
      const stats = await service.readStats(makeServer(), uuid);
      expect(stats?.playtimeSeconds).toBe(20);
    });
  });

  describe("readGamemode", () => {
    it("parses playerGameType out of a real NBT playerdata file", async () => {
      const uuid = "abc-123";
      const tag = nbt.comp({ playerGameType: nbt.int(1) }, ""); // 1 = Creative
      const buffer = nbt.writeUncompressed(tag as unknown as nbt.NBT);
      await fs.writeFile(path.join(tmpDataPath, "server1", "world", "playerdata", `${uuid}.dat`), buffer);

      const service = new PlayerDataService(makeFakePrisma());
      const result = await service.readGamemode(makeServer(), uuid);
      expect(result.gamemode).toBe("CREATIVE");
    });

    it("returns null gamemode when the playerdata file doesn't exist", async () => {
      const service = new PlayerDataService(makeFakePrisma());
      const result = await service.readGamemode(makeServer(), "nonexistent-uuid");
      expect(result.gamemode).toBeNull();
    });

    it("falls back to Paper's world/players/data layout when the vanilla flat layout has no file", async () => {
      const uuid = "paper-uuid-2";
      const tag = nbt.comp({ playerGameType: nbt.int(3) }, ""); // 3 = Spectator
      const buffer = nbt.writeUncompressed(tag as unknown as nbt.NBT);
      await fs.mkdir(path.join(tmpDataPath, "server1", "world", "players", "data"), { recursive: true });
      await fs.writeFile(path.join(tmpDataPath, "server1", "world", "players", "data", `${uuid}.dat`), buffer);

      const service = new PlayerDataService(makeFakePrisma());
      const result = await service.readGamemode(makeServer(), uuid);
      expect(result.gamemode).toBe("SPECTATOR");
    });
  });

  describe("resolveUuid", () => {
    it("prefers the tracked PlayerProfile's uuid when present", async () => {
      const service = new PlayerDataService(makeFakePrisma("tracked-uuid"));
      const uuid = await service.resolveUuid(makeServer(), "Steve");
      expect(uuid).toBe("tracked-uuid");
    });

    it("falls back to usercache.json when no PlayerProfile is tracked yet", async () => {
      await fs.writeFile(
        path.join(tmpDataPath, "server1", "usercache.json"),
        JSON.stringify([{ name: "Steve", uuid: "cache-uuid" }]),
      );
      const service = new PlayerDataService(makeFakePrisma(null));
      const uuid = await service.resolveUuid(makeServer(), "Steve");
      expect(uuid).toBe("cache-uuid");
    });

    it("returns null when the player is unknown everywhere", async () => {
      const service = new PlayerDataService(makeFakePrisma(null));
      const uuid = await service.resolveUuid(makeServer(), "Nobody");
      expect(uuid).toBeNull();
    });
  });
});
