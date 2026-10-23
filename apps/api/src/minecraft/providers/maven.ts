import { httpFetchText } from "../../lib/httpFetch.js";
import { BadRequestError } from "../../lib/errors.js";

/**
 * Maven repositories publish a `<artifact>.sha256` next to every artifact
 * (Forge's and NeoForge's both do, for every installer back to 1.7.10).
 * Fetched from the same host as the artifact itself — this guards against a
 * corrupted or truncated download, not against a compromised repository.
 */
export async function fetchMavenSha256(artifactUrl: string, userAgent: string): Promise<string> {
  const text = await httpFetchText(`${artifactUrl}.sha256`, userAgent);
  const hash = text.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new BadRequestError("The installer's published SHA-256 checksum couldn't be read.");
  }
  return hash;
}

/** Every `<version>` entry of a maven-metadata.xml, in file order (oldest first). */
export function parseMavenMetadataVersions(xml: string): string[] {
  return [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]!.trim());
}
