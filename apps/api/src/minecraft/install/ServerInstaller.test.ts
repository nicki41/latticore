import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InstallPlan } from "../providers/types.js";

vi.mock("../../config/env.js", () => ({
  env: {
    get DATA_PATH() {
      return globalThis.__TEST_DATA_PATH__;
    },
  },
}));

const { downloadMock } = vi.hoisted(() => ({ downloadMock: vi.fn(async () => Buffer.from("fake jar bytes")) }));
vi.mock("../../lib/download.js", () => ({ downloadAndVerify: downloadMock }));
vi.mock("../runtime/runtimeImages.js", () => ({ resolveRuntimeImageTag: (javaMajor: number) => `runtime:java${javaMajor}` }));

declare global {
   
  var __TEST_DATA_PATH__: string;
}

const { ServerInstaller, buildLaunchScript, detectLaunchTarget, heapSizeMb } = await import("./ServerInstaller.js");

const server = { id: "srv1", dataDir: "servers/srv1", memoryMb: 4096, containerName: "mcpanel-test-abcd1234" };

/** What a Forge 1.17+/NeoForge installer leaves behind (layout taken from the real installers' data/run.sh templates). */
async function writeModernForgeOutput(root: string, argsFile = "libraries/net/minecraftforge/forge/1.20.1-47.4.0/unix_args.txt") {
  await fs.mkdir(path.join(root, path.dirname(argsFile)), { recursive: true });
  await fs.writeFile(path.join(root, argsFile), "-p libraries/foo.jar\n--add-modules ALL-MODULE-PATH\n");
  await fs.writeFile(path.join(root, "user_jvm_args.txt"), "# -Xmx4G\n");
  await fs.writeFile(path.join(root, "run.sh"), `#!/usr/bin/env sh\njava @user_jvm_args.txt @${argsFile} "$@"\n`);
}

