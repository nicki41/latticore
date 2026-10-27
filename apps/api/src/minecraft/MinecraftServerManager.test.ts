import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MinecraftRuntime } from "./MinecraftServerManager.js";

// MinecraftServerManager resolves data paths via DATA_PATH and derives RCON
// passwords via SESSION_SECRET; point DATA_PATH at a fresh temp directory
// per test, same convention as files.service.test.ts.
vi.mock("../config/env.js", () => ({
  env: {
    get DATA_PATH() {
      return globalThis.__TEST_DATA_PATH__;
    },
    MC_PORT_RANGE_MIN: 30000,
    MC_PORT_RANGE_MAX: 30010,
    SESSION_SECRET: "a-fake-session-secret-for-tests-only",
  },
}));

declare global {
   
  var __TEST_DATA_PATH__: string;
}

const KNOWN_VERSIONS = [{ id: "1.21.1", releaseDate: "2024-08-08", type: "release" as const }];

vi.mock("./providers/index.js", () => ({
  getProvider: vi.fn(() => ({
    listVersions: vi.fn(async () => KNOWN_VERSIONS),
    resolveEnv: vi.fn(async (mcVersion: string) => ({ TYPE: "VANILLA", VERSION: mcVersion })),
    resolveInstallPlan: vi.fn(async (mcVersion: string) => ({
      kind: "direct-download",
      url: "https://piston-data.mojang.com/v1/objects/fake/server.jar",
      filename: "server.jar",
      sha1: "fake-sha1",
      javaMajor: 21,
      loaderVersion: null,
      mcVersion,
    })),
  })),
}));

// Shared (not per-instance) so tests can assert on them regardless of which
// MinecraftServerManager/ServerInstaller instance made the call — see
// Vitest's vi.hoisted() docs for why this is the safe way to reference
// mock fns from inside a (hoisted) vi.mock factory.
const { installerInstallMock, installerRefreshLaunchScriptMock } = vi.hoisted(() => ({
  installerInstallMock: vi.fn(async () => ({
    buildVersion: null as string | null,
    javaImageTag: "latticore-runtime:java21",
    installManifest: JSON.stringify({ kind: "direct-download", filename: "server.jar" }),
  })),
  installerRefreshLaunchScriptMock: vi.fn(async () => {}),
}));

vi.mock("./install/ServerInstaller.js", () => ({
  ServerInstaller: class {
    install = installerInstallMock;
    refreshLaunchScript = installerRefreshLaunchScriptMock;
  },
}));

const { MinecraftServerManager } = await import("./MinecraftServerManager.js");

/** In-memory stand-in for the slice of PrismaClient.server MinecraftServerManager actually calls. */
function makeFakePrisma() {
  const rows = new Map<string, Record<string, unknown>>();
  const allocations: { id: string; serverId: string; port: number }[] = [];

  function apply(data: Record<string, unknown>, base: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      motd: "A Minecraft Server",
      maxPlayers: 20,
      difficulty: "normal",
      gamemode: "survival",
      whitelistEnabled: false,
      onlineMode: true,
      pvp: true,
      viewDistance: 10,
      simulationDistance: 10,
      status: "CREATING",
      statusDetail: null,
      containerId: null,
      diskLimitMb: null,
      description: null,
      // Matches the Prisma column default — tests that build rows directly
      // (not through the real createServer(), which always stamps
      // PANEL_MANAGED) exercise the legacy/RCON path unless they override
      // this, same as every pre-existing row in a real deployment.
      runtime: "LEGACY",
      javaImageTag: null,
      installManifest: null,
      buildVersion: null,
      ...base,
      ...data,
    };
  }

  return {
    rows,
    server: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = crypto.randomUUID();
        const row = { id, ...apply(data) };
        rows.set(id, row);
        return { ...row };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const existing = rows.get(where.id);
        if (!existing) throw new Error(`No fake row for id ${where.id}`);
        const updated = { ...existing, ...data };
        rows.set(where.id, updated);
        return { ...updated };
      }),
      findUnique: vi.fn(async ({ where }: { where: { id?: string; port?: number } }) => {
        if (where.id !== undefined) return rows.has(where.id) ? { ...rows.get(where.id)! } : null;
        if (where.port !== undefined) {
          const match = [...rows.values()].find((r) => r.port === where.port);
          return match ? { ...match } : null;
        }
        return null;
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = rows.get(where.id);
        if (!row) throw new Error(`No fake row for id ${where.id}`);
        return { ...row };
      }),
      findMany: vi.fn(async (args: { select?: { port?: boolean }; where?: Record<string, unknown> } = {}) => {
        let values = [...rows.values()];
        if (args.where?.containerId) values = values.filter((r) => r.containerId !== null);
        if (args.where?.status && typeof args.where.status === "object" && "notIn" in args.where.status) {
          const notIn = (args.where.status as { notIn: string[] }).notIn;
          values = values.filter((r) => !notIn.includes(r.status as string));
        }
        if (args.where?.status && typeof args.where.status === "object" && "in" in args.where.status) {
          const inList = (args.where.status as { in: string[] }).in;
          values = values.filter((r) => inList.includes(r.status as string));
        }
        if (args.select?.port) return values.map((r) => ({ port: r.port }));
        return values.map((r) => ({ ...r }));
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        rows.delete(where.id);
      }),
       
    } as any,
    // Extra port allocations — empty unless a test pushes rows into
    // `allocations`, same as a freshly migrated DB with no ServerAllocation rows.
    allocations,
    serverAllocation: {
      findMany: vi.fn(async (args: { where?: { serverId?: string } } = {}) =>
        allocations.filter((a) => !args.where?.serverId || a.serverId === args.where.serverId).map((a) => ({ ...a })),
      ),
      findUnique: vi.fn(async ({ where }: { where: { port: number } }) => {
        const match = allocations.find((a) => a.port === where.port);
        return match ? { ...match } : null;
      }),
       
    } as any,
  };
}

