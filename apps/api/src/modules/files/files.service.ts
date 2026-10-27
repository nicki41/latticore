import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import type { Dirent } from "node:fs";
import AdmZip from "adm-zip";
import archiver from "archiver";
type Archiver = ReturnType<typeof archiver>;
import type { FileContentDto, FileEntryDto } from "@latticore/shared";
import { env } from "../../config/env.js";
import { safeResolve, isRootPath } from "../../lib/safePath.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../lib/errors.js";

const MAX_READABLE_FILE_BYTES = 5 * 1024 * 1024; // 5MB — editor is for config files, not world data
const MAX_ZIP_FILE_BYTES = 500 * 1024 * 1024; // 500MB uploaded zip
const MAX_ZIP_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024; // 2GB expanded — guards against decompression bombs
const MAX_ZIP_ENTRY_COUNT = 100_000;
const SEARCH_RESULT_LIMIT = 200;

function isLikelyBinary(buffer: Buffer): boolean {
  const sampleSize = Math.min(buffer.length, 8000);
  for (let i = 0; i < sampleSize; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

function toRelPath(relDir: string, name: string): string {
  const cleanDir = relDir.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  return cleanDir ? `${cleanDir}/${name}` : name;
}

export class FileService {
  rootFor(dataDir: string): string {
    return path.join(env.DATA_PATH, dataDir);
  }

  async list(dataDir: string, relPath: string): Promise<FileEntryDto[]> {
    const root = this.rootFor(dataDir);
    const dirPath = await safeResolve(root, relPath);
    const stat = await fs.stat(dirPath).catch(() => null);
    if (!stat) throw new NotFoundError("Directory not found.");
    if (!stat.isDirectory()) throw new BadRequestError("Path is not a directory.");

    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const results: FileEntryDto[] = [];
    for (const entry of entries) {
      const entryStat = await fs.stat(path.join(dirPath, entry.name)).catch(() => null);
      if (!entryStat) continue; // broken symlink or disappeared mid-read
      results.push({
        name: entry.name,
        path: toRelPath(relPath, entry.name),
        type: entryStat.isDirectory() ? "directory" : "file",
        size: entryStat.size,
        modifiedAt: entryStat.mtime.toISOString(),
      });
    }
    results.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1));
    return results;
  }

  async readContent(dataDir: string, relPath: string): Promise<FileContentDto> {
    const root = this.rootFor(dataDir);
    const filePath = await safeResolve(root, relPath);
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat || !stat.isFile()) throw new NotFoundError("File not found.");
    if (stat.size > MAX_READABLE_FILE_BYTES) {
      throw new BadRequestError(`File is too large to open in the editor (limit ${MAX_READABLE_FILE_BYTES / 1024 / 1024}MB).`);
    }

    const buffer = await fs.readFile(filePath);
    if (isLikelyBinary(buffer)) {
      throw new BadRequestError("This file appears to be binary and can't be edited as text.");
    }

    return { path: relPath, content: buffer.toString("utf8"), size: stat.size, modifiedAt: stat.mtime.toISOString() };
  }

  async writeContent(dataDir: string, relPath: string, content: string): Promise<FileContentDto> {
    const root = this.rootFor(dataDir);
    const filePath = await safeResolve(root, relPath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf8");
    const stat = await fs.stat(filePath);
    return { path: relPath, content, size: stat.size, modifiedAt: stat.mtime.toISOString() };
  }

  async create(dataDir: string, relPath: string, type: "file" | "directory"): Promise<void> {
    const root = this.rootFor(dataDir);
    const targetPath = await safeResolve(root, relPath);
    const exists = await fs.stat(targetPath).catch(() => null);
    if (exists) throw new ConflictError("A file or folder already exists at that path.");

    if (type === "directory") {
      await fs.mkdir(targetPath, { recursive: true });
    } else {
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, "");
    }
  }

  async remove(dataDir: string, relPath: string): Promise<void> {
    if (isRootPath(relPath)) throw new BadRequestError("Cannot delete the server's root directory.");
    const root = this.rootFor(dataDir);
    const targetPath = await safeResolve(root, relPath);
    await fs.rm(targetPath, { recursive: true, force: true });
  }

  async move(dataDir: string, from: string, to: string): Promise<void> {
    if (isRootPath(from)) throw new BadRequestError("Cannot move the server's root directory.");
    const root = this.rootFor(dataDir);
    const fromPath = await safeResolve(root, from);
    const toPath = await safeResolve(root, to);
    if (await fs.stat(toPath).catch(() => null)) throw new ConflictError("A file or folder already exists at the destination.");
    await fs.mkdir(path.dirname(toPath), { recursive: true });
    await fs.rename(fromPath, toPath);
  }

  async copy(dataDir: string, from: string, to: string): Promise<void> {
    const root = this.rootFor(dataDir);
    const fromPath = await safeResolve(root, from);
    const toPath = await safeResolve(root, to);
    if (await fs.stat(toPath).catch(() => null)) throw new ConflictError("A file or folder already exists at the destination.");
    await fs.mkdir(path.dirname(toPath), { recursive: true });
    await fs.cp(fromPath, toPath, { recursive: true });
  }

  async search(dataDir: string, relPath: string, query: string): Promise<FileEntryDto[]> {
    const root = this.rootFor(dataDir);
    const startPath = await safeResolve(root, relPath);
    const needle = query.toLowerCase();
    const results: FileEntryDto[] = [];

    const walk = async (dir: string, relDir: string): Promise<void> => {
      if (results.length >= SEARCH_RESULT_LIMIT) return;
      let entries: Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (results.length >= SEARCH_RESULT_LIMIT) return;
        if (entry.isSymbolicLink()) continue;
        const entryRelPath = toRelPath(relDir, entry.name);
        if (entry.name.toLowerCase().includes(needle)) {
          const entryStat = await fs.stat(path.join(dir, entry.name)).catch(() => null);
          if (entryStat) {
            results.push({
              name: entry.name,
              path: entryRelPath,
              type: entryStat.isDirectory() ? "directory" : "file",
              size: entryStat.size,
              modifiedAt: entryStat.mtime.toISOString(),
            });
          }
        }
        if (entry.isDirectory()) await walk(path.join(dir, entry.name), entryRelPath);
      }
    };

    await walk(startPath, relPath);
    return results;
  }

  /**
   * Extracts a zip already present in the server's directory. Guards
   * against decompression bombs (checked from the zip's central directory,
   * without extracting anything) and zip-slip (every entry's resolved
   * target must land inside the destination folder) before writing
   * anything to disk.
   */
  async extractZip(dataDir: string, zipRelPath: string, destRelPath: string): Promise<void> {
    const root = this.rootFor(dataDir);
    const zipPath = await safeResolve(root, zipRelPath);
    const destPath = await safeResolve(root, destRelPath);

    const stat = await fs.stat(zipPath).catch(() => null);
    if (!stat || !stat.isFile()) throw new NotFoundError("Zip file not found.");
    if (stat.size > MAX_ZIP_FILE_BYTES) {
      throw new BadRequestError(`Zip file is too large to extract (limit ${MAX_ZIP_FILE_BYTES / 1024 / 1024}MB).`);
    }

    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();
    if (entries.length > MAX_ZIP_ENTRY_COUNT) {
      throw new BadRequestError(`Zip file contains too many entries (limit ${MAX_ZIP_ENTRY_COUNT}).`);
    }

    let totalUncompressed = 0;
    for (const entry of entries) {
      totalUncompressed += entry.header.size;
      if (totalUncompressed > MAX_ZIP_UNCOMPRESSED_BYTES) {
        throw new BadRequestError("Zip file would expand to an unreasonably large size — refusing to extract it.");
      }
      const entryTarget = path.resolve(destPath, entry.entryName);
      const relative = path.relative(destPath, entryTarget);
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new BadRequestError(`Zip contains an entry that would extract outside the destination folder: ${entry.entryName}`);
      }
    }

    await fs.mkdir(destPath, { recursive: true });
    zip.extractAllTo(destPath, true);
  }

  /**
   * Streams a directory as a ZIP archive without ever buffering the whole
   * thing in memory or writing a temp file: each file is piped straight
   * from disk into the (backpressure-aware) archiver stream, which the
   * route pipes straight into the HTTP response as it's produced.
   *
   * Symlinks are skipped rather than followed — safeResolve() already
   * guarantees `relPath` itself can't escape the server directory, but a
   * symlink *inside* it could still point outside, and silently including
   * its target in the download would defeat that guarantee.
   */
  async createDirectoryZip(dataDir: string, relPath: string): Promise<Archiver> {
    const root = this.rootFor(dataDir);
    const dirPath = await safeResolve(root, relPath);
    const stat = await fs.stat(dirPath).catch(() => null);
    if (!stat) throw new NotFoundError("Folder not found.");
    if (!stat.isDirectory()) throw new BadRequestError("Only folders can be downloaded as a ZIP.");

    const archive = archiver("zip", { zlib: { level: 6 } });

    const addDir = async (absDir: string, relDir: string): Promise<void> => {
      const entries = await fs.readdir(absDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const absEntry = path.join(absDir, entry.name);
        const relEntry = relDir ? `${relDir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await addDir(absEntry, relEntry);
        } else if (entry.isFile()) {
          archive.append(createReadStream(absEntry), { name: relEntry });
        }
      }
    };

    // Fire-and-forget: the caller starts piping `archive` to the response
    // right away, before this walk finishes. archiver queues appended
    // entries and only reads each file from disk as the consumer drains it.
    void (async () => {
      try {
        await addDir(dirPath, "");
        await archive.finalize();
      } catch (err) {
        archive.destroy(err instanceof Error ? err : new Error(String(err)));
      }
    })();

    return archive;
  }
}