describe("ServerInstaller", () => {
  let tmpDataPath: string;
  let root: string;

  beforeEach(async () => {
    tmpDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "mcpanel-installer-"));
    globalThis.__TEST_DATA_PATH__ = tmpDataPath;
    root = path.join(tmpDataPath, server.dataDir);
    downloadMock.mockClear();
  });

  afterEach(async () => {
    await fs.rm(tmpDataPath, { recursive: true, force: true });
  });

  describe("direct download (Vanilla/Paper/Fabric)", () => {
    it("writes the jar, eula.txt and a java -jar launch script, and records the launch target", async () => {
      const installer = new ServerInstaller({ runInstaller: vi.fn() });
      const plan: InstallPlan = { kind: "direct-download", url: "https://fill-data.papermc.io/paper.jar", filename: "paper-1.21.1-100.jar", sha256: "abc", javaMajor: 21, loaderVersion: "100" };

      const result = await installer.install(server, plan);

      expect(await fs.readFile(path.join(root, "paper-1.21.1-100.jar"), "utf8")).toBe("fake jar bytes");
      expect(await fs.readFile(path.join(root, "eula.txt"), "utf8")).toContain("eula=true");
      expect(await fs.readFile(path.join(root, ".mcpanel-launch.sh"), "utf8")).toContain('-jar "paper-1.21.1-100.jar" nogui');
      expect(result).toMatchObject({ buildVersion: "100", javaImageTag: "runtime:java21" });
      expect(JSON.parse(result.installManifest).launch).toEqual({ kind: "jar", path: "paper-1.21.1-100.jar" });
    });
  });

  describe("installer jar (Forge/NeoForge)", () => {
    const plan: InstallPlan = {
      kind: "installer-jar",
      installerUrl: "https://maven.minecraftforge.net/net/minecraftforge/forge/1.20.1-47.4.0/forge-1.20.1-47.4.0-installer.jar",
      installerFilename: "forge-1.20.1-47.4.0-installer.jar",
      installerSha256: "a".repeat(64),
      installerArgs: ["--installServer"],
      javaMajor: 17,
      loaderVersion: "47.4.0",
    };

    it("verifies the installer's SHA-256, runs it in the server's runtime image, and launches its argsfile", async () => {
      const runInstaller = vi.fn(async () => {
        await writeModernForgeOutput(root);
        return { exitCode: 0, output: "The server installed successfully" };
      });
      const result = await new ServerInstaller({ runInstaller }).install(server, plan);

      expect(downloadMock).toHaveBeenCalledWith(plan.installerUrl, expect.any(Set), { sha256: plan.installerSha256 }, expect.any(Number));
      expect(runInstaller).toHaveBeenCalledWith(
        expect.objectContaining({
          serverId: "srv1",
          containerName: "mcpanel-test-abcd1234-installer",
          javaImageTag: "runtime:java17",
          javaArgs: [`-Xmx${heapSizeMb(4096)}M`, "-jar", "forge-1.20.1-47.4.0-installer.jar", "--installServer"],
        }),
      );

      const script = await fs.readFile(path.join(root, ".mcpanel-launch.sh"), "utf8");
      expect(script).toContain("@user_jvm_args.txt -Xms512M");
      expect(script).toContain("@libraries/net/minecraftforge/forge/1.20.1-47.4.0/unix_args.txt nogui");
      expect(JSON.parse(result.installManifest).launch).toEqual({ kind: "argsfile", path: "libraries/net/minecraftforge/forge/1.20.1-47.4.0/unix_args.txt" });
      // The installer itself is cleaned up afterwards.
      await expect(fs.stat(path.join(root, plan.installerFilename))).rejects.toThrow();
    });

    it("fails with the installer's own last output line when it exits non-zero", async () => {
      const runInstaller = vi.fn(async () => ({ exitCode: 1, output: "Downloading libraries\nERROR: Failed to download net.minecraft:server\n\n" }));
      await expect(new ServerInstaller({ runInstaller }).install(server, plan)).rejects.toThrow(
        "The installer exited with code 1. ERROR: Failed to download net.minecraft:server",
      );
    });

    it("fails clearly when the installer succeeded but left nothing launchable", async () => {
      const runInstaller = vi.fn(async () => ({ exitCode: 0, output: "" }));
      await expect(new ServerInstaller({ runInstaller }).install(server, plan)).rejects.toThrow(/no recognizable server/);
    });
  });

  describe("refreshLaunchScript", () => {
    it("reuses the recorded launch target with the current memory limit", async () => {
      await writeModernForgeOutput(root, "libraries/net/neoforged/neoforge/21.1.264/unix_args.txt");
      const manifest = JSON.stringify({ kind: "installer-jar", launch: { kind: "argsfile", path: "libraries/net/neoforged/neoforge/21.1.264/unix_args.txt" } });

      await new ServerInstaller({ runInstaller: vi.fn() }).refreshLaunchScript({ dataDir: server.dataDir, memoryMb: 8192, installManifest: manifest });

      const script = await fs.readFile(path.join(root, ".mcpanel-launch.sh"), "utf8");
      expect(script).toContain(`-Xmx${heapSizeMb(8192)}M @libraries/net/neoforged/neoforge/21.1.264/unix_args.txt nogui`);
    });

    it("still understands manifests written before launch targets were recorded", async () => {
      await fs.mkdir(root, { recursive: true });
      const manifest = JSON.stringify({ kind: "direct-download", filename: "server.jar" });
      await new ServerInstaller({ runInstaller: vi.fn() }).refreshLaunchScript({ dataDir: server.dataDir, memoryMb: 2048, installManifest: manifest });
      expect(await fs.readFile(path.join(root, ".mcpanel-launch.sh"), "utf8")).toContain('-jar "server.jar" nogui');
    });
  });

  describe("detectLaunchTarget", () => {
    it("prefers the argsfile referenced by run.sh (Forge 1.17+, NeoForge, Forge 26.x with its shim check line)", async () => {
      await writeModernForgeOutput(root, "libraries/net/minecraftforge/forge/26.3-66.1.0/unix_args.txt");
      await fs.writeFile(
        path.join(root, "run.sh"),
        '#!/usr/bin/env sh\njava -jar forge-26.3-66.1.0-shim.jar --onlyCheckJava || exit 1\njava @user_jvm_args.txt @libraries/net/minecraftforge/forge/26.3-66.1.0/unix_args.txt "$@"\n',
      );
      await fs.writeFile(path.join(root, "forge-26.3-66.1.0-shim.jar"), "");
      expect(await detectLaunchTarget(root)).toEqual({ kind: "argsfile", path: "libraries/net/minecraftforge/forge/26.3-66.1.0/unix_args.txt" });
    });

    it("falls back to the forge-<version>.jar older Forge versions produce, ignoring the installer and vanilla jar", async () => {
      await fs.mkdir(root, { recursive: true });
      for (const name of ["forge-1.12.2-14.23.5.2859-installer.jar", "minecraft_server.1.12.2.jar", "forge-1.12.2-14.23.5.2859.jar"]) {
        await fs.writeFile(path.join(root, name), "");
      }
      expect(await detectLaunchTarget(root, "forge-1.12.2-14.23.5.2859-installer.jar")).toEqual({ kind: "jar", path: "forge-1.12.2-14.23.5.2859.jar" });
    });

    it("returns null when there's nothing to launch", async () => {
      await fs.mkdir(root, { recursive: true });
      expect(await detectLaunchTarget(root)).toBeNull();
    });
  });
});

describe("buildLaunchScript", () => {
  it("keeps the panel's memory flags after user_jvm_args.txt, so they always win", () => {
    const script = buildLaunchScript({ kind: "argsfile", path: "libraries/x/unix_args.txt" }, 4096, { userJvmArgsFile: "user_jvm_args.txt" });
    expect(script.indexOf("@user_jvm_args.txt")).toBeLessThan(script.indexOf("-Xmx"));
    expect(script.startsWith("#!/bin/sh\nexec java ")).toBe(true);
  });

  it("leaves real headroom between heap and container limit", () => {
    expect(heapSizeMb(1024)).toBe(768);
    expect(heapSizeMb(4096)).toBe(3686);
    expect(heapSizeMb(32768)).toBe(31744);
  });
});
