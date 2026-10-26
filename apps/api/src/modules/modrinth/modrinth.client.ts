import { httpFetchJson } from "../../lib/httpFetch.js";
import { createTtlCache } from "../../lib/ttlCache.js";
import { env } from "../../config/env.js";
import type { ModrinthCollection, ModrinthGameVersion, ModrinthProject, ModrinthSearchResponse, ModrinthVersion } from "@minecraftpanel/shared";

const GAME_VERSIONS_TTL_MS = 60 * 60 * 1000; // Modrinth's version list changes at most a few times a month

export interface ModrinthSearchParams {
  query?: string;
  /** OR'd together, e.g. ["mod", "modpack"]. */
  projectTypes?: string[];
  /** OR'd together, e.g. every plugin-family loader when the UI's "Plugin" type is picked. */
  loaders?: string[];
  /** OR'd together — the UI offers these as a checkbox list, not a single value. */
  gameVersions?: string[];
  limit?: number;
  offset?: number;
}

// Loaders are indexed as a category facet on Modrinth's search backend,
// not a dedicated "loader" facet — see docs.modrinth.com/api/operations/searchprojects.
// Each array below is one AND'd facet group; the values within a group are OR'd.
function buildFacets(params: ModrinthSearchParams): string | undefined {
  const facets: string[][] = [];
  if (params.projectTypes?.length) facets.push(params.projectTypes.map((t) => `project_type:${t}`));
  if (params.loaders?.length) facets.push(params.loaders.map((l) => `categories:${l}`));
  if (params.gameVersions?.length) facets.push(params.gameVersions.map((v) => `versions:${v}`));
  return facets.length > 0 ? JSON.stringify(facets) : undefined;
}

/**
 * Thin, cleanly-encapsulated wrapper around the Modrinth v2 API — every
 * other module talks to Modrinth exclusively through this class, so a
 * future API change (as already happened once with PaperMC's API — see
 * PaperProvider) only needs a fix here.
 */
export class ModrinthClient {
  private readonly baseUrl = env.MODRINTH_API_URL;
  private readonly userAgent = env.MODRINTH_USER_AGENT;
  private readonly gameVersionsCache = createTtlCache(GAME_VERSIONS_TTL_MS, () =>
    httpFetchJson<ModrinthGameVersion[]>(`${this.baseUrl}/tag/game_version`, this.userAgent),
  );

  async search(params: ModrinthSearchParams): Promise<ModrinthSearchResponse> {
    const url = new URL(`${this.baseUrl}/search`);
    if (params.query) url.searchParams.set("query", params.query);
    url.searchParams.set("limit", String(params.limit ?? 20));
    url.searchParams.set("offset", String(params.offset ?? 0));
    const facets = buildFacets(params);
    if (facets) url.searchParams.set("facets", facets);

    return httpFetchJson<ModrinthSearchResponse>(url.toString(), this.userAgent);
  }

  async getProject(idOrSlug: string): Promise<ModrinthProject> {
    return httpFetchJson<ModrinthProject>(`${this.baseUrl}/project/${encodeURIComponent(idOrSlug)}`, this.userAgent);
  }

  async getProjectVersions(idOrSlug: string, params: { loader?: string; gameVersion?: string } = {}): Promise<ModrinthVersion[]> {
    const url = new URL(`${this.baseUrl}/project/${encodeURIComponent(idOrSlug)}/version`);
    if (params.loader) url.searchParams.set("loaders", JSON.stringify([params.loader]));
    if (params.gameVersion) url.searchParams.set("game_versions", JSON.stringify([params.gameVersion]));
    return httpFetchJson<ModrinthVersion[]>(url.toString(), this.userAgent);
  }

  async getVersion(versionId: string): Promise<ModrinthVersion> {
    return httpFetchJson<ModrinthVersion>(`${this.baseUrl}/version/${encodeURIComponent(versionId)}`, this.userAgent);
  }

  /** Full official Minecraft version list Modrinth knows about, newest first — backs the game-version filter checkboxes. */
  async getGameVersions(): Promise<ModrinthGameVersion[]> {
    return this.gameVersionsCache();
  }

  /** Collections only exist on Modrinth's v3 API; everything else here is v2. */
  async getCollection(collectionId: string): Promise<ModrinthCollection> {
    const v3Base = this.baseUrl.replace(/\/v2\/?$/, "/v3");
    return httpFetchJson<ModrinthCollection>(`${v3Base}/collection/${encodeURIComponent(collectionId)}`, this.userAgent);
  }

  async getUsername(userId: string): Promise<string> {
    const user = await httpFetchJson<{ username: string }>(`${this.baseUrl}/user/${encodeURIComponent(userId)}`, this.userAgent);
    return user.username;
  }

  /** Bulk lookup; projects that are private, draft or unlisted are simply absent from the result. */
  async getProjects(ids: string[]): Promise<ModrinthProject[]> {
    if (ids.length === 0) return [];
    const url = new URL(`${this.baseUrl}/projects`);
    url.searchParams.set("ids", JSON.stringify(ids));
    return httpFetchJson<ModrinthProject[]>(url.toString(), this.userAgent);
  }
}
