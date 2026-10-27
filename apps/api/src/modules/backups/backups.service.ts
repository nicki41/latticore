import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import * as tar from "tar";
import type { PrismaClient, Server } from "@prisma/client";
import type { BackupDto, BackupSettingsDto } from "@latticore/shared";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../lib/errors.js";

/** Minecraft's own reply once `save-all flush` has written every chunk to disk (the console isn't localized). */
const SAVE_COMPLETE = /Saved the game/i;
/** A flush of a large world can take a while — the main thread is blocked writing region files the whole time. */
const SAVE_FLUSH_TIMEOUT_MS = 3 * 60 * 1000;

/** The slice of MinecraftServerManager a backup needs, to pause autosave around the archive step. */
export interface BackupConsole {
  sendCommand(serverId: string, command: string, options?: { silent?: boolean; timeoutMs?: number; waitFor?: RegExp }): Promise<string>;
}

function backupsDirFor(serverId: string): string {
  return path.join(env.DATA_PATH, "backups", serverId);
}

function serverDataDirFor(server: Pick<Server, "dataDir">): string {
  return path.join(env.DATA_PATH, server.dataDir);
}

function serialize(backup: {
  id: string;
  fileName: string;
  sizeBytes: bigint;
  note: string | null;
  locked: boolean;
  createdAt: Date;
  createdBy: { username: string } | null;
}): BackupDto {
  return {
    id: backup.id,
    fileName: backup.fileName,
    sizeBytes: backup.sizeBytes.toString(),
    note: backup.note,
    locked: backup.locked,
    createdByUsername: backup.createdBy?.username ?? null,
    createdAt: backup.createdAt.toISOString(),
  };
}

export interface BackupService {
  on(event: "created", listener: (server: Server, backup: BackupDto) => void): this;
  on(event: "failed", listener: (server: Server, err: unknown) => void): this;
  emit(event: "created", server: Server, backup: BackupDto): boolean;
  emit(event: "failed", server: Server, err: unknown): boolean;
}

/**
 * Whole-data-directory tar.gz backups, stored in DATA_PATH/backups/<serverId>/
 * (outside the server's own directory, so a restore never overwrites the
 * backups it could restore from). One shared instance (plugins/backups.ts)
 * serves both the REST routes and scheduled BACKUP steps, so both get the
 * same consistency handling, retention, and "created"/"failed" events
 * (which drive the backup notification category).
 */
