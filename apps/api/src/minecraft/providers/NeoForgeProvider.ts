import { httpFetchJson } from "../../lib/httpFetch.js";
import { createTtlCache } from "../../lib/ttlCache.js";
import { BadRequestError } from "../../lib/errors.js";
import { resolveJavaMajor } from "../runtime/runtimeImages.js";
import { compareMcVersions } from "@minecraftpanel/shared";
import { fetchMavenSha256 } from "./maven.js";
import type { InstallPlan, MinecraftServerProvider, ProviderVersion, VersionMap } from "./types.js";

const VERSIONS_URL = "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge";
const MAVEN_BASE = "https://maven.neoforged.net/releases/net/neoforged/neoforge";
const ONE_HOUR_MS = 60 * 60 * 1000;
/** First NeoForge major numbered after Minecraft's year-based versions (Minecraft 26.1, released 2026) rather than "1.x". */
const YEAR_BASED_FROM_MAJOR = 26;

interface NeoForgeVersionsResponse {
  versions: string[];
}

/**
 * NeoForge versions are NOT Minecraft versions, and the mapping changed
 * when Minecraft itself switched to year-based versions:
 *  - Minecraft 1.x (NeoForge 20.x/21.x): "<major>.<minor>.<build>" is
 *    Minecraft "1.<major>.<minor>", with a minor of 0 dropped — NeoForge
 *    "21.1.45" is 1.21.1, "21.0.12" is 1.21 (not 1.21.0).
 *  - Minecraft 26.1 onward: "<year>.<drop>.<hotfix>.<build>" is Minecraft
 *    "<year>.<drop>[.<hotfix>]", with a hotfix of 0 dropped — NeoForge
 *    "26.3.0.95" is 26.3, "26.1.2.122" is 26.1.2.
 * Anything else (e.g. April Fools builds like "0.25w14craftmine.3-beta") has
 * no real Minecraft release behind it and maps to null.
 */
export function neoForgeVersionToMcVersion(neoForgeVersion: string): string | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(neoForgeVersion);
  if (!match) return null;
  const [, majorText, minor, third] = match as unknown as [string, string, string, string];
  const major = Number(majorText);
  if (major >= YEAR_BASED_FROM_MAJOR) {
    return third === "0" ? `${major}.${minor}` : `${major}.${minor}.${third}`;
  }
  if (major < 20) return null;
  return minor === "0" ? `1.${major}` : `1.${major}.${minor}`;
}

interface ParsedNeoForgeVersion {
  /** Numeric segments after the Minecraft-mapped prefix, used to rank builds within one Minecraft version. */
  patchParts: number[];
  isPrerelease: boolean;
}

function parseNeoForgeVersion(version: string): ParsedNeoForgeVersion {
  const core = (version.split(/[-+]/)[0] ?? version).split(".").map((p) => Number.parseInt(p, 10));
  const prefixLength = (core[0] ?? 0) >= YEAR_BASED_FROM_MAJOR ? 3 : 2;
  return { patchParts: core.slice(prefixLength), isPrerelease: version.includes("-") || version.includes("+") };
}

function comparePatch(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** True if `candidate` should replace `current` as the representative build for a Minecraft version: prefer stable, then highest patch. */
export function isBetterNeoForgeBuild(
  candidate: ParsedNeoForgeVersion,
  current: ParsedNeoForgeVersion | undefined,
): boolean {
  if (!current) return true;
  if (candidate.isPrerelease !== current.isPrerelease) return !candidate.isPrerelease;
  return comparePatch(candidate.patchParts, current.patchParts) > 0;
}

export class NeoForgeProvider implements MinecraftServerProvider {
  readonly software = "NEOFORGE" as const;

  constructor(private readonly userAgent: string) {}

  private readonly cache = createTtlCache<VersionMap>(ONE_HOUR_MS, async () => {
    const data = await httpFetchJson<NeoForgeVersionsResponse>(VERSIONS_URL, this.userAgent);
    const map: VersionMap = new Map();
    const parsedByMcVersion = new Map<string, ParsedNeoForgeVersion>();

    for (const neoForgeVersion of data.versions) {
      const mcVersion = neoForgeVersionToMcVersion(neoForgeVersion);
      if (!mcVersion) continue;

      const parsed = parseNeoForgeVersion(neoForgeVersion);
      if (isBetterNeoForgeBuild(parsed, parsedByMcVersion.get(mcVersion))) {
        parsedByMcVersion.set(mcVersion, parsed);
        map.set(mcVersion, { stable: !parsed.isPrerelease, loaderVersion: neoForgeVersion, env: { NEOFORGE_VERSION: neoForgeVersion } });
      }
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
    if (!entry) throw new BadRequestError(`Unknown NeoForge-supported Minecraft version: ${mcVersion}`);
    return { TYPE: "NEOFORGE", ...entry.env };
  }

  async resolveInstallPlan(mcVersion: string): Promise<InstallPlan> {
    const map = await this.cache();
    const version = map.get(mcVersion)?.loaderVersion;
    if (!version) throw new BadRequestError(`Unknown NeoForge-supported Minecraft version: ${mcVersion}`);

    const installerFilename = `neoforge-${version}-installer.jar`;
    // Snapshot builds carry a "+" (e.g. "26.1.0.0-alpha.1+snapshot-1").
    const installerUrl = `${MAVEN_BASE}/${encodeURIComponent(version)}/${encodeURIComponent(installerFilename)}`;
    const [installerSha256, javaMajor] = await Promise.all([
      fetchMavenSha256(installerUrl, this.userAgent),
      resolveJavaMajor(mcVersion, this.userAgent),
    ]);

    return {
      kind: "installer-jar",
      installerUrl,
      installerFilename,
      installerSha256,
      installerArgs: ["--installServer"],
      javaMajor,
      loaderVersion: version,
    };
  }
}
