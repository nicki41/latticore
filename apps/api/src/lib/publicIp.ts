import { createTtlCache } from "./ttlCache.js";
import { httpFetchJson } from "./httpFetch.js";
import { logger } from "./logger.js";

const TTL_MS = 60 * 60 * 1000; // 1 hour — a home connection's public IP rarely changes, but can

/**
 * The public IP a Minecraft server bound to this host is actually reachable
 * at — genuinely useful to show next to the port (a raw port number alone
 * doesn't tell anyone where to connect), and not sensitive: it's the same
 * information anyone gets by simply connecting to the published game port.
 * Best-effort — returns null (never throws) if outbound access is
 * unavailable or the lookup fails, so the UI can fall back to just the port.
 */
const fetchPublicIp = createTtlCache(TTL_MS, async () => {
  const { ip } = await httpFetchJson<{ ip: string }>("https://api.ipify.org?format=json", "latticore");
  return ip;
});

export async function getPublicIp(): Promise<string | null> {
  try {
    return await fetchPublicIp();
  } catch (err) {
    logger.debug({ err }, "Failed to determine public IP");
    return null;
  }
}