export class BackupService extends EventEmitter {
  /** Servers with a backup or restore in flight — the two must never overlap on the same data directory. */
  private readonly busyServerIds = new Set<string>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly console?: BackupConsole,
  ) {
    super();
  }

  async list(serverId: string): Promise<BackupDto[]> {
    const backups = await this.prisma.backup.findMany({
      where: { serverId },
      orderBy: { createdAt: "desc" },
      include: { createdBy: { select: { username: true } } },
    });
    return backups.map(serialize);
  }

  getSettings(server: Pick<Server, "backupRetentionCount">): BackupSettingsDto {
    return { retentionCount: server.backupRetentionCount };
  }

  /** `retentionCount` null = keep every backup. Applied immediately, not just on the next backup. */
  async updateSettings(server: Server, input: { retentionCount: number | null }): Promise<BackupSettingsDto> {
    const updated = await this.prisma.server.update({ where: { id: server.id }, data: { backupRetentionCount: input.retentionCount } });
    await this.enforceRetention(updated);
    return this.getSettings(updated);
  }

  /**
   * Safe to run while the server is up: autosave is paused and every chunk
   * flushed to disk first (save-off + save-all flush), so the archive never
   * captures a half-written region file, then autosave is resumed no matter
   * how the archive step went. If the console can't be reached the backup
   * still proceeds — a best-effort snapshot beats none, and it's no worse
   * than a backup taken by any external tool.
   */
  async create(server: Server, note: string | undefined, createdById: string | undefined): Promise<BackupDto> {
    return this.exclusive(server.id, async () => {
      try {
        const backup = await this.createArchive(server, note, createdById);
        await this.enforceRetention(server).catch((err) => logger.error({ err, serverId: server.id }, "Backup retention cleanup failed"));
        this.emit("created", server, backup);
        return backup;
      } catch (err) {
        this.emit("failed", server, err);
        throw err;
      }
    });
  }

  async getFilePath(serverId: string, backupId: string): Promise<{ path: string; fileName: string }> {
    const backup = await this.requireBackup(serverId, backupId);
    return { path: path.join(backupsDirFor(serverId), backup.fileName), fileName: backup.fileName };
  }

  async setLocked(serverId: string, backupId: string, locked: boolean): Promise<BackupDto> {
    await this.requireBackup(serverId, backupId);
    const backup = await this.prisma.backup.update({
      where: { id: backupId },
      data: { locked },
      include: { createdBy: { select: { username: true } } },
    });
    return serialize(backup);
  }

  async delete(serverId: string, backupId: string): Promise<void> {
    const backup = await this.requireBackup(serverId, backupId);
    if (backup.locked) throw new ConflictError("This backup is locked — unlock it before deleting it.");
    await this.deleteBackupRow(serverId, backup);
  }

  /**
   * Replaces the data directory with the backup's contents — extracted into
   * a staging directory first and only swapped in once extraction fully
   * succeeded, so a corrupt or truncated archive leaves the current data
   * untouched instead of half-deleted. Requires a stopped server.
   */
  async restore(server: Server, backupId: string): Promise<void> {
    if (server.status !== "STOPPED" && server.status !== "ERROR") {
      throw new ConflictError("Stop the server before restoring a backup.");
    }
    const backup = await this.requireBackup(server.id, backupId);
    const backupPath = path.join(backupsDirFor(server.id), backup.fileName);

    await this.exclusive(server.id, async () => {
      const dataDir = serverDataDirFor(server);
      const stamp = Date.now();
      // Siblings of the data dir, so the final renames stay on one filesystem (atomic, no copy).
      const staging = `${dataDir}.restore-${stamp}`;
      const previous = `${dataDir}.pre-restore-${stamp}`;

      await fs.mkdir(staging, { recursive: true });
      try {
        await tar.extract({ file: backupPath, cwd: staging, strict: true });
      } catch (err) {
        await fs.rm(staging, { recursive: true, force: true });
        logger.error({ err, serverId: server.id, backupId }, "Backup extraction failed");
        throw new BadRequestError("The backup archive couldn't be extracted — nothing was changed.");
      }

      const hadData = await fs.rename(dataDir, previous).then(
        () => true,
        (err: NodeJS.ErrnoException) => {
          if (err.code === "ENOENT") return false;
          throw err;
        },
      );
      try {
        await fs.rename(staging, dataDir);
      } catch (err) {
        if (hadData) await fs.rename(previous, dataDir).catch(() => {});
        await fs.rm(staging, { recursive: true, force: true });
        throw err;
      }
      if (hadData) {
        await fs.rm(previous, { recursive: true, force: true }).catch((err) => logger.warn({ err, serverId: server.id }, "Failed to clean up pre-restore data"));
      }
    });
  }

  /** Called from server deletion so backups don't become orphaned files with no owning server. */
  async deleteAllForServer(serverId: string): Promise<void> {
    await fs.rm(backupsDirFor(serverId), { recursive: true, force: true }).catch(() => {});
  }

  private async createArchive(server: Server, note: string | undefined, createdById: string | undefined): Promise<BackupDto> {
    const dir = backupsDirFor(server.id);
    await fs.mkdir(dir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `${timestamp}.tar.gz`;
    const backupPath = path.join(dir, fileName);
    const dataDir = serverDataDirFor(server);
    await fs.mkdir(dataDir, { recursive: true });

    const resumeAutosave = await this.pauseAutosave(server);
    try {
      await tar.create({ gzip: true, file: backupPath, cwd: dataDir }, ["."]);
    } catch (err) {
      await fs.rm(backupPath, { force: true });
      throw err;
    } finally {
      await resumeAutosave();
    }

    const stat = await fs.stat(backupPath);
    const backup = await this.prisma.backup.create({
      data: { serverId: server.id, fileName, sizeBytes: BigInt(stat.size), note: note ?? null, createdById },
      include: { createdBy: { select: { username: true } } },
    });
    return serialize(backup);
  }

  /** Returns the function that turns autosave back on — always safe to call, even if pausing didn't happen. */
  private async pauseAutosave(server: Server): Promise<() => Promise<void>> {
    const consoleApi = this.console;
    if (!consoleApi || server.status !== "RUNNING") return async () => {};

    try {
      await consoleApi.sendCommand(server.id, "save-off", { silent: true });
    } catch (err) {
      logger.warn({ err, serverId: server.id }, "Couldn't pause autosave before backup; taking a best-effort snapshot");
      return async () => {};
    }
    const resume = async () => {
      await consoleApi.sendCommand(server.id, "save-on", { silent: true }).catch((err) => {
        logger.error({ err, serverId: server.id }, "Failed to re-enable autosave after backup — run save-on manually");
      });
    };
    try {
      await consoleApi.sendCommand(server.id, "save-all flush", { silent: true, timeoutMs: SAVE_FLUSH_TIMEOUT_MS, waitFor: SAVE_COMPLETE });
    } catch (err) {
      logger.warn({ err, serverId: server.id }, "World flush before backup didn't confirm; continuing");
    }
    return resume;
  }

  /** Deletes the oldest unlocked backups beyond the server's retention count. Locked backups neither count nor get deleted. */
  private async enforceRetention(server: Pick<Server, "id" | "backupRetentionCount">): Promise<void> {
    const keep = server.backupRetentionCount;
    if (keep === null || keep === undefined) return;
    const unlocked = await this.prisma.backup.findMany({
      where: { serverId: server.id, locked: false },
      orderBy: { createdAt: "desc" },
    });
    for (const backup of unlocked.slice(keep)) {
      await this.deleteBackupRow(server.id, backup);
      logger.info({ serverId: server.id, backupId: backup.id }, "Deleted backup beyond retention limit");
    }
  }

  private async deleteBackupRow(serverId: string, backup: { id: string; fileName: string }): Promise<void> {
    await fs.rm(path.join(backupsDirFor(serverId), backup.fileName), { force: true });
    await this.prisma.backup.delete({ where: { id: backup.id } });
  }

  private async exclusive<T>(serverId: string, fn: () => Promise<T>): Promise<T> {
    if (this.busyServerIds.has(serverId)) {
      throw new ConflictError("A backup or restore is already running for this server.");
    }
    this.busyServerIds.add(serverId);
    try {
      return await fn();
    } finally {
      this.busyServerIds.delete(serverId);
    }
  }

  private async requireBackup(serverId: string, backupId: string) {
    const backup = await this.prisma.backup.findUnique({ where: { id: backupId } });
    if (!backup || backup.serverId !== serverId) throw new NotFoundError("Backup not found.");
    return backup;
  }
}
