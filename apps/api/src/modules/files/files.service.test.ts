import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import AdmZip from "adm-zip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileService } from "./files.service.js";

/** Drains an archiver stream into a buffer so tests can inspect the resulting zip. */
async function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

// FileService resolves roots via DATA_PATH + a dataDir; point DATA_PATH at
// a fresh temp directory per test and use a fixed dataDir under it.
vi.mock("../../config/env.js", () => ({ env: { get DATA_PATH() { return globalThis.__TEST_DATA_PATH__; } } }));

declare global {
   
  var __TEST_DATA_PATH__: string;
}

describe("FileService", () => {
  const dataDir = "servers/test-server";
  let service: FileService;
  let tmpDataPath: string;
  let root: string;

  beforeEach(async () => {
    tmpDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "latticore-files-"));
    globalThis.__TEST_DATA_PATH__ = tmpDataPath;
    root = path.join(tmpDataPath, dataDir);
    await fs.mkdir(root, { recursive: true });
    service = new FileService();
  });

  afterEach(async () => {
    await fs.rm(tmpDataPath, { recursive: true, force: true });
  });

  it("creates, writes, reads, and lists a file end to end", async () => {
    await service.create(dataDir, "config.yml", "file");
    await service.writeContent(dataDir, "config.yml", "hello: world");

    const content = await service.readContent(dataDir, "config.yml");
    expect(content.content).toBe("hello: world");

    const listing = await service.list(dataDir, "");
    expect(listing.map((e) => e.name)).toContain("config.yml");
  });

  it("refuses to delete the server's root directory", async () => {
    await expect(service.remove(dataDir, "")).rejects.toThrow(/root directory/i);
    await expect(service.remove(dataDir, ".")).rejects.toThrow(/root directory/i);
  });

  it("moves and copies files within the server directory", async () => {
    await service.create(dataDir, "a.txt", "file");
    await service.move(dataDir, "a.txt", "b.txt");
    await expect(service.readContent(dataDir, "a.txt")).rejects.toThrow();
    expect((await service.readContent(dataDir, "b.txt")).content).toBe("");

    await service.copy(dataDir, "b.txt", "c.txt");
    const listing = await service.list(dataDir, "");
    expect(listing.map((e) => e.name).sort()).toEqual(["b.txt", "c.txt"]);
  });

  describe("extractZip (zip-slip protection)", () => {
    async function writeZip(entries: { name: string; content: string }[]): Promise<string> {
      const zip = new AdmZip();
      for (const entry of entries) zip.addFile(entry.name, Buffer.from(entry.content));
      const zipPath = path.join(root, "upload.zip");
      zip.writeZip(zipPath);
      return "upload.zip";
    }

    /**
     * adm-zip's own addFile() sanitizes "../" and leading "/" out of entry
     * names as it writes them, so building a "malicious" zip via addFile()
     * alone never actually produces one — it silently tests nothing. A raw
     * zip (crafted by a different tool, or by hand) has no such
     * restriction: the zip *format* allows arbitrary entry names, and
     * that's exactly what extractZip's own defense has to hold up against.
     * Reassigning .entryName after addFile() bypasses adm-zip's sanitizing
     * setter and round-trips through a real byte buffer, so what
     * extractZip reads back is a genuine hostile entry name.
     */
    async function writeMaliciousZip(maliciousEntryName: string, content: string): Promise<string> {
      const zip = new AdmZip();
      zip.addFile("placeholder", Buffer.from(content));
      zip.getEntries()[0]!.entryName = maliciousEntryName;
      const zipPath = path.join(root, "evil.zip");
      await fs.writeFile(zipPath, zip.toBuffer());
      return "evil.zip";
    }

    it("extracts a well-behaved zip normally", async () => {
      const zipRelPath = await writeZip([{ name: "plugin.jar", content: "fake jar" }]);
      await service.extractZip(dataDir, zipRelPath, "plugins");
      const listing = await service.list(dataDir, "plugins");
      expect(listing.map((e) => e.name)).toEqual(["plugin.jar"]);
    });

    it("rejects a zip entry that tries to escape the destination via '../'", async () => {
      const zipRelPath = await writeMaliciousZip("../../evil.sh", "rm -rf /");
      await expect(service.extractZip(dataDir, zipRelPath, "plugins")).rejects.toThrow(/outside/i);

      // Confirm nothing was written outside the intended destination.
      await expect(fs.stat(path.join(tmpDataPath, "evil.sh"))).rejects.toThrow();
      await expect(fs.stat(path.join(os.tmpdir(), "evil.sh"))).rejects.toThrow();
    });

    it("rejects a zip entry using an absolute path", async () => {
      const zipRelPath = await writeMaliciousZip("/etc/evil.conf", "evil");
      await expect(service.extractZip(dataDir, zipRelPath, "plugins")).rejects.toThrow(/outside/i);
    });
  });

  describe("createDirectoryZip", () => {
    it("streams a folder's contents (including nested subfolders) into a valid zip", async () => {
      await service.create(dataDir, "plugins", "directory");
      await service.writeContent(dataDir, "plugins/a.jar", "fake jar a");
      await service.create(dataDir, "plugins/nested", "directory");
      await service.writeContent(dataDir, "plugins/nested/b.txt", "nested file");

      const archive = await service.createDirectoryZip(dataDir, "plugins");
      const buffer = await collect(archive);

      const outPath = path.join(tmpDataPath, "out.zip");
      await fs.writeFile(outPath, buffer);
      const zip = new AdmZip(outPath);
      const names = zip.getEntries().map((e) => e.entryName).sort();
      expect(names).toEqual(["a.jar", "nested/b.txt"]);
      expect(zip.readAsText("a.jar")).toBe("fake jar a");
    });

    it("rejects zipping a single file (not a directory)", async () => {
      await service.create(dataDir, "solo.txt", "file");
      await expect(service.createDirectoryZip(dataDir, "solo.txt")).rejects.toThrow(/folder/i);
    });

    it("404s for a folder that doesn't exist", async () => {
      await expect(service.createDirectoryZip(dataDir, "nope")).rejects.toThrow(/not found/i);
    });

    it("refuses to escape the server directory via '../' in the requested path", async () => {
      await expect(service.createDirectoryZip(dataDir, "../../etc")).rejects.toThrow(/outside/i);
    });

    it("skips symlinks instead of following them out of the server directory", async () => {
      const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "latticore-outside-"));
      await fs.writeFile(path.join(outsideDir, "secret.txt"), "should not appear in the zip");

      await service.create(dataDir, "plugins", "directory");
      await service.writeContent(dataDir, "plugins/a.jar", "fake jar a");
      await fs.symlink(outsideDir, path.join(root, "plugins", "escape-link"), "junction").catch(() =>
        fs.symlink(outsideDir, path.join(root, "plugins", "escape-link")),
      );

      const archive = await service.createDirectoryZip(dataDir, "plugins");
      const buffer = await collect(archive);
      const outPath = path.join(tmpDataPath, "out2.zip");
      await fs.writeFile(outPath, buffer);
      const zip = new AdmZip(outPath);
      const names = zip.getEntries().map((e) => e.entryName);
      expect(names).toEqual(["a.jar"]);

      await fs.rm(outsideDir, { recursive: true, force: true });
    });
  });
});
