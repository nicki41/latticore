import { EventEmitter } from "node:events";
import type { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlayerActivityTracker, type PlayerActivityManager } from "./PlayerActivityTracker.js";

interface FakeProfileRow {
  id: string;
  serverId: string;
  usernameLower: string;
  username: string;
  uuid: string | null;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  lastIp: string | null;
  totalPlaytimeSeconds: number;
  currentSessionStartedAt: Date | null;
}

interface FakeSessionRow {
  id: string;
  serverId: string;
  usernameLower: string;
  startedAt: Date;
  endedAt: Date | null;
  durationSeconds: number | null;
}

interface FakeNameHistoryRow {
  id: string;
  serverId: string;
  uuid: string;
  username: string;
  changedAt: Date;
}

interface FakeIpHistoryRow {
  id: string;
  serverId: string;
  usernameLower: string;
  ip: string;
  seenAt: Date;
}

interface FakeBanRow {
  id: string;
  serverId: string;
  usernameLower: string;
  username: string;
  type: string;
  target: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  revokedById: string | null;
}

function makeFakePrisma(runningServerIds: string[] = []) {
  const rows = new Map<string, FakeProfileRow>();
  const sessions: FakeSessionRow[] = [];
  const nameHistory: FakeNameHistoryRow[] = [];
  const ipHistory: FakeIpHistoryRow[] = [];
  const bans: FakeBanRow[] = [];
  let nextId = 1;

  function key(serverId: string, usernameLower: string) {
    return `${serverId}:${usernameLower}`;
  }

  const playerProfile = {
    findUnique: vi.fn(async ({ where }: { where: { serverId_usernameLower: { serverId: string; usernameLower: string } } }) => {
      const row = rows.get(key(where.serverId_usernameLower.serverId, where.serverId_usernameLower.usernameLower));
      return row ? { ...row } : null;
    }),
    findFirst: vi.fn(
      async ({ where }: { where: { serverId: string; uuid: string; usernameLower?: { not: string } } }) => {
        const match = [...rows.values()].find(
          (r) => r.serverId === where.serverId && r.uuid === where.uuid && (!where.usernameLower || r.usernameLower !== where.usernameLower.not),
        );
        return match ? { ...match } : null;
      },
    ),
    findMany: vi.fn(async ({ where }: { where: { serverId: string; currentSessionStartedAt?: { not: null } } }) => {
      return [...rows.values()].filter((r) => {
        if (r.serverId !== where.serverId) return false;
        if (where.currentSessionStartedAt && r.currentSessionStartedAt === null) return false;
        return true;
      });
    }),
    upsert: vi.fn(
      async ({
        where,
        create,
        update,
      }: {
        where: { serverId_usernameLower: { serverId: string; usernameLower: string } };
        create: Partial<FakeProfileRow> & { serverId: string; usernameLower: string; username: string };
        update: Partial<FakeProfileRow>;
      }) => {
        const k = key(where.serverId_usernameLower.serverId, where.serverId_usernameLower.usernameLower);
        const existing = rows.get(k);
        if (!existing) {
          const row: FakeProfileRow = {
            id: `p${nextId++}`,
            uuid: null,
            firstSeenAt: null,
            lastSeenAt: null,
            lastIp: null,
            totalPlaytimeSeconds: 0,
            currentSessionStartedAt: null,
            ...create,
          } as FakeProfileRow;
          rows.set(k, row);
          return { ...row };
        }
        const updated = { ...existing, ...update };
        rows.set(k, updated);
        return { ...updated };
      },
    ),
    update: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { id?: string; serverId_usernameLower?: { serverId: string; usernameLower: string } };
        data: Partial<FakeProfileRow>;
      }) => {
        const row = where.id
          ? [...rows.values()].find((r) => r.id === where.id)
          : where.serverId_usernameLower
            ? rows.get(key(where.serverId_usernameLower.serverId, where.serverId_usernameLower.usernameLower))
            : undefined;
        if (!row) throw new Error("No matching fake row for update()");
        const updated = { ...row, ...data };
        rows.set(key(updated.serverId, updated.usernameLower), updated);
        return { ...updated };
      },
    ),
  };

  const playerSession = {
    create: vi.fn(async ({ data }: { data: { serverId: string; usernameLower: string; startedAt: Date } }) => {
      const row: FakeSessionRow = { id: `s${nextId++}`, endedAt: null, durationSeconds: null, ...data };
      sessions.push(row);
      return { ...row };
    }),
    findFirst: vi.fn(async ({ where }: { where: { serverId: string; usernameLower: string; endedAt: null } }) => {
      const matches = sessions
        .filter((s) => s.serverId === where.serverId && s.usernameLower === where.usernameLower && s.endedAt === null)
        .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
      return matches[0] ? { ...matches[0] } : null;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeSessionRow> }) => {
      const row = sessions.find((s) => s.id === where.id);
      if (!row) throw new Error("No matching fake session row");
      Object.assign(row, data);
      return { ...row };
    }),
  };

  const playerNameHistory = {
    create: vi.fn(async ({ data }: { data: { serverId: string; uuid: string; username: string } }) => {
      const row: FakeNameHistoryRow = { id: `n${nextId++}`, changedAt: new Date(), ...data };
      nameHistory.push(row);
      return { ...row };
    }),
  };

  const playerIpHistory = {
    findFirst: vi.fn(async ({ where }: { where: { serverId: string; usernameLower: string } }) => {
      const matches = ipHistory
        .filter((r) => r.serverId === where.serverId && r.usernameLower === where.usernameLower)
        .sort((a, b) => b.seenAt.getTime() - a.seenAt.getTime());
      return matches[0] ? { ...matches[0] } : null;
    }),
    create: vi.fn(async ({ data }: { data: { serverId: string; usernameLower: string; ip: string } }) => {
      const row: FakeIpHistoryRow = { id: `i${nextId++}`, seenAt: new Date(), ...data };
      ipHistory.push(row);
      return { ...row };
    }),
  };

  const playerBan = {
    findMany: vi.fn(async ({ where }: { where: { serverId: string; type: string; revokedAt: null; expiresAt: { lte: Date } } }) => {
      return bans
        .filter(
          (b) =>
            b.serverId === where.serverId &&
            b.type === where.type &&
            b.revokedAt === null &&
            b.expiresAt !== null &&
            b.expiresAt.getTime() <= where.expiresAt.lte.getTime(),
        )
        .map((b) => ({ ...b }));
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeBanRow> }) => {
      const row = bans.find((b) => b.id === where.id);
      if (!row) throw new Error("No matching fake ban row");
      Object.assign(row, data);
      return { ...row };
    }),
    _seed: (row: Omit<FakeBanRow, "id">) => {
      const full: FakeBanRow = { id: `b${nextId++}`, ...row };
      bans.push(full);
      return full;
    },
  };

  const server = {
    findMany: vi.fn(async () => runningServerIds.map((id) => ({ id }))),
    // Every fake server is a regular game server unless its id says it's a proxy.
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ software: where.id.startsWith("proxy") ? "VELOCITY" : "PAPER" })),
  };

  return {
    rows,
    sessions,
    nameHistory,
    ipHistory,
    bans,
    playerProfile,
    playerSession,
    playerNameHistory,
    playerIpHistory,
    playerBan,
    server,
  } as unknown as import("@prisma/client").PrismaClient & {
    rows: Map<string, FakeProfileRow>;
    sessions: FakeSessionRow[];
    nameHistory: FakeNameHistoryRow[];
    ipHistory: FakeIpHistoryRow[];
    bans: FakeBanRow[];
    playerBan: typeof playerBan;
  };
}

