import fs from "node:fs/promises";
import path from "node:path";
import type { Dirent } from "node:fs";
import type { PrismaClient, Server } from "@prisma/client";
import type { InstalledPluginDto, ModrinthVersion, ServerSoftware } from "@latticore/shared";
import { pluginTerminologyFor } from "@latticore/shared";
import { env } from "../../config/env.js";
import { safeResolve } from "../../lib/safePath.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../lib/errors.js";
import { downloadAndVerify } from "../../lib/download.js";
import { ModrinthClient } from "./modrinth.client.js";

/** Suffix a paused plugin/mod's filename carries — see listInstalled() and pause()/resume(). */
const DISABLED_SUFFIX = ".disabled";

/** Folder installed content lands in, matching the server's software family. Vanilla has none. */
function installDirFor(server: Pick<Server, "software">): string | null {
  switch (pluginTerminologyFor(server.software as ServerSoftware)) {
    case "plugin":
      return "plugins";
    case "mod":
      return "mods";
    default:
      return null;
  }
}

/**
 * SSRF hardening: `file.url` originates from Modrinth's API response, not
 * directly from the client, but we still must not let our server fetch an
 * arbitrary attacker-influenced URL (e.g. cloud metadata IPs, internal
 * Docker-network services) if that response were ever spoofed or a project
 * author found a way to smuggle a non-CDN URL into a version's file list.
 * Only Modrinth's own file CDN is trusted as a download source.
 */
const ALLOWED_DOWNLOAD_HOSTS = new Set(["cdn.modrinth.com"]);

export class ModrinthService {
  private readonly client = new ModrinthClient();

  constructor(private readonly prisma: PrismaClient) {}

  get modrinth(): ModrinthClient {
    return this.client;
  }

  /**
   * Downloads the given version's primary file, verifies its hash, places it
   * in the server's plugins/mods folder, and records Modrinth metadata
   * (title/author/icon/slug, fetched from Modrinth rather than trusted from
   * the client) keyed by the installed filename — see listInstalled().
   */
  async install(server: Server, version: ModrinthVersion, authorHint?: string): Promise<{ filename: string }> {
    const dir = installDirFor(server);
    if (!dir) {
      throw new BadRequestError(`${server.software} servers don't support installing plugins or mods.`);
    }

    const file = version.files.find((f) => f.primary) ?? version.files[0];
    if (!file) throw new BadRequestError("This version has no downloadable files.");

    const root = path.join(env.DATA_PATH, server.dataDir);
    const destPath = await safeResolve(root, `${dir}/${file.filename}`);

    const existing = await fs.stat(destPath).catch(() => null);
    if (existing) throw new ConflictError(`${file.filename} is already installed on this server.`);

    const buffer = await downloadAndVerify(file.url, ALLOWED_DOWNLOAD_HOSTS, { sha1: file.hashes.sha1, sha512: file.hashes.sha512 });

    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await fs.writeFile(destPath, buffer);

    const project = await this.client.getProject(version.project_id).catch(() => null);
    if (project) {
      await this.prisma.pluginInstall.upsert({
        where: { serverId_activeFilename: { serverId: server.id, activeFilename: file.filename } },
        create: {
          serverId: server.id,
          activeFilename: file.filename,
          modrinthProjectId: project.id,
          modrinthVersionId: version.id,
          versionNumber: version.version_number,
          title: project.title,
          author: authorHint ?? null,
          iconUrl: project.icon_url,
          slug: project.slug,
        },
        update: {
          modrinthProjectId: project.id,
          modrinthVersionId: version.id,
          versionNumber: version.version_number,
          title: project.title,
          author: authorHint ?? undefined,
          iconUrl: project.icon_url,
          slug: project.slug,
        },
      });
    }

    return { filename: file.filename };
  }

  /**
   * Merges the plugins/mods directory's actual contents (source of truth for
   * what's really loaded) with any Modrinth metadata recorded at install
   * time. A file's PAUSED/ACTIVE status is derived purely from its on-disk
   * name (".jar" vs ".jar.disabled") — never from the DB — so it stays
   * correct even for content that predates this feature or was renamed
   * outside the panel.
   */
  async listInstalled(server: Pick<Server, "id" | "software" | "dataDir">): Promise<InstalledPluginDto[]> {
    const dir = installDirFor(server);
    if (!dir) return [];

    const root = path.join(env.DATA_PATH, server.dataDir);
    const dirPath = await safeResolve(root, dir);

    let entries: Dirent[];
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return [];
    }

