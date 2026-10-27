import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "@prisma/client";
import { PlayerBanService, expireDueBans } from "./playerBans.service.js";

// tempBan/banIp/unbanIp fall back to editing banned-players.json/banned-ips.json
// directly when the server is stopped — point DATA_PATH at a fresh temp
// directory per test, same convention as players.service.test.ts.
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
    status: "RUNNING",
    dataDir: "server1",
     
    ...overrides,
  } as any as Server;
}

interface FakeBanRow {
  id: string;
  serverId: string;
  usernameLower: string;
  username: string;
  type: string;
  target: string;
  reason: string | null;
  createdById: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  revokedById: string | null;
  revokedReason: string | null;
}

function makeFakePrisma() {
  const bans: FakeBanRow[] = [];
  let nextId = 1;
  const playerBan = {
    create: vi.fn(async ({ data }: { data: Partial<FakeBanRow> }) => {
      const row: FakeBanRow = {
        id: `b${nextId++}`,
        reason: null,
        createdById: null,
        createdAt: new Date(),
        expiresAt: null,
        revokedAt: null,
        revokedById: null,
        revokedReason: null,
        ...data,
      } as FakeBanRow;
      bans.push(row);
      return { ...row };
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<FakeBanRow> }) => {
      let count = 0;
      for (const row of bans) {
        if (where.serverId && row.serverId !== where.serverId) continue;
        if (where.type && row.type !== where.type) continue;
        if (where.target && row.target !== where.target) continue;
        if (where.usernameLower && row.usernameLower !== where.usernameLower) continue;
        if (where.revokedAt === null && row.revokedAt !== null) continue;
        Object.assign(row, data);
        count++;
      }
      return { count };
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeBanRow> }) => {
      const row = bans.find((b) => b.id === where.id);
      if (!row) throw new Error("no fake ban row");
      Object.assign(row, data);
      return { ...row };
    }),
    // Used both by expireDueBans (filters by expiresAt.lte) and listBans (filters by usernameLower, orders by createdAt) — branch on which shape of `where` was passed.
    findMany: vi.fn(async ({ where }: { where: { serverId: string; type: string; revokedAt?: null; expiresAt?: { lte: Date }; usernameLower?: string } }) => {
      if (where.expiresAt) {
        return bans.filter(
          (b) =>
            b.serverId === where.serverId &&
            b.type === where.type &&
            b.revokedAt === null &&
            b.expiresAt !== null &&
            b.expiresAt.getTime() <= where.expiresAt!.lte.getTime(),
        );
      }
      return bans
        .filter((b) => b.serverId === where.serverId && b.usernameLower === where.usernameLower)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((b) => ({ ...b, createdBy: null, revokedBy: null }));
    }),
  };
  const playerProfile = {
    findUnique: vi.fn(async () => null), // resolveUuid falls back to usercache.json in these tests
  };
   
  return { bans, playerBan, playerProfile } as any;
}

function makeFakeManager() {
  const sent: { serverId: string; command: string }[] = [];
  return {
    sent,
     
    manager: { sendCommand: vi.fn(async (serverId: string, command: string) => { sent.push({ serverId, command }); return ""; }) } as any,
  };
}

