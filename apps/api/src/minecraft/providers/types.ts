import type { ServerSoftware } from "@latticore/shared";

export interface ProviderVersion {
  id: string;
  stable: boolean;
}

export interface VersionEntry {
  stable: boolean;
  /** Extra env vars (beyond TYPE/VERSION, which the runtime sets generically) the itzg image needs for this exact version. */
  env: Record<string, string>;
  /** Loader/build version this Minecraft version resolves to (Forge/NeoForge) — what gets recorded as Server.buildVersion. */
  loaderVersion?: string;
  /** Exact Maven artifact version of the installer, when it differs from a plain "<mc>-<loader>" (Forge). */
  artifactVersion?: string;
}

export type VersionMap = Map<string, VersionEntry>;

interface InstallPlanBase {
  /** Java major version this software+version needs — see runtime/runtimeImages.ts for how this becomes an actual image tag. */
  javaMajor: number;
  /** Recorded as Server.buildVersion (e.g. a Paper build id, a Fabric/Forge/NeoForge loader version). Null for Vanilla, which has no separate build number. */
  loaderVersion: string | null;
}

/** Vanilla/Paper/Fabric: a single self-contained server jar, downloaded and hash-verified directly — no installer program involved. */
export interface InstallPlanDirectDownload extends InstallPlanBase {
  kind: "direct-download";
  url: string;
  filename: string;
  sha1?: string;
  sha256?: string;
}

/** Forge/NeoForge: a real installer *program* that must be run (java -jar ...) to produce the actual server files — see ServerInstaller. */
export interface InstallPlanInstallerJar extends InstallPlanBase {
  kind: "installer-jar";
  installerUrl: string;
  installerFilename: string;
  /** Required, not optional like the direct-download hashes: both Forge and NeoForge publish one for every installer, and the installer is code the panel executes. */
  installerSha256: string;
  /** Args passed to `java -jar <installerFilename> ...` inside the ephemeral installer container, bind-mounted to /data. */
  installerArgs: string[];
}

export type InstallPlan = InstallPlanDirectDownload | InstallPlanInstallerJar;

/** How the installed server is started — recorded in Server.installManifest so every restart regenerates the same launch command. */
export type LaunchTarget =
  /** `java -jar <path> nogui` — Vanilla/Paper/Fabric, and Forge up to 1.16.5. */
  | { kind: "jar"; path: string }
  /** `java @<path> nogui` — Forge 1.17+ and NeoForge, whose installer writes an argsfile with the module path and main class. */
  | { kind: "argsfile"; path: string };

/**
 * One implementation per server software family. Responsible only for
 * knowing which Minecraft versions that software supports and how to get a
 * working server installed for it — NOT for talking to Docker at all
 * (that's DockerMinecraftRuntime/ServerInstaller, shared by every provider).
 */
export interface MinecraftServerProvider {
  readonly software: ServerSoftware;
  listVersions(): Promise<ProviderVersion[]>;
  /** Legacy path only (Server.runtime === "LEGACY"): itzg/docker-minecraft-server env-var hints. Throws BadRequestError if mcVersion isn't supported. */
  resolveEnv(mcVersion: string): Promise<Record<string, string>>;
  /** Panel-owned install pipeline (Server.runtime === "PANEL_MANAGED"): real download/installer URLs, not env-var hints. Throws BadRequestError if mcVersion — or this software family, while its install pipeline is still being built out — isn't supported yet. */
  resolveInstallPlan(mcVersion: string): Promise<InstallPlan>;
}
