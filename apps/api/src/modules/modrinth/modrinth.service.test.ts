import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModrinthVersion } from "@latticore/shared";
import { ModrinthService } from "./modrinth.service.js";

// ModrinthService resolves install roots via DATA_PATH + a server's dataDir;
// point DATA_PATH at a fresh temp directory per test, same convention as
// files.service.test.ts.
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

/** In-memory stand-in for the slice of PrismaClient.pluginInstall ModrinthService actually calls. */
function makeFakePrisma() {
  const rows: Record<string, unknown>[] = [];
  return {
    rows,
    pluginInstall: {
      findMany: vi.fn(async ({ where }: { where: { serverId: string } }) =>
        rows.filter((r) => r.serverId === where.serverId).map((r) => ({ ...r })),
      ),
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { serverId_activeFilename: { serverId: string; activeFilename: string } };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const { serverId, activeFilename } = where.serverId_activeFilename;
          const existing = rows.find((r) => r.serverId === serverId && r.activeFilename === activeFilename);
          if (existing) {
            Object.assign(existing, update);
            return { ...existing };
          }
          const row = { id: crypto.randomUUID(), ...create };
          rows.push(row);
          return { ...row };
        },
      ),
      deleteMany: vi.fn(async ({ where }: { where: { serverId: string; activeFilename: string } }) => {
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i--) {
          if (rows[i]!.serverId === where.serverId && rows[i]!.activeFilename === where.activeFilename) rows.splice(i, 1);
        }
        return { count: before - rows.length };
      }),
       
    } as any,
  };
}

function sha1(buf: Buffer): string {
  return crypto.createHash("sha1").update(buf).digest("hex");
}
function sha512(buf: Buffer): string {
  return crypto.createHash("sha512").update(buf).digest("hex");
}

function makeVersion(overrides: Partial<ModrinthVersion> = {}): ModrinthVersion {
  const content = Buffer.from("fake jar bytes");
  return {
    id: "version-1",
    project_id: "project-1",
    name: "Test Version",
    version_number: "1.0.0",
    game_versions: ["1.21.1"],
    loaders: ["paper"],
    version_type: "release",
    date_published: new Date().toISOString(),
    files: [
      {
        url: "https://cdn.modrinth.com/data/AAAA/versions/BBBB/plugin.jar",
        filename: "plugin.jar",
        primary: true,
        size: content.length,
        hashes: { sha1: sha1(content), sha512: sha512(content) },
      },
    ],
    ...overrides,
  };
}

