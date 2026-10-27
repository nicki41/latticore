import { httpFetchJson, httpFetchText } from "../../lib/httpFetch.js";
import { createTtlCache } from "../../lib/ttlCache.js";
import { BadRequestError } from "../../lib/errors.js";
import { resolveJavaMajor } from "../runtime/runtimeImages.js";
import { compareMcVersions } from "@latticore/shared";
import { fetchMavenSha256, parseMavenMetadataVersions } from "./maven.js";
import type { InstallPlan, MinecraftServerProvider, ProviderVersion, VersionMap } from "./types.js";

const PROMOTIONS_URL = "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json";
const MAVEN_BASE = "https://maven.minecraftforge.net/net/minecraftforge/forge";
const METADATA_URL = `${MAVEN_BASE}/maven-metadata.xml`;
const ONE_HOUR_MS = 60 * 60 * 1000;
/** Oldest Minecraft version whose Forge installer supports headless `--installServer` with the panel's install flow. */
const MIN_MC_VERSION = "1.7.10";

interface ForgePromotions {
  promos: Record<string, string>; // "<mcVersion>-recommended" | "<mcVersion>-latest" -> forge build
}

/**
 * Forge's promotions file names a build per Minecraft version, but the
 * Maven artifact version isn't always "<mc>-<build>": 1.7.10–1.9.4 append
 * the Minecraft version again ("1.7.10-10.13.4.1614-1.7.10"). The Maven
 * metadata lists the real artifact versions, so resolve against that
 * instead of guessing the pattern.
 */
export function resolveForgeArtifactVersion(mcVersion: string, build: string, mavenVersions: readonly string[]): string | null {
  const exact = `${mcVersion}-${build}`;
  if (mavenVersions.includes(exact)) return exact;
  return mavenVersions.find((v) => v.startsWith(`${exact}-`)) ?? null;
}

export class ForgeProvider implements MinecraftServerProvider {
  readonly software = "FORGE" as const;

  constructor(private readonly userAgent: string) {}

  private readonly cache = createTtlCache<VersionMap>(ONE_HOUR_MS, async () => {
    const [promotions, metadataXml] = await Promise.all([
      httpFetchJson<ForgePromotions>(PROMOTIONS_URL, this.userAgent),
      httpFetchText(METADATA_URL, this.userAgent),
    ]);
    const mavenVersions = parseMavenMetadataVersions(metadataXml);
    const map: VersionMap = new Map();

    for (const [key, build] of Object.entries(promotions.promos)) {
      const match = /^(\d+(?:\.\d+)+)-(recommended|latest)$/.exec(key);
      if (!match) continue; // also skips odd keys like "1.7.10_pre4-latest"
      const [, mcVersion, kind] = match as unknown as [string, string, "recommended" | "latest"];
      if (compareMcVersions(mcVersion, MIN_MC_VERSION) < 0) continue;

      // "recommended" wins over "latest" when Forge has promoted one; a
      // version with only "latest" (common for the newest Minecraft
      // releases) is still a normal, installable build.
      const existing = map.get(mcVersion);
      if (existing && kind !== "recommended") continue;

      const artifactVersion = resolveForgeArtifactVersion(mcVersion, build, mavenVersions);
      if (!artifactVersion) continue;

      map.set(mcVersion, {
        stable: true,
        loaderVersion: build,
        artifactVersion,
        // Explicit FORGE_VERSION for the legacy (itzg) path rather than
        // leaving it unset for the image to auto-resolve: its auto-resolution
        // has had real-world bug reports picking the wrong build.
        env: { FORGE_VERSION: `${mcVersion}-${build}` },
      });
    }
    return map;
  });

  async listVersions(): Promise<ProviderVersion[]> {
    const map = await this.cache();
    return [...map.entries()]
      .sort(([a], [b]) => compareMcVersions(b, a))
      .map(([id, v]) => ({ id, stable: v.stable }));
  }

  async resolveEnv(mcVersion: string): Promise<Record<string, string>> {
    const map = await this.cache();
    const entry = map.get(mcVersion);
    if (!entry) throw new BadRequestError(`Unknown Forge-supported Minecraft version: ${mcVersion}`);
    return { TYPE: "FORGE", ...entry.env };
  }

  async resolveInstallPlan(mcVersion: string): Promise<InstallPlan> {
    const map = await this.cache();
    const entry = map.get(mcVersion);
    if (!entry?.artifactVersion || !entry.loaderVersion) throw new BadRequestError(`Unknown Forge-supported Minecraft version: ${mcVersion}`);

    const installerFilename = `forge-${entry.artifactVersion}-installer.jar`;
    const installerUrl = `${MAVEN_BASE}/${entry.artifactVersion}/${installerFilename}`;
    const [installerSha256, javaMajor] = await Promise.all([
      fetchMavenSha256(installerUrl, this.userAgent),
      // The installer and the server it produces both run on the Java the
      // underlying Minecraft version needs (e.g. 8 for 1.12.2, 25 for 26.x).
      resolveJavaMajor(mcVersion, this.userAgent),
    ]);

    return {
      kind: "installer-jar",
      installerUrl,
      installerFilename,
      installerSha256,
      installerArgs: ["--installServer"],
      javaMajor,
      loaderVersion: entry.loaderVersion,
    };
  }
}
