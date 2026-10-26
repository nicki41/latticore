import fs from "node:fs/promises";
import path from "node:path";
import type { Server } from "@prisma/client";
import { env } from "../../config/env.js";
import { safeResolve } from "../../lib/safePath.js";
import { downloadAndVerify } from "../../lib/download.js";
import { BadRequestError } from "../../lib/errors.js";
import { stripAnsi } from "../../lib/ansi.js";
import { resolveRuntimeImageTag } from "../runtime/runtimeImages.js";
import type { InstallerRunResult, RunInstallerOptions } from "../runtime/DockerMinecraftRuntime.js";
import type { InstallPlan, InstallPlanInstallerJar, LaunchTarget } from "../providers/types.js";

// Download sources — verified live against the real APIs, not assumed:
// Mojang serves the server jar itself from piston-data (not piston-meta,
// which is only the metadata host), Paper serves it from fill-data (not
// fill, which is only the API host — Velocity included), Fabric serves its
// self-contained launcher jar straight from meta.fabricmc.net, Forge/NeoForge
// serve their installer jars from their own Maven repositories, and
// BungeeCord comes from SpigotMC's Jenkins.
const ALLOWED_DOWNLOAD_HOSTS = new Set([
  "piston-data.mojang.com",
  "fill-data.papermc.io",
  "meta.fabricmc.net",
  "maven.minecraftforge.net",
  "maven.neoforged.net",
  "hub.spigotmc.org",
]);

/** Forge/NeoForge installers download every library and patch the vanilla jar — comfortably minutes on a slow link, but never this long unless something is genuinely stuck. */
const INSTALLER_TIMEOUT_MS = 20 * 60 * 1000;
const INSTALLER_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

export const LAUNCH_SCRIPT_FILENAME = ".mcpanel-launch.sh";
/** Forge/NeoForge's own per-server JVM flags file (comments only by default) — honored if present, see buildLaunchScript(). */
const USER_JVM_ARGS_FILENAME = "user_jvm_args.txt";

/** The slice of DockerMinecraftRuntime the installer needs — Forge/NeoForge only. */
export interface InstallerRuntime {
  runInstaller(options: RunInstallerOptions): Promise<InstallerRunResult>;
}

export interface InstallResult {
  buildVersion: string | null;
  javaImageTag: string;
  installManifest: string;
}

/** What installManifest holds: the plan that was installed, plus how to launch the result. */
type InstallManifest = InstallPlan & { launch?: LaunchTarget; resolvedAt?: string };

/**
 * Panel-owned install pipeline for PANEL_MANAGED servers — resolves what to
 * install (via the provider's resolveInstallPlan), fetches/verifies it
 * directly onto the bind-mounted data dir (running the installer program in
 * a throwaway container for Forge/NeoForge), and writes the two files the
 * runtime image's thin entrypoint expects (eula.txt, .mcpanel-launch.sh).
 * Runs entirely before the long-lived server container is ever created, so
 * the INSTALLING phase is deterministic and restarts never depend on the
 * network.
 */
export class ServerInstaller {
  constructor(private readonly runtime: InstallerRuntime) {}

  async install(server: Pick<Server, "id" | "dataDir" | "memoryMb" | "containerName">, plan: InstallPlan): Promise<InstallResult> {
    const root = path.join(env.DATA_PATH, server.dataDir);
    const javaImageTag = resolveRuntimeImageTag(plan.javaMajor);
    await fs.mkdir(root, { recursive: true });

    let launch: LaunchTarget;
    if (plan.kind === "direct-download") {
      await this.downloadServerJar(root, plan);
      launch = { kind: "jar", path: plan.filename };
    } else {
      launch = await this.runInstallerJar(server, root, plan, javaImageTag);
    }

    await this.writeEula(root);
    await this.writeLaunchScript(root, launch, server.memoryMb);

    const manifest: InstallManifest = { ...plan, launch, resolvedAt: new Date().toISOString() };
    return { buildVersion: plan.loaderVersion, javaImageTag, installManifest: JSON.stringify(manifest) };
  }

