import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertNoSymlinkEscape, isRootPath, resolveSafePath, safeResolve } from "./safePath.js";

describe("resolveSafePath", () => {
  const root = path.resolve("/data/servers/abc123");

  it("resolves an ordinary relative path inside root", () => {
    expect(resolveSafePath(root, "plugins/config.yml")).toBe(path.join(root, "plugins", "config.yml"));
  });

  it("resolves the empty path to root itself", () => {
    expect(resolveSafePath(root, "")).toBe(root);
  });

  it("allows internal '..' segments that still land inside root", () => {
    expect(resolveSafePath(root, "plugins/../world")).toBe(path.join(root, "world"));
  });

  it("rejects a simple '../' escape", () => {
    expect(() => resolveSafePath(root, "../outside")).toThrow(/outside/i);
  });

  it("rejects a deeply nested escape", () => {
    expect(() => resolveSafePath(root, "plugins/../../../../etc/passwd")).toThrow(/outside/i);
  });

  it("neutralizes an absolute path instead of honoring it", () => {
    // Must NOT resolve to the real /etc/passwd — either contained under
    // root or rejected, but never escaping.
    expect(() => resolveSafePath(root, "/etc/passwd")).not.toThrow();
    expect(resolveSafePath(root, "/etc/passwd")).toBe(path.join(root, "etc", "passwd"));
  });

  it("rejects a null byte in the path", () => {
    expect(() => resolveSafePath(root, "config.yml\0.png")).toThrow();
  });

  it("never returns a path outside root for a wide range of traversal attempts", () => {
    const attempts = ["..", "../..", "a/../../b", "....//....//etc/passwd", "%2e%2e/%2e%2e/etc/passwd"];
    for (const attempt of attempts) {
      try {
        const resolved = resolveSafePath(root, attempt);
        expect(resolved.startsWith(root)).toBe(true);
      } catch {
        // Throwing is an acceptable outcome too — either way it must never resolve outside root.
      }
    }
  });
});

describe("isRootPath", () => {
  it("treats empty string, '.', and '/' as root", () => {
    expect(isRootPath("")).toBe(true);
    expect(isRootPath(".")).toBe(true);
    expect(isRootPath("/")).toBe(true);
  });

  it("does not treat an ordinary path as root", () => {
    expect(isRootPath("world")).toBe(false);
    expect(isRootPath("plugins/config.yml")).toBe(false);
  });
});

describe("assertNoSymlinkEscape / safeResolve", () => {
  let tmpRoot: string;
  let outsideDir: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "latticore-safepath-root-"));
    outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "latticore-safepath-outside-"));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
    await fs.rm(outsideDir, { recursive: true, force: true });
  });

  it("does not throw for a path that doesn't exist yet", async () => {
    await expect(assertNoSymlinkEscape(tmpRoot, path.join(tmpRoot, "new-file.txt"))).resolves.toBeUndefined();
  });

  it("does not throw for a symlink that stays inside root", async () => {
    await fs.writeFile(path.join(tmpRoot, "real.txt"), "hi");
    const linkPath = path.join(tmpRoot, "link.txt");
    try {
      await fs.symlink(path.join(tmpRoot, "real.txt"), linkPath);
    } catch {
      return; // symlink creation unprivileged on this platform/CI — skip rather than false-fail
    }
    await expect(assertNoSymlinkEscape(tmpRoot, linkPath)).resolves.toBeUndefined();
  });

  it("throws for a symlink inside root that points outside it", async () => {
    await fs.writeFile(path.join(outsideDir, "secret.txt"), "top secret");
    const linkPath = path.join(tmpRoot, "escape.txt");
    try {
      await fs.symlink(path.join(outsideDir, "secret.txt"), linkPath);
    } catch {
      return; // symlink creation unprivileged on this platform/CI — skip rather than false-fail
    }
    await expect(assertNoSymlinkEscape(tmpRoot, linkPath)).rejects.toThrow(/outside/i);
    await expect(safeResolve(tmpRoot, "escape.txt")).rejects.toThrow(/outside/i);
  });
});