describe("ModrinthService", () => {
  let tmpDataPath: string;
  let service: ModrinthService;
  let prisma: ReturnType<typeof makeFakePrisma>;
  const paperServer = { id: "paper-1", software: "PAPER" as const, dataDir: "servers/paper-1" };
  const fabricServer = { id: "fabric-1", software: "FABRIC" as const, dataDir: "servers/fabric-1" };
  const vanillaServer = { id: "vanilla-1", software: "VANILLA" as const, dataDir: "servers/vanilla-1" };

  beforeEach(async () => {
    tmpDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "latticore-modrinth-"));
    globalThis.__TEST_DATA_PATH__ = tmpDataPath;
    prisma = makeFakePrisma();
    service = new ModrinthService(prisma as never);
    vi.restoreAllMocks();
    // safeResolve's symlink-escape check walks up to the nearest existing
    // ancestor, so each server's own data directory must exist up front —
    // same convention as files.service.test.ts.
    for (const server of [paperServer, fabricServer, vanillaServer]) {
      await fs.mkdir(path.join(tmpDataPath, server.dataDir), { recursive: true });
    }
  });

  afterEach(async () => {
    await fs.rm(tmpDataPath, { recursive: true, force: true });
  });

  describe("install", () => {
    it("downloads, verifies the hash, and writes a plugin into a Paper server's plugins/ folder", async () => {
      const version = makeVersion();
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(Buffer.from("fake jar bytes"), { status: 200 }),
      );

      const result = await service.install(paperServer as never, version);

      expect(result.filename).toBe("plugin.jar");
      expect(fetchMock).toHaveBeenCalledWith("https://cdn.modrinth.com/data/AAAA/versions/BBBB/plugin.jar", expect.anything());
      const written = await fs.readFile(path.join(tmpDataPath, paperServer.dataDir, "plugins", "plugin.jar"), "utf-8");
      expect(written).toBe("fake jar bytes");
    });

    it("persists Modrinth metadata (title/icon/slug from the project resource, author from the caller's hint)", async () => {
      const version = makeVersion();
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(Buffer.from("fake jar bytes"), { status: 200 }));
      vi.spyOn(service.modrinth, "getProject").mockResolvedValue({
        id: "project-1",
        slug: "test-plugin",
        title: "Test Plugin",
        description: "",
        body: "",
        icon_url: "https://cdn.modrinth.com/icon.png",
        downloads: 0,
        followers: 0,
        categories: [],
        project_type: "mod",
      });

      await service.install(paperServer as never, version, "Some Author");

      expect(prisma.rows).toEqual([
        expect.objectContaining({
          serverId: "paper-1",
          activeFilename: "plugin.jar",
          modrinthProjectId: "project-1",
          modrinthVersionId: "version-1",
          versionNumber: "1.0.0",
          title: "Test Plugin",
          author: "Some Author",
          iconUrl: "https://cdn.modrinth.com/icon.png",
          slug: "test-plugin",
        }),
      ]);
    });

    it("still installs the file even if fetching Modrinth project metadata fails", async () => {
      const version = makeVersion();
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(Buffer.from("fake jar bytes"), { status: 200 }));
      vi.spyOn(service.modrinth, "getProject").mockRejectedValue(new Error("network error"));

      const result = await service.install(paperServer as never, version);

      expect(result.filename).toBe("plugin.jar");
      expect(prisma.rows).toEqual([]);
    });

    it("writes into a mods/ folder for a Fabric server instead of plugins/", async () => {
      const version = makeVersion({ loaders: ["fabric"] });
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(Buffer.from("fake jar bytes"), { status: 200 }));

      await service.install(fabricServer as never, version);

      const written = await fs.readFile(path.join(tmpDataPath, fabricServer.dataDir, "mods", "plugin.jar"), "utf-8");
      expect(written).toBe("fake jar bytes");
    });

    it("refuses to install anything on a Vanilla server", async () => {
      const version = makeVersion();
      await expect(service.install(vanillaServer as never, version)).rejects.toThrow(/don't support/i);
    });

    it("refuses to overwrite an already-installed file with the same name", async () => {
      const version = makeVersion();
      await fs.mkdir(path.join(tmpDataPath, paperServer.dataDir, "plugins"), { recursive: true });
      await fs.writeFile(path.join(tmpDataPath, paperServer.dataDir, "plugins", "plugin.jar"), "already here");

      await expect(service.install(paperServer as never, version)).rejects.toThrow(/already installed/i);
    });

    it("rejects a download whose bytes don't match the expected SHA-512", async () => {
      const version = makeVersion();
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(Buffer.from("tampered bytes!!"), { status: 200 }));

      await expect(service.install(paperServer as never, version)).rejects.toThrow(/integrity check/i);
      await expect(fs.stat(path.join(tmpDataPath, paperServer.dataDir, "plugins", "plugin.jar"))).rejects.toThrow();
    });

    it("surfaces a clean error when the download itself fails", async () => {
      const version = makeVersion();
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not found", { status: 404, statusText: "Not Found" }));

      await expect(service.install(paperServer as never, version)).rejects.toThrow(/failed to download/i);
    });

    describe("SSRF hardening", () => {
      it("refuses to download from a host other than Modrinth's CDN, without making a network call", async () => {
        const version = makeVersion({
          files: [
            {
              url: "http://169.254.169.254/latest/meta-data/",
              filename: "plugin.jar",
              primary: true,
              size: 10,
              hashes: {},
            },
          ],
        });
        const fetchMock = vi.spyOn(globalThis, "fetch");

        await expect(service.install(paperServer as never, version)).rejects.toThrow(/untrusted host/i);
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it("refuses a plain-http URL even if the hostname is otherwise correct", async () => {
        const version = makeVersion({
          files: [{ url: "http://cdn.modrinth.com/data/AAAA/plugin.jar", filename: "plugin.jar", primary: true, size: 10, hashes: {} }],
        });
        const fetchMock = vi.spyOn(globalThis, "fetch");

        await expect(service.install(paperServer as never, version)).rejects.toThrow(/untrusted host/i);
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it("refuses a lookalike host such as cdn.modrinth.com.evil.example", async () => {
        const version = makeVersion({
          files: [
            {
              url: "https://cdn.modrinth.com.evil.example/plugin.jar",
              filename: "plugin.jar",
              primary: true,
              size: 10,
              hashes: {},
            },
          ],
        });
        const fetchMock = vi.spyOn(globalThis, "fetch");

        await expect(service.install(paperServer as never, version)).rejects.toThrow(/untrusted host/i);
        expect(fetchMock).not.toHaveBeenCalled();
      });
    });
  });

  describe("listInstalled", () => {
    it("lists only .jar files, ignoring other files and subdirectories", async () => {
      const dir = path.join(tmpDataPath, paperServer.dataDir, "plugins");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "a.jar"), "aaa");
      await fs.writeFile(path.join(dir, "b.jar"), "bbbb");
      await fs.writeFile(path.join(dir, "readme.txt"), "not a plugin");
      await fs.mkdir(path.join(dir, "subdir"));

      const installed = await service.listInstalled(paperServer);
      expect(installed.map((f) => f.filename)).toEqual(["a.jar", "b.jar"]);
      expect(installed.find((f) => f.filename === "b.jar")?.size).toBe(4);
    });

    it("reports ACTIVE for .jar files and PAUSED for .jar.disabled files, purely from the filename", async () => {
      const dir = path.join(tmpDataPath, paperServer.dataDir, "plugins");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "active.jar"), "a");
      await fs.writeFile(path.join(dir, "paused.jar.disabled"), "b");

      const installed = await service.listInstalled(paperServer);
      expect(installed).toEqual([
        expect.objectContaining({ filename: "active.jar", status: "ACTIVE" }),
        expect.objectContaining({ filename: "paused.jar.disabled", status: "PAUSED" }),
      ]);
    });

    it("enriches entries with Modrinth metadata by matching the DB row's activeFilename, even while paused", async () => {
      const dir = path.join(tmpDataPath, paperServer.dataDir, "plugins");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "known.jar.disabled"), "content");
      prisma.rows.push({
        id: "row-1",
        serverId: paperServer.id,
        activeFilename: "known.jar",
        modrinthProjectId: "proj-1",
        modrinthVersionId: "ver-1",
        title: "Known Plugin",
        author: "Someone",
        iconUrl: null,
        slug: "known-plugin",
      });

      const installed = await service.listInstalled(paperServer);
      expect(installed).toEqual([
        expect.objectContaining({
          filename: "known.jar.disabled",
          status: "PAUSED",
          title: "Known Plugin",
          slug: "known-plugin",
        }),
      ]);
    });

    it("returns an empty list when the plugins directory doesn't exist yet", async () => {
      const installed = await service.listInstalled(paperServer);
      expect(installed).toEqual([]);
    });

    it("returns an empty list for Vanilla servers without touching the filesystem", async () => {
      const installed = await service.listInstalled(vanillaServer);
      expect(installed).toEqual([]);
    });
  });

  describe("remove", () => {
    it("deletes an installed file", async () => {
      const dir = path.join(tmpDataPath, paperServer.dataDir, "plugins");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "plugin.jar"), "content");

      await service.remove(paperServer, "plugin.jar");

      await expect(fs.stat(path.join(dir, "plugin.jar"))).rejects.toThrow();
    });

    it("rejects a filename containing a path separator (defense against traversal)", async () => {
      await expect(service.remove(paperServer, "../../etc/passwd")).rejects.toThrow(/invalid filename/i);
      await expect(service.remove(paperServer, "sub\\dir.jar")).rejects.toThrow(/invalid filename/i);
    });

    it("also deletes the Modrinth metadata row, matching by activeFilename even when the file is paused", async () => {
      const dir = path.join(tmpDataPath, paperServer.dataDir, "plugins");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "plugin.jar.disabled"), "content");
      prisma.rows.push({ id: "row-1", serverId: paperServer.id, activeFilename: "plugin.jar" });

      await service.remove(paperServer, "plugin.jar.disabled");

      expect(prisma.rows).toEqual([]);
    });
  });

  describe("pause", () => {
    it("renames an active .jar to .jar.disabled", async () => {
      const dir = path.join(tmpDataPath, paperServer.dataDir, "plugins");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "plugin.jar"), "content");

      const result = await service.pause(paperServer, "plugin.jar");

      expect(result.filename).toBe("plugin.jar.disabled");
      await expect(fs.stat(path.join(dir, "plugin.jar"))).rejects.toThrow();
      expect(await fs.readFile(path.join(dir, "plugin.jar.disabled"), "utf-8")).toBe("content");
    });

    it("refuses to pause a file that isn't a .jar (e.g. already paused)", async () => {
      const dir = path.join(tmpDataPath, paperServer.dataDir, "plugins");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "plugin.jar.disabled"), "content");

      await expect(service.pause(paperServer, "plugin.jar.disabled")).rejects.toThrow(/only active \.jar/i);
    });

    it("404s when the file doesn't exist", async () => {
      await expect(service.pause(paperServer, "missing.jar")).rejects.toThrow(/not found/i);
    });

    it("refuses to pause if the .disabled target already exists (no silent overwrite)", async () => {
      const dir = path.join(tmpDataPath, paperServer.dataDir, "plugins");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "plugin.jar"), "new content");
      await fs.writeFile(path.join(dir, "plugin.jar.disabled"), "old paused content");

      await expect(service.pause(paperServer, "plugin.jar")).rejects.toThrow(/already exists/i);
      expect(await fs.readFile(path.join(dir, "plugin.jar.disabled"), "utf-8")).toBe("old paused content");
    });

    it("rejects a filename containing a path separator", async () => {
      await expect(service.pause(paperServer, "../evil.jar")).rejects.toThrow(/invalid filename/i);
    });
  });

  describe("resume", () => {
    it("renames a paused .jar.disabled back to .jar", async () => {
      const dir = path.join(tmpDataPath, paperServer.dataDir, "plugins");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "plugin.jar.disabled"), "content");

      const result = await service.resume(paperServer, "plugin.jar.disabled");

      expect(result.filename).toBe("plugin.jar");
      await expect(fs.stat(path.join(dir, "plugin.jar.disabled"))).rejects.toThrow();
      expect(await fs.readFile(path.join(dir, "plugin.jar"), "utf-8")).toBe("content");
    });

    it("refuses to resume a file that isn't paused", async () => {
      const dir = path.join(tmpDataPath, paperServer.dataDir, "plugins");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "plugin.jar"), "content");

      await expect(service.resume(paperServer, "plugin.jar")).rejects.toThrow(/only paused/i);
    });

    it("refuses to resume if a different file now occupies the active name", async () => {
      const dir = path.join(tmpDataPath, paperServer.dataDir, "plugins");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "plugin.jar.disabled"), "paused content");
      await fs.writeFile(path.join(dir, "plugin.jar"), "a different plugin now");

      await expect(service.resume(paperServer, "plugin.jar.disabled")).rejects.toThrow(/already exists/i);
      expect(await fs.readFile(path.join(dir, "plugin.jar"), "utf-8")).toBe("a different plugin now");
    });

    it("round-trips: pause then resume restores the original file untouched", async () => {
      const dir = path.join(tmpDataPath, paperServer.dataDir, "plugins");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "plugin.jar"), "original bytes");

      const paused = await service.pause(paperServer, "plugin.jar");
      const resumed = await service.resume(paperServer, paused.filename);

      expect(resumed.filename).toBe("plugin.jar");
      expect(await fs.readFile(path.join(dir, "plugin.jar"), "utf-8")).toBe("original bytes");
    });
  });
});