class FakeLogStream extends EventEmitter {
  destroyed = false;
  destroy() {
    this.destroyed = true;
  }
}

function makeFakeManager(streamsByServer: Map<string, FakeLogStream>, listResponses: Map<string, string>) {
  const emitter = new EventEmitter();
  const sentCommands: { serverId: string; command: string }[] = [];
  const manager: PlayerActivityManager = {
    on: (event, listener) => emitter.on(event, listener),
    off: (event, listener) => emitter.off(event, listener),
    getLogStream: vi.fn(async (serverId: string) => {
      const stream = streamsByServer.get(serverId) ?? new FakeLogStream();
      streamsByServer.set(serverId, stream);
      return stream as unknown as Readable;
    }),
    sendCommand: vi.fn(async (serverId: string, command: string) => {
      sentCommands.push({ serverId, command });
      if (command === "list") {
        const response = listResponses.get(serverId);
        if (response === undefined) throw new Error("RCON not ready");
        return response;
      }
      return "";
    }),
  };
  return { manager, sentCommands, emitStatus: (serverId: string, status: string) => emitter.emit("status", serverId, status) };
}

async function flush() {
  // Lets the tracker's fire-and-forget `void this.recordX(...)` promise chains (all synchronous fake-prisma resolutions) settle.
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/** Waits until the tracker has actually attached its "data" listener to the stream (several microtask hops after start()/ensureTracking() — reconcile + getLogStream both await fake-but-async prisma/manager calls first). */
async function waitForListener(stream: FakeLogStream): Promise<void> {
  for (let i = 0; i < 50 && stream.listenerCount("data") === 0; i++) await Promise.resolve();
}

describe("PlayerActivityTracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens a log stream and reconciles for every already-RUNNING server on start", async () => {
    const prisma = makeFakePrisma(["srv-1"]);
    const streams = new Map<string, FakeLogStream>();
    const { manager } = makeFakeManager(streams, new Map([["srv-1", "There are 0 of a max of 20 players online:"]]));
    const tracker = new PlayerActivityTracker(prisma, manager);

    tracker.start();
    await flush();

    expect(manager.getLogStream).toHaveBeenCalledWith("srv-1", { tail: 0 });
    tracker.stop();
  });

  it("never tracks a proxy — its players are recorded on the backends", async () => {
    const prisma = makeFakePrisma([]);
    const streams = new Map<string, FakeLogStream>();
    const { manager, sentCommands, emitStatus } = makeFakeManager(streams, new Map());
    const tracker = new PlayerActivityTracker(prisma, manager);

    tracker.start();
    emitStatus("proxy-1", "RUNNING");
    await flush();

    expect(manager.getLogStream).not.toHaveBeenCalled();
    expect(sentCommands).toEqual([]);
    tracker.stop();
  });

  it("records a join, backfills UUID and IP, then closes the session on leave with accumulated playtime", async () => {
    const prisma = makeFakePrisma(["srv-1"]);
    const streams = new Map<string, FakeLogStream>();
    // Nobody online yet at bootstrap — Steve joins purely via the log line below, not via reconcile's "seed already-online players" path (that's covered by the reconciliation test).
    const { manager } = makeFakeManager(streams, new Map([["srv-1", "There are 0 of a max of 20 players online:"]]));
    const tracker = new PlayerActivityTracker(prisma, manager);

    tracker.start();
    await flush();
    const stream = streams.get("srv-1")!;
    await waitForListener(stream);

    stream.emit("data", Buffer.from("[12:00:00] [Server thread/INFO]: UUID of player Steve is a13f2c8e-9d41-4b7a-8c02-1e5f7b3d9a44\n"));
    stream.emit("data", Buffer.from("[12:00:00] [Server thread/INFO]: Steve[/203.0.113.11:54321] logged in with entity id 55 at (0, 64, 0)\n"));
    stream.emit("data", Buffer.from("[12:00:00] [Server thread/INFO]: Steve joined the game\n"));
    await flush();

    let row = prisma.rows.get("srv-1:steve");
    expect(row?.uuid).toBe("a13f2c8e-9d41-4b7a-8c02-1e5f7b3d9a44");
    expect(row?.lastIp).toBe("203.0.113.11");
    expect(row?.currentSessionStartedAt).not.toBeNull();
    expect(row?.firstSeenAt).not.toBeNull();
    expect(prisma.ipHistory).toHaveLength(1);
    expect(prisma.ipHistory[0]?.ip).toBe("203.0.113.11");
    expect(prisma.sessions).toHaveLength(1);
    expect(prisma.sessions[0]?.endedAt).toBeNull();

    vi.setSystemTime(Date.now() + 60_000);
    stream.emit("data", Buffer.from("[12:01:00] [Server thread/INFO]: Steve left the game\n"));
    await flush();

    row = prisma.rows.get("srv-1:steve");
    expect(row?.currentSessionStartedAt).toBeNull();
    expect(row?.totalPlaytimeSeconds).toBeGreaterThanOrEqual(60);
    expect(prisma.sessions[0]?.endedAt).not.toBeNull();
    expect(prisma.sessions[0]?.durationSeconds).toBeGreaterThanOrEqual(60);

    tracker.stop();
  });

  it("ignores a chat message that merely contains the phrase 'joined the game'", async () => {
    const prisma = makeFakePrisma(["srv-1"]);
    const streams = new Map<string, FakeLogStream>();
    const { manager } = makeFakeManager(streams, new Map([["srv-1", "There are 0 of a max of 20 players online:"]]));
    const tracker = new PlayerActivityTracker(prisma, manager);

    tracker.start();
    await flush();
    const stream = streams.get("srv-1")!;
    await waitForListener(stream);
    stream.emit("data", Buffer.from("[12:00:00] [Server thread/INFO]: <Steve> hey I just joined the game\n"));
    await flush();

    expect(prisma.rows.size).toBe(0);
    tracker.stop();
  });

  it("reconciliation closes a session that vanished without a 'left the game' line (kick/crash)", async () => {
    const prisma = makeFakePrisma(["srv-1"]);
    const streams = new Map<string, FakeLogStream>();
    const listResponses = new Map([["srv-1", "There are 1 of a max of 20 players online: Steve"]]);
    const { manager } = makeFakeManager(streams, listResponses);
    const tracker = new PlayerActivityTracker(prisma, manager);

    tracker.start();
    await flush();
    const stream = streams.get("srv-1")!;
    await waitForListener(stream);
    stream.emit("data", Buffer.from("[12:00:00] [Server thread/INFO]: Steve joined the game\n"));
    await flush();
    expect(prisma.rows.get("srv-1:steve")?.currentSessionStartedAt).not.toBeNull();

    // Server no longer reports Steve online (kicked/crashed without a clean "left the game" line).
    listResponses.set("srv-1", "There are 0 of a max of 20 players online:");
    vi.setSystemTime(Date.now() + 60_000);
    await vi.advanceTimersByTimeAsync(60_000);
    await flush();

    expect(prisma.rows.get("srv-1:steve")?.currentSessionStartedAt).toBeNull();
    expect(prisma.sessions[0]?.endedAt).not.toBeNull();
    tracker.stop();
  });

  it("closes all open sessions when the server stops", async () => {
    const prisma = makeFakePrisma(["srv-1"]);
    const streams = new Map<string, FakeLogStream>();
    const { manager, emitStatus } = makeFakeManager(streams, new Map([["srv-1", "There are 1 of a max of 20 players online: Steve"]]));
    const tracker = new PlayerActivityTracker(prisma, manager);

    tracker.start();
    await flush();
    const stream = streams.get("srv-1")!;
    await waitForListener(stream);
    stream.emit("data", Buffer.from("[12:00:00] [Server thread/INFO]: Steve joined the game\n"));
    await flush();
    expect(prisma.rows.get("srv-1:steve")?.currentSessionStartedAt).not.toBeNull();

    emitStatus("srv-1", "STOPPED");
    await flush();

    expect(prisma.rows.get("srv-1:steve")?.currentSessionStartedAt).toBeNull();
    expect(stream.destroyed).toBe(true);
    tracker.stop();
  });

  it("records a PlayerNameHistory entry when a known UUID reappears under a different username", async () => {
    const prisma = makeFakePrisma(["srv-1"]);
    const streams = new Map<string, FakeLogStream>();
    const { manager } = makeFakeManager(streams, new Map([["srv-1", "There are 0 of a max of 20 players online:"]]));
    const tracker = new PlayerActivityTracker(prisma, manager);

    tracker.start();
    await flush();
    const stream = streams.get("srv-1")!;
    await waitForListener(stream);

    stream.emit("data", Buffer.from("[12:00:00] [Server thread/INFO]: UUID of player OldName is a13f2c8e-9d41-4b7a-8c02-1e5f7b3d9a44\n"));
    await flush();
    expect(prisma.nameHistory).toHaveLength(0); // first time seeing this uuid — not a rename

    stream.emit("data", Buffer.from("[12:00:00] [Server thread/INFO]: UUID of player NewName is a13f2c8e-9d41-4b7a-8c02-1e5f7b3d9a44\n"));
    await flush();

    expect(prisma.nameHistory).toHaveLength(1);
    expect(prisma.nameHistory[0]?.username).toBe("NewName");
    expect(prisma.nameHistory[0]?.uuid).toBe("a13f2c8e-9d41-4b7a-8c02-1e5f7b3d9a44");

    tracker.stop();
  });

  it("auto-pardons and revokes a due tempban during the periodic reconcile tick", async () => {
    const prisma = makeFakePrisma(["srv-1"]);
    const streams = new Map<string, FakeLogStream>();
    const { manager, sentCommands } = makeFakeManager(streams, new Map([["srv-1", "There are 0 of a max of 20 players online:"]]));
    (prisma as unknown as { playerBan: { _seed: (row: unknown) => unknown } }).playerBan._seed({
      serverId: "srv-1",
      usernameLower: "steve",
      username: "Steve",
      type: "NAME",
      target: "Steve",
      expiresAt: new Date(Date.now() - 1000), // already due
      revokedAt: null,
      revokedById: null,
    });

    const tracker = new PlayerActivityTracker(prisma, manager);
    tracker.start();
    await flush();

    expect(sentCommands.some((c) => c.command === "pardon Steve")).toBe(true);
    expect(prisma.bans[0]?.revokedAt).not.toBeNull();

    tracker.stop();
  });
});