/** Fake attach stream for AttachConsoleSession — tests grab this via runtime.getContainer(...) to emit console lines (e.g. Minecraft's ready line) or simulate the connection dying. */
function makeFakeAttachContainer(backlogText = "") {
  const stream = new EventEmitter() as EventEmitter & { write: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> };
  stream.write = vi.fn();
  stream.destroy = vi.fn();
  return {
    logs: vi.fn(async () => Buffer.from(backlogText)),
    attach: vi.fn(async () => stream),
    __stream: stream,
  };
}

function makeFakeRuntime(overrides: Partial<MinecraftRuntime> = {}): MinecraftRuntime {
  const fakeContainer = makeFakeAttachContainer();
  return {
    createContainer: vi.fn(async () => "container-abc123"),
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    restart: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    inspect: vi.fn(async () => ({
      State: { Running: true, Status: "running", ExitCode: 0, Error: "" },
       
    })) as any,
    getStats: vi.fn(async () => null),
     
    getLogStream: vi.fn(async () => ({}) as any),
    readLogs: vi.fn(async () => ""),
    runInstaller: vi.fn(async () => ({ exitCode: 0, output: "" })),
     
    getContainer: vi.fn(() => fakeContainer as any),
    ...overrides,
  };
}

/** Emits Minecraft's own ready line on the given fake attach container, repeatedly, until the assertion inside vi.waitFor passes — robust against not knowing exactly when AttachConsoleSession finished registering its listener. */
async function emitReadyLineUntil(container: ReturnType<typeof makeFakeAttachContainer>, assertion: () => void | Promise<void>): Promise<void> {
  await vi.waitFor(
    async () => {
      container.__stream.emit("data", Buffer.from('Done (1.234s)! For help, type "help"\n'));
      await assertion();
    },
    { timeout: 2000, interval: 20 },
  );
}