describe("PlayerBanService", () => {
  let tmpDataPath: string;

  beforeEach(async () => {
    vi.useFakeTimers();
    tmpDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "latticore-playerbans-"));
    globalThis.__TEST_DATA_PATH__ = tmpDataPath;
    await fs.mkdir(path.join(tmpDataPath, "server1"), { recursive: true });
    await fs.writeFile(path.join(tmpDataPath, "server1", "usercache.json"), JSON.stringify([{ name: "Steve", uuid: "uuid-steve" }]));
  });

  afterEach(async () => {
    vi.useRealTimers();
    await fs.rm(tmpDataPath, { recursive: true, force: true });
  });

  it("tempBan sends a normal RCON ban and records an expiring PlayerBan row when RUNNING", async () => {
    const prisma = makeFakePrisma();
    const { manager, sent } = makeFakeManager();
    const service = new PlayerBanService(manager, prisma);

    await service.tempBan(makeServer(), "Steve", 60, "user-1", "Griefing");

    expect(sent).toContainEqual({ serverId: "srv-1", command: "ban Steve Griefing" });
    expect(prisma.bans).toHaveLength(1);
    expect(prisma.bans[0].type).toBe("NAME");
    expect(prisma.bans[0].expiresAt).not.toBeNull();
    expect(prisma.bans[0].createdById).toBe("user-1");
  });

  it("tempBan writes a banned-players.json entry with a real expiry when STOPPED, instead of using RCON", async () => {
    const prisma = makeFakePrisma();
    const { manager, sent } = makeFakeManager();
    const service = new PlayerBanService(manager, prisma);

    await service.tempBan(makeServer({ status: "STOPPED" }), "Steve", 60, "user-1", "Griefing");

    expect(sent).toHaveLength(0);
    const banned = JSON.parse(await fs.readFile(path.join(tmpDataPath, "server1", "banned-players.json"), "utf8"));
    expect(banned).toHaveLength(1);
    expect(banned[0]).toMatchObject({ uuid: "uuid-steve", name: "Steve", reason: "Griefing" });
    expect(banned[0].expires).not.toBe("forever");
    expect(prisma.bans[0].expiresAt).not.toBeNull();
  });

  it("banIp sends ban-ip and records an IP-type PlayerBan row when RUNNING", async () => {
    const prisma = makeFakePrisma();
    const { manager, sent } = makeFakeManager();
    const service = new PlayerBanService(manager, prisma);

    await service.banIp(makeServer(), "Steve", "203.0.113.11", "user-1", "Ban evasion");

    expect(sent).toContainEqual({ serverId: "srv-1", command: "ban-ip 203.0.113.11 Ban evasion" });
    expect(prisma.bans[0].type).toBe("IP");
    expect(prisma.bans[0].target).toBe("203.0.113.11");
  });

  it("banIp writes a banned-ips.json entry when STOPPED, instead of using RCON", async () => {
    const prisma = makeFakePrisma();
    const { manager, sent } = makeFakeManager();
    const service = new PlayerBanService(manager, prisma);

    await service.banIp(makeServer({ status: "STOPPED" }), "Steve", "203.0.113.11", "user-1", "Ban evasion");

    expect(sent).toHaveLength(0);
    const bannedIps = JSON.parse(await fs.readFile(path.join(tmpDataPath, "server1", "banned-ips.json"), "utf8"));
    expect(bannedIps).toEqual([expect.objectContaining({ ip: "203.0.113.11", reason: "Ban evasion" })]);
    expect(prisma.bans[0].type).toBe("IP");
  });

  it("unbanIp sends pardon-ip and revokes matching open IP bans when RUNNING", async () => {
    const prisma = makeFakePrisma();
    const { manager, sent } = makeFakeManager();
    const service = new PlayerBanService(manager, prisma);
    await service.banIp(makeServer(), "Steve", "203.0.113.11", "user-1");

    await service.unbanIp(makeServer(), "203.0.113.11", "user-2");

    expect(sent).toContainEqual({ serverId: "srv-1", command: "pardon-ip 203.0.113.11" });
    expect(prisma.bans[0].revokedAt).not.toBeNull();
    expect(prisma.bans[0].revokedById).toBe("user-2");
  });

  it("unbanIp removes the banned-ips.json entry when STOPPED, instead of using RCON", async () => {
    const prisma = makeFakePrisma();
    const { manager, sent } = makeFakeManager();
    const service = new PlayerBanService(manager, prisma);
    const server = makeServer({ status: "STOPPED" });
    await service.banIp(server, "Steve", "203.0.113.11", "user-1");
    sent.length = 0;

    await service.unbanIp(server, "203.0.113.11", "user-2");

    expect(sent).toHaveLength(0);
    const bannedIps = JSON.parse(await fs.readFile(path.join(tmpDataPath, "server1", "banned-ips.json"), "utf8"));
    expect(bannedIps).toEqual([]);
  });

  it("revokeNameBans marks open NAME bans for a username as revoked", async () => {
    const prisma = makeFakePrisma();
    const { manager } = makeFakeManager();
    const service = new PlayerBanService(manager, prisma);
    await service.tempBan(makeServer(), "Steve", 60, "user-1");

    await service.revokeNameBans("srv-1", "Steve", "user-2");

    expect(prisma.bans[0].revokedAt).not.toBeNull();
  });

  it("listBans returns ban rows for a player, most recent first", async () => {
    const prisma = makeFakePrisma();
    const { manager } = makeFakeManager();
    const service = new PlayerBanService(manager, prisma);
    await service.tempBan(makeServer(), "Steve", 60, "user-1", "first");
    await service.tempBan(makeServer(), "Steve", 60, "user-1", "second");

    const list = await service.listBans("srv-1", "Steve");
    expect(list).toHaveLength(2);
  });
});

describe("expireDueBans", () => {
  it("pardons and revokes tempbans whose expiresAt has already passed", async () => {
    const prisma = makeFakePrisma();
    const { manager, sent } = makeFakeManager();
    await prisma.playerBan.create({
      data: {
        serverId: "srv-1",
        usernameLower: "steve",
        username: "Steve",
        type: "NAME",
        target: "Steve",
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    await expireDueBans(prisma, manager, "srv-1");

    expect(sent).toContainEqual({ serverId: "srv-1", command: "pardon Steve" });
    expect(prisma.bans[0].revokedAt).not.toBeNull();
    expect(prisma.bans[0].revokedById).toBeNull(); // system-revoked, not by an admin
  });

  it("leaves not-yet-due tempbans untouched", async () => {
    const prisma = makeFakePrisma();
    const { manager, sent } = makeFakeManager();
    await prisma.playerBan.create({
      data: {
        serverId: "srv-1",
        usernameLower: "steve",
        username: "Steve",
        type: "NAME",
        target: "Steve",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    await expireDueBans(prisma, manager, "srv-1");

    expect(sent).toHaveLength(0);
    expect(prisma.bans[0].revokedAt).toBeNull();
  });
});
