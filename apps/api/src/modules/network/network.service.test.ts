import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config/env.js", () => ({
  env: {
    get DATA_PATH() {
      return globalThis.__TEST_DATA_PATH__;
    },
    MINECRAFT_NETWORK: "test_net",
    DOCKER_SOCKET_PATH: "/nonexistent.sock",
    TZ: "UTC",
  },
}));

declare global {
   
  var __TEST_DATA_PATH__: string;
}

const { NetworkService } = await import("./network.service.js");

type Row = {
  id: string;
  name: string;
  software: string;
  mcVersion: string;
  status: string;
  runtime: string;
  containerName: string;
  dataDir: string;
  exposePort: boolean;
};
type Member = { id: string; proxyServerId: string; backendServerId: string; name: string; priority: number; createdAt: Date };

/** Just enough of PrismaClient for NetworkService, over two in-memory tables. */
function makeStore(rows: Row[]) {
  const servers = new Map(rows.map((r) => [r.id, { ...r }]));
  const members: Member[] = [];
  let seq = 0;
  const withRelations = (m: Member) => ({ ...m, backend: { ...servers.get(m.backendServerId)! }, proxy: { ...servers.get(m.proxyServerId)! } });
  const membershipOf = (serverId: string) => {
    const m = members.find((x) => x.backendServerId === serverId);
    return m ? withRelations(m) : null;
  };
  const prisma = {
    server: {
      findMany: vi.fn(async ({ where }: { where?: { id?: { not: string } } } = {}) =>
        [...servers.values()].filter((s) => s.id !== where?.id?.not).map((s) => ({ ...s, networkMembership: membershipOf(s.id) })),
      ),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const s = servers.get(where.id);
        return s ? { ...s, networkMembership: membershipOf(s.id) } : null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        Object.assign(servers.get(where.id)!, data);
        return { ...servers.get(where.id)! };
      }),
    },
    serverNetworkMember: {
      findMany: vi.fn(async ({ where }: { where: { proxyServerId: string } }) =>
        members.filter((m) => m.proxyServerId === where.proxyServerId).sort((a, b) => a.priority - b.priority).map(withRelations),
      ),
      findUnique: vi.fn(async ({ where }: { where: { id?: string; backendServerId?: string } }) => {
        const m = members.find((x) => (where.id ? x.id === where.id : x.backendServerId === where.backendServerId));
        return m ? withRelations(m) : null;
      }),
      create: vi.fn(async ({ data }: { data: Omit<Member, "id" | "createdAt"> }) => {
        const m = { ...data, id: `m${++seq}`, createdAt: new Date(Date.now() + seq) };
        members.push(m);
        return m;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Member> }) => Object.assign(members.find((m) => m.id === where.id)!, data)),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => members.splice(members.findIndex((m) => m.id === where.id), 1)[0]),
      deleteMany: vi.fn(async ({ where }: { where: { proxyServerId: string } }) => {
        for (let i = members.length - 1; i >= 0; i--) if (members[i]!.proxyServerId === where.proxyServerId) members.splice(i, 1);
      }),
    },
    serverAccess: { findUnique: vi.fn(async () => null) },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const manager = {
    sendCommand: vi.fn(async (_serverId: string, command: string) => (command === "velocity reload" ? "Velocity configuration successfully reloaded." : "")),
    proxyBackendEntries: vi.fn(async (proxyServerId: string) =>
      members
        .filter((m) => m.proxyServerId === proxyServerId)
        .sort((a, b) => a.priority - b.priority)
        .map((m) => ({ name: m.name, address: `${servers.get(m.backendServerId)!.containerName}:25565` })),
    ),
  };
  return { prisma, manager, servers, members };
}

const owner = { id: "u1", isOwner: true, permissions: new Set() } as never;

function server(id: string, extra: Partial<Row> = {}): Row {
  return { id, name: id, software: "PAPER", mcVersion: "1.21.11", status: "STOPPED", runtime: "PANEL_MANAGED", containerName: `latticore-${id}-0000`, dataDir: `servers/${id}`, exposePort: true, ...extra };
}