  /**
   * Regenerates .mcpanel-launch.sh from what's installed (read back from
   * installManifest) and the server's CURRENT memoryMb — called on every
   * (re)start so a changed memory limit actually takes effect, the same way
   * the legacy path's MEMORY env var always has.
   */
  async refreshLaunchScript(server: Pick<Server, "dataDir" | "memoryMb" | "installManifest">): Promise<void> {
    if (!server.installManifest) throw new BadRequestError("Server has no install manifest to refresh a launch script from.");
    const manifest = JSON.parse(server.installManifest) as InstallManifest;
    // Manifests written before `launch` existed are always direct-download
    // ones (Forge/NeoForge weren't installable yet), so the jar is the target.
    const launch: LaunchTarget | null = manifest.launch ?? (manifest.kind === "direct-download" ? { kind: "jar", path: manifest.filename } : null);
    if (!launch) throw new BadRequestError("Server's install manifest doesn't say how to launch it — reinstall the server.");
    const root = path.join(env.DATA_PATH, server.dataDir);
    await this.writeLaunchScript(root, launch, server.memoryMb);
  }

  private async downloadServerJar(root: string, plan: Extract<InstallPlan, { kind: "direct-download" }>): Promise<void> {
    const destPath = await safeResolve(root, plan.filename);
    const buffer = await downloadAndVerify(plan.url, ALLOWED_DOWNLOAD_HOSTS, { sha1: plan.sha1, sha256: plan.sha256 });
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await fs.writeFile(destPath, buffer);
  }

  private async runInstallerJar(
    server: Pick<Server, "id" | "memoryMb" | "containerName">,
    root: string,
    plan: InstallPlanInstallerJar,
    javaImageTag: string,
  ): Promise<LaunchTarget> {
    const installerPath = await safeResolve(root, plan.installerFilename);
    const buffer = await downloadAndVerify(
      plan.installerUrl,
      ALLOWED_DOWNLOAD_HOSTS,
      { sha256: plan.installerSha256 },
      INSTALLER_DOWNLOAD_TIMEOUT_MS,
    );
    await fs.writeFile(installerPath, buffer);

    // A run.sh left over from a previous install (e.g. reinstalling onto a
    // different version) would otherwise be mistaken for this one's output.
    await fs.rm(path.join(root, "run.sh"), { force: true });

    const result = await this.runtime.runInstaller({
      serverId: server.id,
      containerName: `${server.containerName}-installer`,
      javaImageTag,
      memoryMb: server.memoryMb,
      javaArgs: [`-Xmx${heapSizeMb(server.memoryMb)}M`, "-jar", plan.installerFilename, ...plan.installerArgs],
      timeoutMs: INSTALLER_TIMEOUT_MS,
    });
    if (result.exitCode !== 0) {
      throw new BadRequestError(`The installer exited with code ${result.exitCode}. ${lastMeaningfulLine(result.output)}`.trim());
    }

    const launch = await detectLaunchTarget(root, plan.installerFilename);
    if (!launch) {
      throw new BadRequestError("The installer finished, but produced no recognizable server to launch.");
    }
    await fs.rm(installerPath, { force: true });
    return launch;
  }

  private async writeEula(root: string): Promise<void> {
    const destPath = await safeResolve(root, "eula.txt");
    await fs.writeFile(destPath, "#Accepted by the user in the panel's create-server wizard\neula=true\n");
  }

  private async writeLaunchScript(root: string, launch: LaunchTarget, memoryMb: number): Promise<void> {
    const destPath = await safeResolve(root, LAUNCH_SCRIPT_FILENAME);
    const hasUserJvmArgs = launch.kind === "argsfile" && (await fs.stat(path.join(root, USER_JVM_ARGS_FILENAME)).catch(() => null)) !== null;
    await fs.writeFile(destPath, buildLaunchScript(launch, memoryMb, { userJvmArgsFile: hasUserJvmArgs ? USER_JVM_ARGS_FILENAME : null }), { mode: 0o755 });
  }
}

/**
 * Xmx is deliberately BELOW memoryMb: the container's cgroup memory limit
 * (DockerMinecraftRuntime's Memory/MemorySwap) is set to the full memoryMb,
 * but the JVM also needs off-heap room beyond -Xmx — metaspace, thread
 * stacks, Netty direct buffers, GC native structures, JIT code cache.
 * Handing the whole budget to the heap leaves none of that room, so the
 * process's RSS eventually creeps past the container limit and gets
 * cgroup-OOM-killed out from under a perfectly healthy JVM (seen in
 * production: java killed by the kernel OOM killer hours into uptime, heap
 * pinned at the container's exact memory limit).
 */
