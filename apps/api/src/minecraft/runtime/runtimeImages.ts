import { httpFetchJson } from "../../lib/httpFetch.js";
import { createTtlCache } from "../../lib/ttlCache.js";
import { compareMcVersions } from "@minecraftpanel/shared";

const MANIFEST_URL = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const ONE_HOUR_MS = 60 * 60 * 1000;

/** Versions old enough to predate Mojang's javaVersion field in the per-version manifest (~pre-1.17). Most run fine on Java 8. */
export const LEGACY_JAVA_MAJOR = 8;

interface MojangVersionManifest {
  latest: { release: string };
  versions: { id: string; url: string }[];
}

export interface MojangVersionDetail {
  downloads: { server?: { url: string; sha1: string; size: number } };
  javaVersion?: { majorVersion: number };
}

const manifestIndex = createTtlCache<{ urls: Map<string, string>; latestRelease: string }>(ONE_HOUR_MS, async () => {
  const manifest = await httpFetchJson<MojangVersionManifest>(MANIFEST_URL, "minecraftpanel-runtime-images");
  return { urls: new Map(manifest.versions.map((v) => [v.id, v.url])), latestRelease: manifest.latest.release };
});

// Per-version detail JSON is immutable once Mojang publishes a version — no
// TTL needed, just memoize each version's fetch once (shared across every
// provider so Vanilla's own jar-download lookup and Paper/Fabric/Forge/
// NeoForge's Java-major lookup for the same mcVersion don't double-fetch).
const detailCache = new Map<string, Promise<MojangVersionDetail | null>>();

/**
 * Every server software runs on top of one specific Minecraft version, and
 * Java-version compatibility is a property of THAT version, not whatever's
 * layered on it — so this is shared across all five providers rather than
 * duplicated per-provider.
 */
export async function getMojangVersionDetail(mcVersion: string, userAgent: string): Promise<MojangVersionDetail | null> {
  let promise = detailCache.get(mcVersion);
  if (!promise) {
    promise = fetchDetail(mcVersion, userAgent);
    detailCache.set(mcVersion, promise);
  }
  const detail = await promise;
  if (!detail) detailCache.delete(mcVersion); // don't pin a failed/unknown lookup forever
  return detail;
}

async function fetchDetail(mcVersion: string, userAgent: string): Promise<MojangVersionDetail | null> {
  const { urls } = await manifestIndex();
  const url = urls.get(mcVersion);
  if (!url) return null;
  return httpFetchJson<MojangVersionDetail>(url, userAgent);
}

export async function resolveJavaMajor(mcVersion: string, userAgent: string): Promise<number> {
  const detail = await getMojangVersionDetail(mcVersion, userAgent);
  if (detail?.javaVersion?.majorVersion) return detail.javaVersion.majorVersion;
  if (!detail) {
    // Not a Mojang version id at all — e.g. a loader pre-release built
    // against an upcoming Minecraft version Mojang hasn't released under
    // that exact id. Old-Java fallback would be wrong there; the newest
    // release's requirement is the best available answer.
    const { latestRelease } = await manifestIndex();
    if (compareMcVersions(mcVersion, latestRelease) > 0) {
      const latest = await getMojangVersionDetail(latestRelease, userAgent);
      if (latest?.javaVersion?.majorVersion) return latest.javaVersion.majorVersion;
    }
  }
  return LEGACY_JAVA_MAJOR;
}

// Published by .github/workflows/docker-publish.yml (multi-arch, from
// runtime-images/javaXX/Dockerfile) so a fresh install just pulls these —
// no local build step required. Override the registry/repo prefix via
// RUNTIME_IMAGE_BASE (e.g. for a fork publishing under a different owner,
// or a local dev build tagged the same way).
const RUNTIME_IMAGE_BASE = process.env.RUNTIME_IMAGE_BASE ?? "ghcr.io/nicki41/minecontroller-runtime";

// Covers the full range of Java majors real Minecraft versions currently
// need: 8 for ~pre-1.17 (LEGACY_JAVA_MAJOR fallback), 17 for ~1.18-1.20.4,
// 21 for ~1.20.5 through the last "1.21.x"-numbered release, and 25 from
// the "26.x" release line onward (confirmed live against Mojang's manifest
// — 26.1 was the first release to require it). Mojang bumps this
// periodically; when a version needs a Java major higher than anything
// here, resolveRuntimeImageTag() throws a clear, actionable error instead
// of silently guessing — add the new tag here (and the matching
// runtime-images/javaXX/ image + CI matrix entry) rather than widening an
// existing entry.
const AVAILABLE_JAVA_TAGS: { javaMajor: number; image: string }[] = [
  { javaMajor: 8, image: `${RUNTIME_IMAGE_BASE}:java8` },
  { javaMajor: 17, image: `${RUNTIME_IMAGE_BASE}:java17` },
  { javaMajor: 21, image: `${RUNTIME_IMAGE_BASE}:java21` },
  { javaMajor: 25, image: `${RUNTIME_IMAGE_BASE}:java25` },
];

/** Picks the smallest available runtime image tag whose Java major is >= what the version needs. */
export function resolveRuntimeImageTag(javaMajor: number): string {
  const candidate = [...AVAILABLE_JAVA_TAGS].sort((a, b) => a.javaMajor - b.javaMajor).find((t) => t.javaMajor >= javaMajor);
  if (!candidate) {
    throw new Error(`This Minecraft version needs Java ${javaMajor}, but no runtime image supporting that is available yet.`);
  }
  return candidate.image;
}