describe("NetworkService", () => {
  let dataPath: string;

  beforeEach(async () => {
    dataPath = await fs.mkdtemp(path.join(os.tmpdir(), "latticore-network-"));
    globalThis.__TEST_DATA_PATH__ = dataPath;
  });
  afterEach(async () => {
    await fs.rm(dataPath, { recursive: true, force: true });
  });

  async function setup(rows: Row[]) {
    for (const r of rows) await fs.mkdir(path.join(dataPath, r.dataDir), { recursive: true });
    const store = makeStore(rows);
    return { ...store, service: new NetworkService(store.prisma as never, store.manager as never) };
  }
  const read = (rel: string) => fs.readFile(path.join(dataPath, rel), "utf8");

  it("adds a Paper server behind Velocity with every setting done automatically, and reloads the running proxy live", async () => {
    const { service, servers, manager } = await setup([server("proxy", { software: "VELOCITY", mcVersion: "3.5.1", status: "RUNNING" }), server("Lobby")]);
    const result = await service.addBackend({ ...servers.get("proxy")! } as never, { serverId: "Lobby" }, owner);

    expect(result.network.backends).toEqual([expect.objectContaining({ name: "lobby", priority: 0, server: expect.objectContaining({ id: "Lobby" }) })]);
    expect(result).toMatchObject({ proxyReloaded: true, proxyRestartRequired: false, backendRestartRequired: false });
    expect(manager.sendCommand).toHaveBeenCalledWith("proxy", "velocity reload", expect.objectContaining({ silent: true }));

    // Proxy knows the backend by container name; backend trusts the proxy's secret and is no longer published.
    expect(await read("servers/proxy/velocity.toml")).toContain('lobby = "latticore-Lobby-0000:25565"\ntry = ["lobby"]');
    const secret = (await read("servers/proxy/forwarding.secret")).trim();
    expect(parseYaml(await read("servers/Lobby/config/paper-global.yml")).proxies.velocity).toEqual({ enabled: true, "online-mode": true, secret });
    expect(await read("servers/Lobby/server.properties")).toContain("online-mode=false");
    expect(servers.get("Lobby")!.exposePort).toBe(false);
  });

  it("explains why a server can't join instead of half-configuring it", async () => {
    const { service, servers } = await setup([
      server("proxy", { software: "VELOCITY" }),
      server("modded", { software: "FABRIC" }),
      server("old", { mcVersion: "1.12.2" }),
      server("other-proxy", { software: "BUNGEECORD" }),
    ]);
    const proxy = { ...servers.get("proxy")! } as never;

    const candidates = await service.listCandidates(proxy, owner);
    expect(Object.fromEntries(candidates.map((c) => [c.id, c.unsupportedReason]))).toEqual({
      modded: expect.stringMatching(/Paper/),
      old: expect.stringMatching(/1\.13/),
      "other-proxy": expect.stringMatching(/proxy/),
    });
    await expect(service.addBackend(proxy, { serverId: "modded" }, owner)).rejects.toThrow(/Paper/);
  });

  it("removing a backend restores it to standalone; BungeeCord then needs a proxy restart (greload can't drop servers)", async () => {
    const { service, servers } = await setup([server("bungee", { software: "BUNGEECORD", mcVersion: "2107", status: "RUNNING" }), server("survival", { status: "RUNNING" })]);
    const proxy = { ...servers.get("bungee")! } as never;
    const added = await service.addBackend(proxy, { serverId: "survival" }, owner);
    expect(added).toMatchObject({ proxyReloaded: true, backendRestartRequired: true });
    expect(parseYaml(await read("servers/survival/spigot.yml")).settings.bungeecord).toBe(true);

    const removed = await service.removeBackend(proxy, added.network.backends[0]!.memberId, owner);
    expect(removed).toMatchObject({ proxyReloaded: false, proxyRestartRequired: true });
    expect(removed.network.backends).toEqual([]);
    expect(parseYaml(await read("servers/survival/spigot.yml")).settings.bungeecord).toBe(false);
    expect(await read("servers/survival/server.properties")).toContain("online-mode=true");
    expect(servers.get("survival")!.exposePort).toBe(true);
    expect(Object.keys(parseYaml(await read("servers/bungee/config.yml")).servers)).toEqual(["placeholder"]);
  });

  it("reorders the join order and refuses incomplete orders", async () => {
    const { service, servers } = await setup([server("proxy", { software: "VELOCITY" }), server("a"), server("b")]);
    const proxy = { ...servers.get("proxy")! } as never;
    await service.addBackend(proxy, { serverId: "a" }, owner);
    const { network } = await service.addBackend(proxy, { serverId: "b" }, owner);
    const [a, b] = network.backends;

    await expect(service.reorder(proxy, [b!.memberId], owner)).rejects.toThrow(/every server/);
    const reordered = await service.reorder(proxy, [b!.memberId, a!.memberId], owner);
    expect(reordered.network.backends.map((x) => x.name)).toEqual(["b", "a"]);
    expect(await read("servers/proxy/velocity.toml")).toContain('try = ["b", "a"]');
  });

  it("doesn't let a user pull in a server they can't manage", async () => {
    const { service, servers } = await setup([server("proxy", { software: "VELOCITY" }), server("secret-server")]);
    const viewer = { id: "u2", isOwner: false, permissions: new Set(["servers.settings.edit"]) } as never;
    await expect(service.addBackend({ ...servers.get("proxy")! } as never, { serverId: "secret-server" }, viewer)).rejects.toThrow(/not found/i);
  });
});