export function heapSizeMb(memoryMb: number): number {
  const headroomMb = Math.min(1024, Math.max(256, Math.round(memoryMb * 0.1)));
  return Math.max(256, memoryMb - headroomMb);
}

/**
 * The three -D flags disable JLine, the interactive line-editing library
 * Vanilla/Paper/Forge/NeoForge/Fabric all bundle for their console reader.
 * With stdin genuinely open (needed for AttachConsoleSession), JLine detects
 * a "real" interactive terminal and actively manages it — printing a "> "
 * prompt, redrawing it after every log line, toggling bracketed-paste/keypad
 * modes — which is exactly right for a human at a real terminal and pure
 * garbage (raw cursor-movement escape codes) once captured as a byte stream
 * and rendered as discrete lines in a browser. -Dterminal.jline=false/
 * -Dterminal.ansi=true are Paper's own documented flags for this exact
 * scenario; -Djline.terminal=jline.UnsupportedTerminal is JLine's own older,
 * broader property, kept alongside for Vanilla/Forge/NeoForge/Fabric. None of
 * this affects the server's ability to *receive* commands via stdin.
 */
const JLINE_FLAGS = "-Djline.terminal=jline.UnsupportedTerminal -Dterminal.jline=false -Dterminal.ansi=true";

/**
 * Xms starts low (not == Xmx) so a freshly created server doesn't commit its
 * whole heap budget before anyone's even joined — the JVM grows it toward
 * the heap limit as actual usage demands. The memoryMb schema's 1024 MB
 * floor keeps the heap limit comfortably above this constant.
 */
const XMS_MB = 512;

export function buildLaunchScript(launch: LaunchTarget, memoryMb: number, options: { userJvmArgsFile?: string | null } = {}): string {
  const memoryFlags = `-Xms${XMS_MB}M -Xmx${heapSizeMb(memoryMb)}M`;
  if (launch.kind === "jar") {
    return `#!/bin/sh\nexec java ${JLINE_FLAGS} ${memoryFlags} -jar "${launch.path}" nogui\n`;
  }
  // Forge 1.17+/NeoForge: the installer's own argsfile carries the module
  // path, main class/shim jar and its program arguments; JVM flags must come
  // before it. A user_jvm_args.txt (where those loaders tell admins to put
  // custom flags) is included first, so its GC/tuning flags apply — but the
  // panel's own memory flags come after it and therefore win, keeping the
  // heap inside the container's memory limit no matter what's in that file.
  const userArgs = options.userJvmArgsFile ? ` @${options.userJvmArgsFile}` : "";
  return `#!/bin/sh\nexec java ${JLINE_FLAGS}${userArgs} ${memoryFlags} @${launch.path} nogui\n`;
}

/**
 * Works out how to start what a Forge/NeoForge installer just produced:
 *  - Forge 1.17+ and every NeoForge: a run.sh whose java line references an
 *    `@libraries/.../unix_args.txt` argsfile — that argsfile is the target.
 *  - Older Forge (1.7.10–1.16.5): a single `forge-<version>[-universal].jar`
 *    in the server root, run with plain `java -jar`.
 */
export async function detectLaunchTarget(root: string, installerFilename?: string): Promise<LaunchTarget | null> {
  const runSh = await fs.readFile(path.join(root, "run.sh"), "utf8").catch(() => null);
  if (runSh) {
    const argsFile = /@(libraries\/[^\s"']+\/unix_args\.txt)/.exec(runSh)?.[1];
    if (argsFile && (await fs.stat(path.join(root, argsFile)).catch(() => null))) {
      return { kind: "argsfile", path: argsFile };
    }
  }

  const entries = await fs.readdir(root).catch(() => [] as string[]);
  const jar = entries
    .filter((name) => /^(forge|neoforge)-.+\.jar$/i.test(name))
    .filter((name) => name !== installerFilename && !/-(installer|shim)\.jar$/i.test(name))
    .sort()[0];
  return jar ? { kind: "jar", path: jar } : null;
}

/** The installer's last non-blank output line — usually the actual reason it failed. */
function lastMeaningfulLine(output: string): string {
  const lines = stripAnsi(output)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const last = lines.at(-1) ?? "";
  return last.length > 240 ? `${last.slice(0, 237)}...` : last;
}