    const metaRows = await this.prisma.pluginInstall.findMany({ where: { serverId: server.id } });
    const metaByActiveFilename = new Map(metaRows.map((r) => [r.activeFilename, r]));

    const results: InstalledPluginDto[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const isPaused = entry.name.endsWith(`.jar${DISABLED_SUFFIX}`);
      const isActive = entry.name.endsWith(".jar");
      if (!isPaused && !isActive) continue;

      const activeFilename = isPaused ? entry.name.slice(0, -DISABLED_SUFFIX.length) : entry.name;
      const stat = await fs.stat(path.join(dirPath, entry.name)).catch(() => null);
      if (!stat) continue;

      const meta = metaByActiveFilename.get(activeFilename);
      results.push({
        filename: entry.name,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        status: isPaused ? "PAUSED" : "ACTIVE",
        modrinthProjectId: meta?.modrinthProjectId ?? null,
        modrinthVersionId: meta?.modrinthVersionId ?? null,
        versionNumber: meta?.versionNumber ?? null,
        title: meta?.title ?? null,
        author: meta?.author ?? null,
        iconUrl: meta?.iconUrl ?? null,
        slug: meta?.slug ?? null,
      });
    }
    return results.sort((a, b) => (a.title ?? a.filename).localeCompare(b.title ?? b.filename));
  }

  async remove(server: Pick<Server, "id" | "software" | "dataDir">, filename: string): Promise<void> {
    const dir = installDirFor(server);
    if (!dir) throw new BadRequestError(`${server.software} servers don't support plugins or mods.`);
    assertBareFilename(filename);

    const root = path.join(env.DATA_PATH, server.dataDir);
    const targetPath = await safeResolve(root, `${dir}/${filename}`);
    await fs.rm(targetPath, { force: true });

    const activeFilename = filename.endsWith(DISABLED_SUFFIX) ? filename.slice(0, -DISABLED_SUFFIX.length) : filename;
    await this.prisma.pluginInstall.deleteMany({ where: { serverId: server.id, activeFilename } });
  }

  /** Renames "name.jar" to "name.jar.disabled" so the server's plugin/mod loader — which only scans for the exact ".jar" extension at startup — never picks it up. */
  async pause(server: Pick<Server, "software" | "dataDir">, filename: string): Promise<{ filename: string }> {
    const dir = installDirFor(server);
    if (!dir) throw new BadRequestError(`${server.software} servers don't support plugins or mods.`);
    assertBareFilename(filename);
    if (!filename.endsWith(".jar")) throw new BadRequestError("Only active .jar files can be paused.");

    const root = path.join(env.DATA_PATH, server.dataDir);
    const srcPath = await safeResolve(root, `${dir}/${filename}`);
    const pausedName = `${filename}${DISABLED_SUFFIX}`;
    const destPath = await safeResolve(root, `${dir}/${pausedName}`);

    if (!(await fs.stat(srcPath).catch(() => null))) throw new NotFoundError("File not found.");
    if (await fs.stat(destPath).catch(() => null)) throw new ConflictError(`${pausedName} already exists.`);

    await fs.rename(srcPath, destPath);
    return { filename: pausedName };
  }

  /** Reverses pause(): renames "name.jar.disabled" back to "name.jar". */
  async resume(server: Pick<Server, "software" | "dataDir">, filename: string): Promise<{ filename: string }> {
    const dir = installDirFor(server);
    if (!dir) throw new BadRequestError(`${server.software} servers don't support plugins or mods.`);
    assertBareFilename(filename);
    if (!filename.endsWith(`.jar${DISABLED_SUFFIX}`)) throw new BadRequestError("Only paused files can be resumed.");

    const root = path.join(env.DATA_PATH, server.dataDir);
    const srcPath = await safeResolve(root, `${dir}/${filename}`);
    const activeName = filename.slice(0, -DISABLED_SUFFIX.length);
    const destPath = await safeResolve(root, `${dir}/${activeName}`);

    if (!(await fs.stat(srcPath).catch(() => null))) throw new NotFoundError("File not found.");
    if (await fs.stat(destPath).catch(() => null)) {
      throw new ConflictError(`Cannot resume: ${activeName} already exists (a different file may have replaced it while paused).`);
    }

    await fs.rename(srcPath, destPath);
    return { filename: activeName };
  }
}

function assertBareFilename(filename: string): void {
  if (!filename || filename.includes("/") || filename.includes("\\")) throw new BadRequestError("Invalid filename.");
}
