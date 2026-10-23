import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const { BackupService } = await import("./backups.service.js");

type BackupRow = { id: string; serverId: string; fileName: string; sizeBytes: bigint; note: string | null; locked: boolean; createdById: string | null; createdAt: Date };

/** In-memory stand-in for the prisma.backup/prisma.server calls BackupService makes. */
function makeFakePrisma() {
  const backups: BackupRow[] = [];
  let tick = 0;
  const withCreator = (b: BackupRow) => ({ ...b, createdBy: null });
  return {
    backups,
    backup: {
      findMany: vi.fn(async ({ where, orderBy }: { where: { serverId: string; locked?: boolean }; orderBy?: unknown }) => {
        const rows = backups.filter((b) => b.serverId === where.serverId && (where.locked === undefined || b.locked === where.locked));
        if (orderBy) rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return rows.map(withCreator);
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => backups.find((b) => b.id === where.id) ?? null),
      create: vi.fn(async ({ data }: { data: Omit<BackupRow, "id" | "locked" | "createdAt"> }) => {
        // Strictly increasing timestamps — real backups are seconds apart, test ones microseconds.
        const row: BackupRow = { id: crypto.randomUUID(), locked: false, createdAt: new Date(Date.now() + tick++ * 1000), ...data, createdById: data.createdById ?? null };
        backups.push(row);
        return withCreator(row);
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<BackupRow> }) => {
        const row = backups.find((b) => b.id === where.id)!;
        Object.assign(row, data);
        return withCreator(row);
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        backups.splice(backups.findIndex((b) => b.id === where.id), 1);
      }),
    },
    server: {
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...server, ...data })),
    },
  };
}

const server = {
  id: "srv1",
  name: "Test",
  dataDir: "servers/srv1",
  status: "STOPPED",
  backupRetentionCount: null as number | null,
};

describe("BackupService", () => {
  let tmpDataPath: string;
  let dataDir: string;

  beforeEach(async () => {
    tmpDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "mcpanel-backups-"));
    globalThis.__TEST_DATA_PATH__ = tmpDataPath;
    dataDir = path.join(tmpDataPath, server.dataDir);
    await fs.mkdir(path.join(dataDir, "world"), { recursive: true });
    await fs.writeFile(path.join(dataDir, "world", "level.dat"), "original world");
  });

  afterEach(async () => {
    await fs.rm(tmpDataPath, { recursive: true, force: true });
  });

  it("pauses autosave and flushes the world around a backup of a running server, then resumes it", async () => {
    const consoleApi = { sendCommand: vi.fn(async (_serverId: string, _command: string, _options?: unknown) => "ok") };
    const service = new BackupService(makeFakePrisma() as never, consoleApi);

    await service.create({ ...server, status: "RUNNING" } as never, undefined, undefined);

    expect(consoleApi.sendCommand.mock.calls.map((c) => c[1])).toEqual(["save-off", "save-all flush", "save-on"]);
    expect(consoleApi.sendCommand).toHaveBeenCalledWith("srv1", "save-all flush", expect.objectContaining({ waitFor: expect.any(RegExp) }));
  });

  it("doesn't touch the console for a stopped server", async () => {
    const consoleApi = { sendCommand: vi.fn(async (_serverId: string, _command: string, _options?: unknown) => "ok") };
    await new BackupService(makeFakePrisma() as never, consoleApi).create(server as never, undefined, undefined);
    expect(consoleApi.sendCommand).not.toHaveBeenCalled();
  });

  it("emits created/failed events for notifications", async () => {
    const service = new BackupService(makeFakePrisma() as never);
    const created = vi.fn();
    service.on("created", created);
    await service.create(server as never, "note", undefined);
    expect(created).toHaveBeenCalledWith(server, expect.objectContaining({ note: "note" }));
  });

  it("deletes the oldest unlocked backups beyond the retention count, never locked ones", async () => {
    const prisma = makeFakePrisma();
    const service = new BackupService(prisma as never);
    const first = await service.create(server as never, "first", undefined);
    await service.setLocked(server.id, first.id, true);
    await service.create(server as never, "second", undefined);
    await service.create(server as never, "third", undefined);

    await service.create({ ...server, backupRetentionCount: 1 } as never, "fourth", undefined);

    expect(prisma.backups.map((b) => b.note).sort()).toEqual(["first", "fourth"]);
    const files = await fs.readdir(path.join(tmpDataPath, "backups", server.id));
    expect(files).toHaveLength(2);
  });

  it("refuses to delete a locked backup", async () => {
    const service = new BackupService(makeFakePrisma() as never);
    const backup = await service.create(server as never, undefined, undefined);
    await service.setLocked(server.id, backup.id, true);
    await expect(service.delete(server.id, backup.id)).rejects.toThrow(/locked/);
  });

  it("restores a backup by swapping in the extracted copy", async () => {
    const service = new BackupService(makeFakePrisma() as never);
    const backup = await service.create(server as never, undefined, undefined);
    await fs.writeFile(path.join(dataDir, "world", "level.dat"), "changed since the backup");
    await fs.writeFile(path.join(dataDir, "new-file.txt"), "should disappear");

    await service.restore(server as never, backup.id);

    expect(await fs.readFile(path.join(dataDir, "world", "level.dat"), "utf8")).toBe("original world");
    await expect(fs.stat(path.join(dataDir, "new-file.txt"))).rejects.toThrow();
    // No staging/previous directories left behind next to the data dir.
    expect(await fs.readdir(path.join(tmpDataPath, "servers"))).toEqual(["srv1"]);
  });

  it("leaves the current data untouched when the archive is corrupt", async () => {
    const service = new BackupService(makeFakePrisma() as never);
    const backup = await service.create(server as never, undefined, undefined);
    await fs.writeFile(path.join(tmpDataPath, "backups", server.id, backup.fileName), "definitely not a tarball");
    await fs.writeFile(path.join(dataDir, "world", "level.dat"), "current world");

    await expect(service.restore(server as never, backup.id)).rejects.toThrow(/couldn't be extracted/);

    expect(await fs.readFile(path.join(dataDir, "world", "level.dat"), "utf8")).toBe("current world");
    expect(await fs.readdir(path.join(tmpDataPath, "servers"))).toEqual(["srv1"]);
  });

  it("refuses to restore onto a running server", async () => {
    const service = new BackupService(makeFakePrisma() as never);
    const backup = await service.create(server as never, undefined, undefined);
    await expect(service.restore({ ...server, status: "RUNNING" } as never, backup.id)).rejects.toThrow(/stop the server/i);
  });
});
