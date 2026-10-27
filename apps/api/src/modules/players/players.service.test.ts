import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "@prisma/client";
import { PlayerService } from "./players.service.js";

// PlayerService resolves ops.json/whitelist.json/etc. via DATA_PATH + a
// server's dataDir; point DATA_PATH at a fresh temp directory per test, same
// convention as files.service.test.ts / modrinth.service.test.ts.
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

interface FakeProfileRow {
  username: string;
  uuid: string | null;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  lastIp: string | null;
  totalPlaytimeSeconds: number;
  currentSessionStartedAt: Date | null;
}

function makeFakePrisma(profiles: FakeProfileRow[]) {
  return {
    playerProfile: {
      findMany: vi.fn(async () => profiles),
      findUnique: vi.fn(async ({ where }: { where: { serverId_usernameLower: { usernameLower: string } } }) => {
        const match = profiles.find((p) => p.username.toLowerCase() === where.serverId_usernameLower.usernameLower);
        return match ?? null;
      }),
    },
     
  } as any;
}

function makeFakeManager(sendCommand: (serverId: string, command: string) => Promise<string>) {
   
  return { sendCommand: vi.fn(sendCommand) } as any;
}

function makeServer(overrides: Partial<Server> = {}): Server {
  return {
    id: "srv-1",
    name: "Test",
    description: null,
    software: "VANILLA",
    mcVersion: "1.21.1",
    buildVersion: null,
    containerId: "abc",
    containerName: "latticore-test",
    port: 25565,
    memoryMb: 2048,
    cpuCores: 2,
    diskLimitMb: null,
    status: "RUNNING",
    statusDetail: null,
    dataDir: "server1",
    eulaAccepted: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
     
  } as any as Server;
}

