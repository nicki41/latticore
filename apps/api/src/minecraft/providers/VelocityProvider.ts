import { compareMcVersions } from "@minecraftpanel/shared";
import { httpFetchJson } from "../../lib/httpFetch.js";
import { createTtlCache } from "../../lib/ttlCache.js";
import { BadRequestError } from "../../lib/errors.js";
import type { InstallPlan, MinecraftServerProvider, ProviderVersion } from "./types.js";

// Same PaperMC "Fill" v3 API as PaperProvider — Velocity is a PaperMC project.
const PROJECT_URL = "https://fill.papermc.io/v3/projects/velocity";
const ONE_HOUR_MS = 60 * 60 * 1000;
/** Velocity 3.x runs on 17+, 4.x needs 25 — used only if Fill doesn't report a minimum. */
const FALLBACK_JAVA_MAJOR = 21;

interface VelocityProjectResponse {
  versions: Record<string, string[]>;
}

interface VelocityVersionResponse {
  version: { java?: { version?: { minimum?: number } } };
}

interface VelocityBuild {
  id: number;
  channel: string;
  downloads: Record<string, { name: string; checksums: { sha256: string }; url: string }>;
}

/** Fill channels from most to least trustworthy; anything else (ALPHA, ...) ranks last. */
const CHANNEL_RANK: Record<string, number> = { RECOMMENDED: 0, STABLE: 1, BETA: 2 };

/**
 * Velocity — the modern Minecraft proxy. Its "version" is the proxy's own
 * (e.g. "3.5.1", "4.3.0"), not a Minecraft version: one proxy serves every
 * client version its backends support.
 */
export class VelocityProvider implements MinecraftServerProvider {
  readonly software = "VELOCITY" as const;

  constructor(private readonly userAgent: string) {}

  private readonly versions = createTtlCache<string[]>(ONE_HOUR_MS, async () => {
    const data = await httpFetchJson<VelocityProjectResponse>(PROJECT_URL, this.userAgent);
    return Object.values(data.versions)
      .flat()
      .sort((a, b) => compareMcVersions(b.split("-")[0]!, a.split("-")[0]!) || Number(a.includes("-")) - Number(b.includes("-")));
  });

  async listVersions(): Promise<ProviderVersion[]> {
    // SNAPSHOT builds are pre-releases.
    return (await this.versions()).map((id) => ({ id, stable: !id.includes("-") }));
  }

  async resolveEnv(version: string): Promise<Record<string, string>> {
    if (!(await this.versions()).includes(version)) throw new BadRequestError(`Unknown Velocity version: ${version}`);
    return { TYPE: "VELOCITY", VELOCITY_VERSION: version };
  }

  async resolveInstallPlan(version: string): Promise<InstallPlan> {
    if (!(await this.versions()).includes(version)) throw new BadRequestError(`Unknown Velocity version: ${version}`);

    const base = `${PROJECT_URL}/versions/${encodeURIComponent(version)}`;
    const [info, builds] = await Promise.all([
      httpFetchJson<VelocityVersionResponse>(base, this.userAgent),
      httpFetchJson<VelocityBuild[]>(`${base}/builds`, this.userAgent),
    ]);
    const best = [...builds].sort((a, b) => (CHANNEL_RANK[a.channel] ?? 9) - (CHANNEL_RANK[b.channel] ?? 9) || b.id - a.id)[0];
    if (!best) throw new BadRequestError(`No Velocity builds are available for ${version}.`);
    const download = best.downloads["server:default"];
    if (!download) throw new BadRequestError(`Velocity build ${best.id} has no server download.`);

    return {
      kind: "direct-download",
      url: download.url,
      filename: download.name,
      sha256: download.checksums.sha256,
      javaMajor: info.version.java?.version?.minimum ?? FALLBACK_JAVA_MAJOR,
      loaderVersion: String(best.id),
    };
  }
}