describe("MinecraftServerManager", () => {
  let tmpDataPath: string;

  beforeEach(async () => {
    tmpDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "latticore-server-manager-"));
    globalThis.__TEST_DATA_PATH__ = tmpDataPath;
    installerInstallMock.mockClear();
    installerRefreshLaunchScriptMock.mockClear();
  });

  afterEach(async () => {
    await fs.rm(tmpDataPath, { recursive: true, force: true });
  });

  describe("createServer", () => {
    it("rejects a version that the provider doesn't know about", async () => {
      const prisma = makeFakePrisma();
      const manager = new MinecraftServerManager(prisma as never, makeFakeRuntime());
      await expect(
        manager.createServer({ name: "Test", software: "VANILLA", mcVersion: "99.99", memoryMb: 1024, cpuCores: 1, eulaAccepted: true }),
      ).rejects.toThrow(/unknown vanilla version/i);
      expect(prisma.server.create).not.toHaveBeenCalled();
    });

    it("rejects an explicit port already used by another server", async () => {
      const prisma = makeFakePrisma();
      await prisma.server.create({ data: { name: "Existing", software: "VANILLA", mcVersion: "1.21.1", containerName: "latticore-existing-aaaa0000", port: 30005, memoryMb: 1024, cpuCores: 1, dataDir: "servers/existing" } });
      const manager = new MinecraftServerManager(prisma as never, makeFakeRuntime());
      await expect(
        manager.createServer({ name: "Clash", software: "VANILLA", mcVersion: "1.21.1", memoryMb: 1024, cpuCores: 1, port: 30005, eulaAccepted: true }),
      ).rejects.toThrow(/already used/i);
    });

    it("allocates a free port from the configured range when none is requested", async () => {
      const prisma = makeFakePrisma();
      const manager = new MinecraftServerManager(prisma as never, makeFakeRuntime());
      const server = await manager.createServer({ name: "Auto Port", software: "VANILLA", mcVersion: "1.21.1", memoryMb: 1024, cpuCores: 1, eulaAccepted: true });
      expect(server.port).toBeGreaterThanOrEqual(30000);
      expect(server.port).toBeLessThanOrEqual(30010);
    });

    it("generates a containerName independent of the DB id and sets dataDir to servers/<id>", async () => {
      const prisma = makeFakePrisma();
      const manager = new MinecraftServerManager(prisma as never, makeFakeRuntime());
      const server = await manager.createServer({ name: "My Cool Server!", software: "VANILLA", mcVersion: "1.21.1", memoryMb: 1024, cpuCores: 1, eulaAccepted: true });
      expect(server.containerName).toMatch(/^latticore-my-cool-server-[0-9a-f]{8}$/);
      expect(server.dataDir).toBe(`servers/${server.id}`);
      const stat = await fs.stat(path.join(tmpDataPath, server.dataDir));
      expect(stat.isDirectory()).toBe(true);
    });

    it("provisions the container in the background and reaches RUNNING (PANEL_MANAGED — what createServer() always produces)", async () => {
      const prisma = makeFakePrisma();
      const runtime = makeFakeRuntime();
      const manager = new MinecraftServerManager(prisma as never, runtime);
      const server = await manager.createServer({ name: "Boots Up", software: "VANILLA", mcVersion: "1.21.1", memoryMb: 2048, cpuCores: 2, eulaAccepted: true });

      expect(server.runtime).toBe("PANEL_MANAGED");
      const container = runtime.getContainer("container-abc123") as unknown as ReturnType<typeof makeFakeAttachContainer>;
      await emitReadyLineUntil(container, async () => {
        const row = await prisma.server.findUnique({ where: { id: server.id } });
        expect(row?.status).toBe("RUNNING");
      });

      expect(runtime.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          serverId: server.id,
          memoryMb: 2048,
          cpuCores: 2,
          runtime: "PANEL_MANAGED",
          javaImageTag: "latticore-runtime:java21",
        }),
      );
      expect(runtime.start).toHaveBeenCalledWith("container-abc123");

      const row = await prisma.server.findUnique({ where: { id: server.id } });
      expect(row?.buildVersion).toBeNull();
      expect(row?.javaImageTag).toBe("latticore-runtime:java21");

      // server.properties is written by the panel itself before the container
      // ever starts — see the note in DockerMinecraftRuntime.createContainer()
      // on why the image is never given MOTD/DIFFICULTY/etc env vars anymore.
      const properties = await fs.readFile(path.join(tmpDataPath, server.dataDir, "server.properties"), "utf8");
      expect(properties).toContain("motd=A Minecraft Server");
      expect(properties).toContain("max-players=20");
    });

    it("rejects createServer when the EULA was not accepted, without touching the DB", async () => {
      const prisma = makeFakePrisma();
      const manager = new MinecraftServerManager(prisma as never, makeFakeRuntime());
      await expect(
        manager.createServer({ name: "No Consent", software: "VANILLA", mcVersion: "1.21.1", memoryMb: 1024, cpuCores: 1, eulaAccepted: false }),
      ).rejects.toThrow(/eula/i);
      expect(prisma.server.create).not.toHaveBeenCalled();
    });

    it("never calls runtime.createContainer if the stored row somehow has eulaAccepted=false", async () => {
      // Defends the provisionInBackground() guard independently of the
      // createServer() input check above (e.g. against a future code path
      // that writes a Server row without going through createServer()).
      const prisma = makeFakePrisma();
      const runtime = makeFakeRuntime();
      const manager = new MinecraftServerManager(prisma as never, runtime);
      const server = await prisma.server.create({
        data: {
          name: "Bad Row",
          software: "VANILLA",
          mcVersion: "1.21.1",
          containerName: "latticore-bad-row-deadbeef",
          port: 30009,
          memoryMb: 1024,
          cpuCores: 1,
          dataDir: "servers/bad-row",
          eulaAccepted: false,
        },
      });

      await (manager as unknown as { provisionInBackground: (id: string, provider: unknown) => Promise<void> }).provisionInBackground(
        server.id as string,
        { resolveEnv: async () => ({ TYPE: "VANILLA" }) },
      );

      expect(runtime.createContainer).not.toHaveBeenCalled();
      const row = await prisma.server.findUnique({ where: { id: server.id as string } });
      expect(row?.status).toBe("ERROR");
    });

    it("marks the server ERROR if provisioning throws", async () => {
      const prisma = makeFakePrisma();
      const runtime = makeFakeRuntime({ createContainer: vi.fn(async () => { throw new Error("docker is down"); }) });
      const manager = new MinecraftServerManager(prisma as never, runtime);
      const server = await manager.createServer({ name: "Fails", software: "VANILLA", mcVersion: "1.21.1", memoryMb: 1024, cpuCores: 1, eulaAccepted: true });

      await vi.waitFor(async () => {
        const row = await prisma.server.findUnique({ where: { id: server.id } });
        expect(row?.status).toBe("ERROR");
      });
    });
  });

  describe("server lifecycle", () => {
    async function createRunningishServer(prisma: ReturnType<typeof makeFakePrisma>, extra: Record<string, unknown> = {}) {
      return prisma.server.create({
        data: {
          name: "Lifecycle",
          software: "VANILLA",
          mcVersion: "1.21.1",
          containerName: "latticore-lifecycle-deadbeef",
          port: 30001,
          memoryMb: 1024,
          cpuCores: 1,
          dataDir: "servers/lifecycle",
          containerId: "container-existing",
          status: "STOPPED",
          ...extra,
        },
      });
    }

    it("startServer refuses a server with no container yet", async () => {
      const prisma = makeFakePrisma();
      const server = await createRunningishServer(prisma, { containerId: null });
      const manager = new MinecraftServerManager(prisma as never, makeFakeRuntime());
      await expect(manager.startServer(server.id as string)).rejects.toThrow(/no container yet/i);
    });

    it("startServer recreates the container from current settings, then moves through STARTING to RUNNING", async () => {
      const prisma = makeFakePrisma();
      const server = await createRunningishServer(prisma, { memoryMb: 3072 });
      const runtime = makeFakeRuntime();
      const manager = new MinecraftServerManager(prisma as never, runtime);

      await manager.startServer(server.id as string);
      expect(runtime.remove).toHaveBeenCalledWith("container-existing", true);
      expect(runtime.createContainer).toHaveBeenCalledWith(expect.objectContaining({ memoryMb: 3072 }));
      expect(runtime.start).toHaveBeenCalledWith("container-abc123");

      await vi.waitFor(async () => {
        const row = await prisma.server.findUnique({ where: { id: server.id as string } });
        expect(row?.status).toBe("RUNNING");
      });
    });

    it("stopServer transitions STOPPING -> STOPPED and calls runtime.stop", async () => {
      const prisma = makeFakePrisma();
      const server = await createRunningishServer(prisma, { status: "RUNNING" });
      const runtime = makeFakeRuntime();
      const manager = new MinecraftServerManager(prisma as never, runtime);

      await manager.stopServer(server.id as string);

      expect(runtime.stop).toHaveBeenCalledWith("container-existing");
      const row = await prisma.server.findUnique({ where: { id: server.id as string } });
      expect(row?.status).toBe("STOPPED");
    });

    it("stopServer refuses a server with no container yet", async () => {
      const prisma = makeFakePrisma();
      const server = await createRunningishServer(prisma, { containerId: null });
      const manager = new MinecraftServerManager(prisma as never, makeFakeRuntime());
      await expect(manager.stopServer(server.id as string)).rejects.toThrow(/no container yet/i);
    });

    it("restartServer recreates the container (not a plain docker restart) so new resource limits/env actually apply", async () => {
      const prisma = makeFakePrisma();
      const server = await createRunningishServer(prisma, { status: "RUNNING", memoryMb: 2048, cpuCores: 2 });
      const runtime = makeFakeRuntime();
      const manager = new MinecraftServerManager(prisma as never, runtime);

      await manager.restartServer(server.id as string);

      expect(runtime.stop).toHaveBeenCalledWith("container-existing");
      expect(runtime.remove).toHaveBeenCalledWith("container-existing", true);
      expect(runtime.createContainer).toHaveBeenCalledWith(expect.objectContaining({ memoryMb: 2048, cpuCores: 2 }));
      expect(runtime.restart).not.toHaveBeenCalled();
      expect(runtime.start).toHaveBeenCalledWith("container-abc123");

      const [stopOrder] = vi.mocked(runtime.stop).mock.invocationCallOrder;
      const [removeOrder] = vi.mocked(runtime.remove).mock.invocationCallOrder;
      expect(stopOrder).toBeDefined();
      expect(removeOrder).toBeDefined();
      expect(stopOrder!).toBeLessThan(removeOrder!); // graceful stop must happen before the force-remove, not after

      await vi.waitFor(async () => {
        const row = await prisma.server.findUnique({ where: { id: server.id as string } });
        expect(row?.status).toBe("RUNNING");
        expect(row?.containerId).toBe("container-abc123");
      });
    });

    it("deleteServer removes the container, deletes the data directory, and drops the DB row", async () => {
      const prisma = makeFakePrisma();
      const server = await createRunningishServer(prisma, { dataDir: "servers/to-delete" });
      await fs.mkdir(path.join(tmpDataPath, "servers/to-delete"), { recursive: true });
      await fs.writeFile(path.join(tmpDataPath, "servers/to-delete/world.dat"), "fake world data");

      const runtime = makeFakeRuntime();
      const manager = new MinecraftServerManager(prisma as never, runtime);
      await manager.deleteServer(server.id as string);

      expect(runtime.remove).toHaveBeenCalledWith("container-existing", true);
      await expect(fs.stat(path.join(tmpDataPath, "servers/to-delete"))).rejects.toThrow();
      expect(prisma.rows.has(server.id as string)).toBe(false);
    });

    it("deleteServer keeps files on disk when keepFiles is set", async () => {
      const prisma = makeFakePrisma();
      const server = await createRunningishServer(prisma, { dataDir: "servers/keep-me" });
      await fs.mkdir(path.join(tmpDataPath, "servers/keep-me"), { recursive: true });

      const manager = new MinecraftServerManager(prisma as never, makeFakeRuntime());
      await manager.deleteServer(server.id as string, { keepFiles: true });

      const stat = await fs.stat(path.join(tmpDataPath, "servers/keep-me"));
      expect(stat.isDirectory()).toBe(true);
    });

    it("deleteServer works even if the container was already removed out-of-band", async () => {
      const prisma = makeFakePrisma();
      const server = await createRunningishServer(prisma, { containerId: null, dataDir: "servers/no-container" });
      const runtime = makeFakeRuntime();
      const manager = new MinecraftServerManager(prisma as never, runtime);
      await manager.deleteServer(server.id as string);
      expect(runtime.remove).not.toHaveBeenCalled();
      expect(prisma.rows.has(server.id as string)).toBe(false);
    });
  });

  describe("PANEL_MANAGED-specific behavior", () => {
    async function createPanelManagedServer(prisma: ReturnType<typeof makeFakePrisma>, extra: Record<string, unknown> = {}) {
      return prisma.server.create({
        data: {
          name: "Attach-based",
          software: "VANILLA",
          mcVersion: "1.21.1",
          containerName: "latticore-attach-based-deadbeef",
          port: 30007,
          memoryMb: 1024,
          cpuCores: 1,
          dataDir: "servers/attach-based",
          containerId: "container-existing",
          status: "RUNNING",
          runtime: "PANEL_MANAGED",
          javaImageTag: "latticore-runtime:java21",
          installManifest: JSON.stringify({ kind: "direct-download", filename: "server.jar" }),
          ...extra,
        },
      });
    }

    it("sendCommand writes to the attach session instead of using RCON", async () => {
      const prisma = makeFakePrisma();
      const server = await createPanelManagedServer(prisma);
      const runtime = makeFakeRuntime();
      const manager = new MinecraftServerManager(prisma as never, runtime);

      const pending = manager.sendCommand(server.id as string, "list");
      await vi.waitFor(() => {
        const container = runtime.getContainer("container-existing") as unknown as ReturnType<typeof makeFakeAttachContainer>;
        expect(container.__stream.write).toHaveBeenCalledWith("list\n");
      });

      const container = runtime.getContainer("container-existing") as unknown as ReturnType<typeof makeFakeAttachContainer>;
      container.__stream.emit("data", Buffer.from("There are 1 of a max of 20 players online: Alice\n"));
      await expect(pending).resolves.toBe("There are 1 of a max of 20 players online: Alice");
    });

    it("getLogStream returns backlog + live lines from the attach session, not docker logs --follow", async () => {
      const prisma = makeFakePrisma();
      const server = await createPanelManagedServer(prisma);
      const runtime = makeFakeRuntime();
      const manager = new MinecraftServerManager(prisma as never, runtime);

      const stream = await manager.getLogStream(server.id as string);
      expect(runtime.getLogStream).not.toHaveBeenCalled();

      const chunks: string[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk.toString("utf8")));

      const container = runtime.getContainer("container-existing") as unknown as ReturnType<typeof makeFakeAttachContainer>;
      container.__stream.emit("data", Buffer.from("hello from the console\n"));

      await vi.waitFor(() => {
        expect(chunks.join("")).toContain("hello from the console");
      });
    });

    it("restartServer reuses the stored javaImageTag (never re-resolves a build) and refreshes the launch script for the current memoryMb", async () => {
      const prisma = makeFakePrisma();
      const server = await createPanelManagedServer(prisma, { memoryMb: 4096 });
      const runtime = makeFakeRuntime();
      const manager = new MinecraftServerManager(prisma as never, runtime);

      await manager.restartServer(server.id as string);

      expect(installerRefreshLaunchScriptMock).toHaveBeenCalledWith(expect.objectContaining({ memoryMb: 4096 }));
      expect(runtime.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({ runtime: "PANEL_MANAGED", javaImageTag: "latticore-runtime:java21", memoryMb: 4096 }),
      );
      // No env-var/RCON hint resolution for this runtime kind at all.
      expect(runtime.createContainer).toHaveBeenCalledWith(expect.not.objectContaining({ softwareEnv: expect.anything() }));
    });

    it("restartServer refuses a PANEL_MANAGED server that somehow has no javaImageTag, rather than guessing", async () => {
      const prisma = makeFakePrisma();
      const server = await createPanelManagedServer(prisma, { javaImageTag: null });
      const manager = new MinecraftServerManager(prisma as never, makeFakeRuntime());

      await expect(manager.restartServer(server.id as string)).rejects.toThrow(/no installed runtime image/i);
    });
  });

  describe("port conflicts", () => {
    async function createServerWithAllocation(prisma: ReturnType<typeof makeFakePrisma>, allocationPort: number) {
      const owner = await prisma.server.create({
        data: { name: "Owner", software: "VANILLA", mcVersion: "1.21.1", containerName: "latticore-owner-aaaa0000", port: 30000, memoryMb: 1024, cpuCores: 1, dataDir: "servers/owner" },
      });
      prisma.allocations.push({ id: "alloc-1", serverId: owner.id as string, port: allocationPort });
      return owner;
    }

    it("rejects an explicit port that's another server's extra allocation", async () => {
      const prisma = makeFakePrisma();
      await createServerWithAllocation(prisma, 30001);
      const manager = new MinecraftServerManager(prisma as never, makeFakeRuntime());
      await expect(
        manager.createServer({ name: "Clash", software: "VANILLA", mcVersion: "1.21.1", memoryMb: 1024, cpuCores: 1, port: 30001, eulaAccepted: true }),
      ).rejects.toThrow(/already allocated to another server/i);
    });

    it("skips ports taken by extra allocations when auto-assigning", async () => {
      const prisma = makeFakePrisma();
      await createServerWithAllocation(prisma, 30001); // 30000 = primary, 30001 = allocation
      const manager = new MinecraftServerManager(prisma as never, makeFakeRuntime());
      const server = await manager.createServer({ name: "Auto", software: "VANILLA", mcVersion: "1.21.1", memoryMb: 1024, cpuCores: 1, eulaAccepted: true });
      expect(server.port).toBe(30002);
    });

    it("findPortConflict distinguishes the caller's own ports from other servers' without naming them", async () => {
      const prisma = makeFakePrisma();
      const owner = await createServerWithAllocation(prisma, 30001);
      const manager = new MinecraftServerManager(prisma as never, makeFakeRuntime());
      expect(await manager.findPortConflict(30000, { serverId: owner.id as string })).toMatch(/this server's primary port/);
      expect(await manager.findPortConflict(30001, { serverId: owner.id as string })).toMatch(/allocated to this server/);
      expect(await manager.findPortConflict(30001, { serverId: "someone-else" })).toBe("Port 30001 is already allocated to another server.");
      expect(await manager.findPortConflict(30009)).toBeNull();
    });
  });

  describe("failure handling", () => {
    async function createStoppedServer(prisma: ReturnType<typeof makeFakePrisma>, extra: Record<string, unknown> = {}) {
      return prisma.server.create({
        data: {
          name: "Fragile",
          software: "VANILLA",
          mcVersion: "1.21.1",
          containerName: "latticore-fragile-deadbeef",
          port: 30008,
          memoryMb: 1024,
          cpuCores: 1,
          dataDir: "servers/fragile",
          containerId: "container-existing",
          status: "STOPPED",
          ...extra,
        },
      });
    }

    it("startServer on an already-running server is a no-op, not a wedge in STARTING", async () => {
      const prisma = makeFakePrisma();
      const server = await createStoppedServer(prisma, { status: "RUNNING" });
      const runtime = makeFakeRuntime();
      const manager = new MinecraftServerManager(prisma as never, runtime);

      await manager.startServer(server.id as string);

      expect(runtime.start).not.toHaveBeenCalled();
      expect((await prisma.server.findUnique({ where: { id: server.id as string } }))?.status).toBe("RUNNING");
    });

    it("a failed start ends in ERROR with Docker's reason, never stuck in STARTING", async () => {
      const prisma = makeFakePrisma();
      const server = await createStoppedServer(prisma);
      const runtime = makeFakeRuntime({
        start: vi.fn(async () => {
          throw new Error("driver failed programming external connectivity: port is already allocated");
        }),
         
        inspect: vi.fn(async () => ({ State: { Running: false, Status: "created", ExitCode: 0, Error: "" } })) as any,
      });
      const manager = new MinecraftServerManager(prisma as never, runtime);

      await expect(manager.startServer(server.id as string)).rejects.toThrow(/port is already allocated/);

      const row = await prisma.server.findUnique({ where: { id: server.id as string } });
      expect(row?.status).toBe("ERROR");
      expect(row?.statusDetail).toMatch(/Failed to start the server: .*port is already allocated/);
    });

    it("a failed stop of a still-running container settles back to RUNNING", async () => {
      const prisma = makeFakePrisma();
      const server = await createStoppedServer(prisma, { status: "RUNNING" });
      const runtime = makeFakeRuntime({
        stop: vi.fn(async () => {
          throw new Error("daemon timeout");
        }),
      });
      const manager = new MinecraftServerManager(prisma as never, runtime);

      await expect(manager.stopServer(server.id as string)).rejects.toThrow(/daemon timeout/);
      expect((await prisma.server.findUnique({ where: { id: server.id as string } }))?.status).toBe("RUNNING");
    });

    it("refuses to start a server that's mid-install", async () => {
      const prisma = makeFakePrisma();
      const server = await createStoppedServer(prisma, { status: "INSTALLING" });
      const manager = new MinecraftServerManager(prisma as never, makeFakeRuntime());
      await expect(manager.startServer(server.id as string)).rejects.toThrow(/while it's installing/);
    });
  });

  describe("recoverInterruptedOperations", () => {
    async function createServerIn(prisma: ReturnType<typeof makeFakePrisma>, status: string, extra: Record<string, unknown> = {}) {
      return prisma.server.create({
        data: {
          name: `Was ${status}`,
          software: "VANILLA",
          mcVersion: "1.21.1",
          containerName: `latticore-${status.toLowerCase()}-deadbeef`,
          port: 30000 + Math.floor(Math.random() * 10),
          memoryMb: 1024,
          cpuCores: 1,
          dataDir: `servers/${status.toLowerCase()}`,
          containerId: "container-existing",
          status,
          ...extra,
        },
      });
    }

    it("settles STOPPING with an exited container to STOPPED", async () => {
      const prisma = makeFakePrisma();
      const server = await createServerIn(prisma, "STOPPING");
      const runtime = makeFakeRuntime({
         
        inspect: vi.fn(async () => ({ State: { Running: false, Status: "exited", ExitCode: 0, Error: "" } })) as any,
      });
      await new MinecraftServerManager(prisma as never, runtime).recoverInterruptedOperations();
      expect((await prisma.server.findUnique({ where: { id: server.id as string } }))?.status).toBe("STOPPED");
    });

    it("marks an install that never got a container as ERROR, pointing at Reinstall", async () => {
      const prisma = makeFakePrisma();
      const server = await createServerIn(prisma, "INSTALLING", { containerId: null });
      await new MinecraftServerManager(prisma as never, makeFakeRuntime()).recoverInterruptedOperations();
      const row = await prisma.server.findUnique({ where: { id: server.id as string } });
      expect(row?.status).toBe("ERROR");
      expect(row?.statusDetail).toMatch(/Reinstall/);
    });

    it("marks a PANEL_MANAGED server RUNNING if it printed its ready line since the container started", async () => {
      const prisma = makeFakePrisma();
      const server = await createServerIn(prisma, "STARTING", { runtime: "PANEL_MANAGED" });
      const runtime = makeFakeRuntime({
         
        inspect: vi.fn(async () => ({ State: { Running: true, Status: "running", ExitCode: 0, Error: "", StartedAt: "2026-10-23T10:00:00Z" } })) as any,
        readLogs: vi.fn(async () => '[10:00:30] [Server thread/INFO]: Done (12.3s)! For help, type "help"\n'),
      });
      await new MinecraftServerManager(prisma as never, runtime).recoverInterruptedOperations();

      expect(runtime.readLogs).toHaveBeenCalledWith("container-existing", { since: Date.parse("2026-10-23T10:00:00Z") / 1000 });
      expect((await prisma.server.findUnique({ where: { id: server.id as string } }))?.status).toBe("RUNNING");
    });

    it("keeps watching a PANEL_MANAGED server that's still booting instead of guessing", async () => {
      const prisma = makeFakePrisma();
      const server = await createServerIn(prisma, "STARTING", { runtime: "PANEL_MANAGED" });
      const runtime = makeFakeRuntime({
         
        inspect: vi.fn(async () => ({ State: { Running: true, Status: "running", ExitCode: 0, Error: "", StartedAt: "2026-10-23T10:00:00Z" } })) as any,
      });
      await new MinecraftServerManager(prisma as never, runtime).recoverInterruptedOperations();
      expect((await prisma.server.findUnique({ where: { id: server.id as string } }))?.status).toBe("STARTING");

      const container = runtime.getContainer("container-existing") as unknown as ReturnType<typeof makeFakeAttachContainer>;
      await emitReadyLineUntil(container, async () => {
        expect((await prisma.server.findUnique({ where: { id: server.id as string } }))?.status).toBe("RUNNING");
      });
    });
  });

  describe("reinstallServer", () => {
    async function createInstalledServer(prisma: ReturnType<typeof makeFakePrisma>, extra: Record<string, unknown> = {}) {
      return prisma.server.create({
        data: {
          name: "Reinstallable",
          software: "VANILLA",
          mcVersion: "1.21.1",
          containerName: "latticore-reinstallable-deadbeef",
          port: 30004,
          memoryMb: 1024,
          cpuCores: 1,
          dataDir: "servers/reinstallable",
          containerId: "container-existing",
          status: "STOPPED",
          runtime: "PANEL_MANAGED",
          eulaAccepted: true,
          javaImageTag: "latticore-runtime:java21",
          ...extra,
        },
      });
    }

    it("refuses while the server is running", async () => {
      const prisma = makeFakePrisma();
      const server = await createInstalledServer(prisma, { status: "RUNNING" });
      await expect(new MinecraftServerManager(prisma as never, makeFakeRuntime()).reinstallServer(server.id as string)).rejects.toThrow(/stop the server/i);
    });

    it("rejects a version the provider doesn't offer", async () => {
      const prisma = makeFakePrisma();
      const server = await createInstalledServer(prisma);
      await expect(
        new MinecraftServerManager(prisma as never, makeFakeRuntime()).reinstallServer(server.id as string, { mcVersion: "0.0.1" }),
      ).rejects.toThrow(/unknown vanilla version/i);
    });

    it("removes the old container and runs the install pipeline again", async () => {
      const prisma = makeFakePrisma();
      const server = await createInstalledServer(prisma);
      const runtime = makeFakeRuntime();
      await new MinecraftServerManager(prisma as never, runtime).reinstallServer(server.id as string);

      expect(runtime.remove).toHaveBeenCalledWith("container-existing", true);
      await vi.waitFor(() => expect(installerInstallMock).toHaveBeenCalledWith(expect.objectContaining({ id: server.id }), expect.anything()));
      await vi.waitFor(() => expect(runtime.createContainer).toHaveBeenCalled());
    });
  });

  describe("reconcile", () => {
    it("flips a server to ERROR when its container has disappeared", async () => {
      const prisma = makeFakePrisma();
      const server = await prisma.server.create({
        data: {
          name: "Vanished",
          software: "VANILLA",
          mcVersion: "1.21.1",
          containerName: "latticore-vanished-deadbeef",
          port: 30002,
          memoryMb: 1024,
          cpuCores: 1,
          dataDir: "servers/vanished",
          containerId: "container-gone",
          status: "RUNNING",
        },
      });
      const runtime = makeFakeRuntime({ inspect: vi.fn(async () => null) });
      const manager = new MinecraftServerManager(prisma as never, runtime);

      await manager.reconcile();

      const row = await prisma.server.findUnique({ where: { id: server.id as string } });
      expect(row?.status).toBe("ERROR");
    });

    it("flips a RUNNING server to ERROR when Docker reports it exited non-zero (e.g. crash/OOM kill)", async () => {
      const prisma = makeFakePrisma();
      const server = await prisma.server.create({
        data: {
          name: "Crashed",
          software: "VANILLA",
          mcVersion: "1.21.1",
          containerName: "latticore-crashed-deadbeef",
          port: 30003,
          memoryMb: 1024,
          cpuCores: 1,
          dataDir: "servers/crashed",
          containerId: "container-crashed",
          status: "RUNNING",
        },
      });
      const runtime = makeFakeRuntime({
         
        inspect: vi.fn(async () => ({ State: { Running: false, Status: "exited", ExitCode: 137, Error: "" } })) as any,
      });
      const manager = new MinecraftServerManager(prisma as never, runtime);

      await manager.reconcile();

      const row = await prisma.server.findUnique({ where: { id: server.id as string } });
      expect(row?.status).toBe("ERROR");
    });

    it("leaves an intentionally-STOPPED server alone even if it exited non-zero (e.g. SIGKILLed after the stop timeout)", async () => {
      const prisma = makeFakePrisma();
      const server = await prisma.server.create({
        data: {
          name: "SlowShutdown",
          software: "VANILLA",
          mcVersion: "1.21.1",
          containerName: "latticore-slowshutdown-deadbeef",
          port: 30005,
          memoryMb: 1024,
          cpuCores: 1,
          dataDir: "servers/slowshutdown",
          containerId: "container-slowshutdown",
          status: "STOPPED",
        },
      });
      const runtime = makeFakeRuntime({
         
        inspect: vi.fn(async () => ({ State: { Running: false, Status: "exited", ExitCode: 137, Error: "" } })) as any,
      });
      const manager = new MinecraftServerManager(prisma as never, runtime);

      await manager.reconcile();

      expect(prisma.server.update).not.toHaveBeenCalled();
      const row = await prisma.server.findUnique({ where: { id: server.id as string } });
      expect(row?.status).toBe("STOPPED");
    });

    it("leaves a RUNNING server alone when Docker agrees it's still running", async () => {
      const prisma = makeFakePrisma();
      const server = await prisma.server.create({
        data: {
          name: "Healthy",
          software: "VANILLA",
          mcVersion: "1.21.1",
          containerName: "latticore-healthy-deadbeef",
          port: 30004,
          memoryMb: 1024,
          cpuCores: 1,
          dataDir: "servers/healthy",
          containerId: "container-healthy",
          status: "RUNNING",
        },
      });
      const runtime = makeFakeRuntime();
      const manager = new MinecraftServerManager(prisma as never, runtime);

      await manager.reconcile();

      expect(prisma.server.update).not.toHaveBeenCalled();
      const row = await prisma.server.findUnique({ where: { id: server.id as string } });
      expect(row?.status).toBe("RUNNING");
    });

    it("skips servers mid-transition (CREATING/STARTING/etc.) so it never races the manager's own lifecycle calls", async () => {
      const prisma = makeFakePrisma();
      await prisma.server.create({
        data: {
          name: "Starting",
          software: "VANILLA",
          mcVersion: "1.21.1",
          containerName: "latticore-starting-deadbeef",
          port: 30006,
          memoryMb: 1024,
          cpuCores: 1,
          dataDir: "servers/starting",
          containerId: "container-starting",
          status: "STARTING",
        },
      });
      const runtime = makeFakeRuntime();
      const manager = new MinecraftServerManager(prisma as never, runtime);

      await manager.reconcile();

      expect(runtime.inspect).not.toHaveBeenCalled();
    });
  });
});
