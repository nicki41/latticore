import type { FeaturedCollectionDto } from "@minecraftpanel/shared";
import { createTtlCache } from "../../lib/ttlCache.js";
import { logger } from "../../lib/logger.js";
import type { ModrinthClient } from "./modrinth.client.js";

/**
 * The Modrinth collection the panel promotes on its Modrinth and Plugins
 * pages: UniversalAdmin (admin plugin for Paper and Velocity networks) plus
 * its official extensions. Loaded live, so new or newly-listed projects in
 * the collection show up without a panel release.
 */
export const FEATURED_COLLECTION_ID = "DrMT8zro";
const FEATURED_TTL_MS = 30 * 60 * 1000;

export function createFeaturedCollectionLoader(client: ModrinthClient, collectionId = FEATURED_COLLECTION_ID) {
  const cache = createTtlCache<FeaturedCollectionDto | null>(FEATURED_TTL_MS, async () => {
    try {
      const collection = await client.getCollection(collectionId);
      const [projects, author] = await Promise.all([
        client.getProjects(collection.projects),
        client.getUsername(collection.user).catch(() => null),
      ]);
      // Keep the collection's own order, not whatever order the bulk lookup returns.
      const byId = new Map(projects.map((p) => [p.id, p]));
      return {
        id: collection.id,
        name: collection.name,
        description: collection.description,
        iconUrl: collection.icon_url,
        url: `https://modrinth.com/collection/${collection.id}`,
        author,
        projects: collection.projects
          .map((id) => byId.get(id))
          .filter((p) => p !== undefined)
          .map((p) => ({
            id: p.id,
            slug: p.slug,
            title: p.title,
            description: p.description,
            iconUrl: p.icon_url,
            downloads: p.downloads,
            loaders: p.loaders ?? [],
            gameVersions: p.game_versions ?? [],
          })),
      };
    } catch (err) {
      // A promo box is never worth an error on the page — just leave it out
      // (and retry after the TTL rather than hammering Modrinth).
      logger.warn({ err, collectionId }, "Failed to load featured Modrinth collection");
      return null;
    }
  });
  return cache;
}