describe("PlayerService", () => {
  let tmpDataPath: string;

  beforeEach(async () => {
    tmpDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "latticore-players-"));
    globalThis.__TEST_DATA_PATH__ = tmpDataPath;
    await fs.mkdir(path.join(tmpDataPath, "server1"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDataPath, { recursive: true, force: true });
  });

  describe("list", () => {
    it("merges tracked activity (firstSeen/lastSeen/playtime/IP) onto the live roster by username", async () => {
      await fs.writeFile(path.join(tmpDataPath, "server1", "usercache.json"), JSON.stringify([{ name: "Steve", uuid: "uuid-steve" }]));
      await fs.writeFile(path.join(tmpDataPath, "server1", "ops.json"), "[]");
      await fs.writeFile(path.join(tmpDataPath, "server1", "whitelist.json"), "[]");
      await fs.writeFile(path.join(tmpDataPath, "server1", "banned-players.json"), "[]");

      const manager = makeFakeManager(async (_id, cmd) => (cmd === "list" ? "There are 1 of a max of 20 players online: Steve" : ""));
      const firstSeenAt = new Date("2024-01-01T00:00:00Z");
      const lastSeenAt = new Date("2024-06-01T00:00:00Z");
      const prisma = makeFakePrisma([
        {
          username: "Steve",
          uuid: "uuid-steve",
          firstSeenAt,
          lastSeenAt,
          lastIp: "203.0.113.11",
          totalPlaytimeSeconds: 3600,
          currentSessionStartedAt: null,
        },
      ]);

      const service = new PlayerService(manager, prisma);
      const players = await service.list(makeServer());

      expect(players).toHaveLength(1);
      const steve = players[0]!;
      expect(steve.username).toBe("Steve");
      expect(steve.online).toBe(true);
      expect(steve.firstSeenAt).toBe(firstSeenAt.toISOString());
      expect(steve.lastSeenAt).toBe(lastSeenAt.toISOString());
      expect(steve.lastIp).toBe("203.0.113.11");
      expect(steve.playtimeSeconds).toBe(3600);
    });

    it("adds live elapsed time for a currently-open session on top of the stored total", async () => {
      await fs.writeFile(path.join(tmpDataPath, "server1", "usercache.json"), "[]");
      await fs.writeFile(path.join(tmpDataPath, "server1", "ops.json"), "[]");
      await fs.writeFile(path.join(tmpDataPath, "server1", "whitelist.json"), "[]");
      await fs.writeFile(path.join(tmpDataPath, "server1", "banned-players.json"), "[]");

      const manager = makeFakeManager(async (_id, cmd) => (cmd === "list" ? "There are 1 of a max of 20 players online: Steve" : ""));
      const currentSessionStartedAt = new Date(Date.now() - 120_000); // 2 minutes ago
      const prisma = makeFakePrisma([
        {
          username: "Steve",
          uuid: null,
          firstSeenAt: currentSessionStartedAt,
          lastSeenAt: currentSessionStartedAt,
          lastIp: null,
          totalPlaytimeSeconds: 100,
          currentSessionStartedAt,
        },
      ]);

      const service = new PlayerService(manager, prisma);
      const players = await service.list(makeServer());

      const steve = players.find((p) => p.username === "Steve")!;
      // 100s stored + ~120s elapsed since the open session started
      expect(steve.playtimeSeconds).toBeGreaterThanOrEqual(215);
      expect(steve.playtimeSeconds).toBeLessThanOrEqual(225);
    });

    it("leaves firstSeen/lastSeen/playtime/IP at their empty defaults for a player with no tracked profile", async () => {
      await fs.writeFile(path.join(tmpDataPath, "server1", "usercache.json"), JSON.stringify([{ name: "Alex", uuid: "uuid-alex" }]));
      await fs.writeFile(path.join(tmpDataPath, "server1", "ops.json"), "[]");
      await fs.writeFile(path.join(tmpDataPath, "server1", "whitelist.json"), "[]");
      await fs.writeFile(path.join(tmpDataPath, "server1", "banned-players.json"), "[]");

      const manager = makeFakeManager(async (_id, cmd) => (cmd === "list" ? "There are 0 of a max of 20 players online:" : ""));
      const prisma = makeFakePrisma([]);

      const service = new PlayerService(manager, prisma);
      const players = await service.list(makeServer());

      const alex = players.find((p) => p.username === "Alex")!;
      expect(alex.firstSeenAt).toBeNull();
      expect(alex.lastSeenAt).toBeNull();
      expect(alex.lastIp).toBeNull();
      expect(alex.playtimeSeconds).toBe(0);
    });
  });

  describe("message", () => {
    it("sends a `tell` RCON command with a sanitized message", async () => {
      const manager = makeFakeManager(async () => "");
      const prisma = makeFakePrisma([]);
      const service = new PlayerService(manager, prisma);

      await service.message(makeServer(), "Steve", "Hello there\nfriend");

      expect(manager.sendCommand).toHaveBeenCalledWith("srv-1", "tell Steve Hello there friend", { silent: true });
    });

    it("rejects an invalid username", async () => {
      const manager = makeFakeManager(async () => "");
      const prisma = makeFakePrisma([]);
      const service = new PlayerService(manager, prisma);

      await expect(service.message(makeServer(), "not a valid name", "hi")).rejects.toThrow();
    });

    it("refuses to message a player when the server isn't running", async () => {
      const manager = makeFakeManager(async () => "");
      const prisma = makeFakePrisma([]);
      const service = new PlayerService(manager, prisma);

      await expect(service.message(makeServer({ status: "STOPPED" }), "Steve", "hi")).rejects.toThrow();
    });
  });

  describe("op/whitelist/ban while the server is RUNNING", () => {
    it("op/deop/whitelistAdd/whitelistRemove/ban/unban all go through RCON", async () => {
      const manager = makeFakeManager(async () => "");
      const prisma = makeFakePrisma([]);
      const service = new PlayerService(manager, prisma);
      const server = makeServer({ status: "RUNNING" });

      await service.op(server, "Steve");
      await service.deop(server, "Steve");
      await service.whitelistAdd(server, "Steve");
      await service.whitelistRemove(server, "Steve");
      await service.ban(server, "Steve", "Griefing");
      await service.unban(server, "Steve");

      expect(manager.sendCommand).toHaveBeenCalledWith("srv-1", "op Steve", { silent: true });
      expect(manager.sendCommand).toHaveBeenCalledWith("srv-1", "deop Steve", { silent: true });
      expect(manager.sendCommand).toHaveBeenCalledWith("srv-1", "whitelist add Steve", { silent: true });
      expect(manager.sendCommand).toHaveBeenCalledWith("srv-1", "whitelist remove Steve", { silent: true });
      expect(manager.sendCommand).toHaveBeenCalledWith("srv-1", "ban Steve Griefing", { silent: true });
      expect(manager.sendCommand).toHaveBeenCalledWith("srv-1", "pardon Steve", { silent: true });
    });
  });

  describe("op/whitelist/ban while the server is STOPPED (direct file edits)", () => {
    const uuid = "uuid-steve";

    beforeEach(async () => {
      await fs.writeFile(path.join(tmpDataPath, "server1", "usercache.json"), JSON.stringify([{ name: "Steve", uuid }]));
    });

    it("op writes an ops.json entry, deop removes it", async () => {
      const manager = makeFakeManager(async () => {
        throw new Error("RCON should never be called while stopped");
      });
      const prisma = makeFakePrisma([]);
      const service = new PlayerService(manager, prisma);
      const server = makeServer({ status: "STOPPED" });

      await service.op(server, "Steve");
      let ops = JSON.parse(await fs.readFile(path.join(tmpDataPath, "server1", "ops.json"), "utf8"));
      expect(ops).toEqual([{ uuid, name: "Steve", level: 4, bypassesPlayerLimit: false }]);

      await service.deop(server, "Steve");
      ops = JSON.parse(await fs.readFile(path.join(tmpDataPath, "server1", "ops.json"), "utf8"));
      expect(ops).toEqual([]);
    });

    it("whitelistAdd writes a whitelist.json entry, whitelistRemove removes it", async () => {
      const manager = makeFakeManager(async () => {
        throw new Error("RCON should never be called while stopped");
      });
      const prisma = makeFakePrisma([]);
      const service = new PlayerService(manager, prisma);
      const server = makeServer({ status: "STOPPED" });

      await service.whitelistAdd(server, "Steve");
      let whitelist = JSON.parse(await fs.readFile(path.join(tmpDataPath, "server1", "whitelist.json"), "utf8"));
      expect(whitelist).toEqual([{ uuid, name: "Steve" }]);

      await service.whitelistRemove(server, "Steve");
      whitelist = JSON.parse(await fs.readFile(path.join(tmpDataPath, "server1", "whitelist.json"), "utf8"));
      expect(whitelist).toEqual([]);
    });

    it("ban writes a permanent banned-players.json entry with the reason, unban removes it", async () => {
      const manager = makeFakeManager(async () => {
        throw new Error("RCON should never be called while stopped");
      });
      const prisma = makeFakePrisma([]);
      const service = new PlayerService(manager, prisma);
      const server = makeServer({ status: "STOPPED" });

      await service.ban(server, "Steve", "Griefing");
      let banned = JSON.parse(await fs.readFile(path.join(tmpDataPath, "server1", "banned-players.json"), "utf8"));
      expect(banned).toHaveLength(1);
      expect(banned[0]).toMatchObject({ uuid, name: "Steve", expires: "forever", reason: "Griefing" });

      await service.unban(server, "Steve");
      banned = JSON.parse(await fs.readFile(path.join(tmpDataPath, "server1", "banned-players.json"), "utf8"));
      expect(banned).toEqual([]);
    });

    it("rejects op/whitelist/ban when the player's UUID isn't known yet", async () => {
      await fs.writeFile(path.join(tmpDataPath, "server1", "usercache.json"), "[]");
      const manager = makeFakeManager(async () => "");
      const prisma = makeFakePrisma([]);
      const service = new PlayerService(manager, prisma);
      const server = makeServer({ status: "STOPPED" });

      await expect(service.op(server, "Unknown")).rejects.toThrow();
      await expect(service.whitelistAdd(server, "Unknown")).rejects.toThrow();
      await expect(service.ban(server, "Unknown")).rejects.toThrow();
    });
  });

  describe("wipe", () => {
    it("deletes stats/playerdata files under the vanilla flat layout (world/stats, world/playerdata)", async () => {
      const uuid = "uuid-steve";
      await fs.mkdir(path.join(tmpDataPath, "server1", "world", "stats"), { recursive: true });
      await fs.mkdir(path.join(tmpDataPath, "server1", "world", "playerdata"), { recursive: true });
      await fs.writeFile(path.join(tmpDataPath, "server1", "world", "stats", `${uuid}.json`), "{}");
      await fs.writeFile(path.join(tmpDataPath, "server1", "world", "playerdata", `${uuid}.dat`), "x");

      const manager = makeFakeManager(async (_id, cmd) => (cmd === "list" ? "There are 0 of a max of 20 players online:" : ""));
      const prisma = makeFakePrisma([{ username: "Steve", uuid, firstSeenAt: null, lastSeenAt: null, lastIp: null, totalPlaytimeSeconds: 0, currentSessionStartedAt: null }]);
      const service = new PlayerService(manager, prisma);

      await service.wipe(makeServer({ status: "STOPPED" }), "Steve");

      const statsExists = await fs.stat(path.join(tmpDataPath, "server1", "world", "stats", `${uuid}.json`)).catch(() => null);
      const dataExists = await fs.stat(path.join(tmpDataPath, "server1", "world", "playerdata", `${uuid}.dat`)).catch(() => null);
      expect(statsExists).toBeNull();
      expect(dataExists).toBeNull();
    });

    it("deletes stats/playerdata files under Paper's world/players/{stats,data} layout too", async () => {
      const uuid = "uuid-steve";
      await fs.mkdir(path.join(tmpDataPath, "server1", "world", "players", "stats"), { recursive: true });
      await fs.mkdir(path.join(tmpDataPath, "server1", "world", "players", "data"), { recursive: true });
      await fs.writeFile(path.join(tmpDataPath, "server1", "world", "players", "stats", `${uuid}.json`), "{}");
      await fs.writeFile(path.join(tmpDataPath, "server1", "world", "players", "data", `${uuid}.dat`), "x");

      const manager = makeFakeManager(async (_id, cmd) => (cmd === "list" ? "There are 0 of a max of 20 players online:" : ""));
      const prisma = makeFakePrisma([{ username: "Steve", uuid, firstSeenAt: null, lastSeenAt: null, lastIp: null, totalPlaytimeSeconds: 0, currentSessionStartedAt: null }]);
      const service = new PlayerService(manager, prisma);

      await service.wipe(makeServer({ status: "STOPPED" }), "Steve");

      const statsExists = await fs.stat(path.join(tmpDataPath, "server1", "world", "players", "stats", `${uuid}.json`)).catch(() => null);
      const dataExists = await fs.stat(path.join(tmpDataPath, "server1", "world", "players", "data", `${uuid}.dat`)).catch(() => null);
      expect(statsExists).toBeNull();
      expect(dataExists).toBeNull();
    });

    it("kicks the player first when they're currently online", async () => {
      const uuid = "uuid-steve";
      await fs.mkdir(path.join(tmpDataPath, "server1", "world", "stats"), { recursive: true });
      const manager = makeFakeManager(async (_id, cmd) => (cmd === "list" ? "There are 1 of a max of 20 players online: Steve" : ""));
      const prisma = makeFakePrisma([{ username: "Steve", uuid, firstSeenAt: null, lastSeenAt: null, lastIp: null, totalPlaytimeSeconds: 0, currentSessionStartedAt: null }]);
      const service = new PlayerService(manager, prisma);

      await service.wipe(makeServer({ status: "RUNNING" }), "Steve");

      expect(manager.sendCommand).toHaveBeenCalledWith("srv-1", expect.stringContaining("kick Steve"), { silent: true });
    });

    it("rejects when no UUID is known for the player", async () => {
      const manager = makeFakeManager(async () => "");
      const prisma = makeFakePrisma([]);
      const service = new PlayerService(manager, prisma);

      await expect(service.wipe(makeServer(), "Unknown")).rejects.toThrow();
    });
  });
});
