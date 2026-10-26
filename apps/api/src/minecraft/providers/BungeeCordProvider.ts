import { httpFetchJson } from "../../lib/httpFetch.js";
import { createTtlCache } from "../../lib/ttlCache.js";
import { BadRequestError } from "../../lib/errors.js";
import type { InstallPlan, MinecraftServerProvider, ProviderVersion } from "./types.js";

// SpigotMC's Jenkins (ci.md-5.net now redirects here).
const JOB_URL = "https://hub.spigotmc.org/jenkins/job/BungeeCord";
const ONE_HOUR_MS = 60 * 60 * 1000;
const LISTED_BUILDS = 20;
/** BungeeCord has no per-build Java requirement on record; current builds run on any modern LTS. */
const JAVA_MAJOR = 21;

interface JenkinsJobResponse {
  builds: { number: number; result: string | null }[];
}

/**
 * BungeeCord — the original Minecraft proxy. Versioned by Jenkins build
 * number; newer builds support newer Minecraft clients, there's no separate
 * Minecraft version to pick.
 */
export class BungeeCordProvider implements MinecraftServerProvider {
  readonly software = "BUNGEECORD" as const;

  constructor(private readonly userAgent: string) {}

  private readonly builds = createTtlCache<string[]>(ONE_HOUR_MS, async () => {
    const url = `${JOB_URL}/api/json?tree=${encodeURIComponent(`builds[number,result]{0,${LISTED_BUILDS * 2}}`)}`;
    const data = await httpFetchJson<JenkinsJobResponse>(url, this.userAgent);
    return data.builds
      .filter((b) => b.result === "SUCCESS")
      .slice(0, LISTED_BUILDS)
      .map((b) => String(b.number));
  });

  async listVersions(): Promise<ProviderVersion[]> {
    return (await this.builds()).map((id) => ({ id, stable: true }));
  }

  async resolveEnv(build: string): Promise<Record<string, string>> {
    if (!(await this.builds()).includes(build)) throw new BadRequestError(`Unknown BungeeCord build: ${build}`);
    return { TYPE: "BUNGEECORD", BUNGEE_JOB_ID: build };
  }

  async resolveInstallPlan(build: string): Promise<InstallPlan> {
    if (!(await this.builds()).includes(build)) throw new BadRequestError(`Unknown BungeeCord build: ${build}`);
    return {
      kind: "direct-download",
      // No checksum: Jenkins fingerprints this job's other artifacts, but not
      // the bootstrap jar itself (verified: the published MD5 doesn't match
      // it). Integrity rests on HTTPS from the allowlisted SpigotMC host.
      url: `${JOB_URL}/${build}/artifact/bootstrap/target/BungeeCord.jar`,
      filename: "BungeeCord.jar",
      javaMajor: JAVA_MAJOR,
      loaderVersion: build,
    };
  }
}
