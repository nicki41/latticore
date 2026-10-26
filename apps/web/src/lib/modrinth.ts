import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  FeaturedCollectionDto,
  InstalledPluginDto,
  InstallModrinthVersionInput,
  ModrinthGameVersion,
  ModrinthProject,
  ModrinthSearchResponse,
  ModrinthVersion,
} from "@minecraftpanel/shared";
import { api } from "./api";

export interface ModrinthSearchParams {
  query?: string;
  projectTypes?: string[];
  loaders?: string[];
  gameVersions?: string[];
  limit?: number;
  offset?: number;
}

function toQueryString(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length > 0) search.set(key, value.join(","));
    } else {
      search.set(key, String(value));
    }
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

export function useModrinthSearch(params: ModrinthSearchParams, enabled = true) {
  return useQuery({
    queryKey: ["modrinth", "search", params],
    queryFn: () => api.get<ModrinthSearchResponse>(`/modrinth/search${toQueryString(params)}`),
    enabled,
    placeholderData: (prev) => prev,
  });
}

/** Modrinth's version list barely ever changes — cached server-side too (see modrinth.client.ts), long staleTime here on top of that. */
export function useModrinthGameVersions() {
  return useQuery({
    queryKey: ["modrinth", "game-versions"],
    queryFn: () => api.get<{ versions: ModrinthGameVersion[] }>("/modrinth/game-versions"),
    staleTime: 60 * 60 * 1000,
  });
}

export function useModrinthProject(idOrSlug: string | undefined) {
  return useQuery({
    queryKey: ["modrinth", "project", idOrSlug],
    queryFn: () => api.get<ModrinthProject>(`/modrinth/project/${idOrSlug}`),
    enabled: Boolean(idOrSlug),
  });
}

export function useModrinthVersions(idOrSlug: string | undefined, params: { loader?: string; gameVersion?: string } = {}) {
  return useQuery({
    queryKey: ["modrinth", "project", idOrSlug, "versions", params],
    queryFn: () => api.get<{ versions: ModrinthVersion[] }>(`/modrinth/project/${idOrSlug}/versions${toQueryString(params)}`),
    enabled: Boolean(idOrSlug),
  });
}

export function useInstalledPlugins(serverId: string) {
  return useQuery({
    queryKey: ["servers", serverId, "plugins"],
    queryFn: () => api.get<{ installed: InstalledPluginDto[] }>(`/servers/${serverId}/plugins`),
  });
}

export function useInstallPlugin(serverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: InstallModrinthVersionInput) => api.post<{ filename: string }>(`/servers/${serverId}/plugins/install`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["servers", serverId, "plugins"] }),
  });
}

/**
 * One click, no version picker: resolves the newest version compatible
 * with this server's loader + Minecraft version and installs it directly.
 * Works the same for plugins (Paper/Spigot/...) and mods (Fabric/Forge/...)
 * — both go through the same install endpoint, matched by loader.
 */
export function useQuickInstallPlugin(serverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      slug,
      loader,
      gameVersion,
      author,
    }: {
      slug: string;
      loader?: string;
      gameVersion: string;
      author?: string;
    }) => {
      const { versions } = await api.get<{ versions: ModrinthVersion[] }>(
        `/modrinth/project/${slug}/versions${toQueryString({ loader, gameVersion })}`,
      );
      const best = versions[0];
      if (!best) throw new Error(`No version of this project is compatible with ${loader ?? "this server's software"} ${gameVersion}.`);
      return api.post<{ filename: string }>(`/servers/${serverId}/plugins/install`, { versionId: best.id, restart: false, author });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["servers", serverId, "plugins"] }),
  });
}

export function useRemovePlugin(serverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (filename: string) => api.delete(`/servers/${serverId}/plugins/${encodeURIComponent(filename)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["servers", serverId, "plugins"] }),
  });
}

export function usePausePlugin(serverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (filename: string) => api.post<{ filename: string }>(`/servers/${serverId}/plugins/${encodeURIComponent(filename)}/pause`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["servers", serverId, "plugins"] }),
  });
}

export function useResumePlugin(serverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (filename: string) => api.post<{ filename: string }>(`/servers/${serverId}/plugins/${encodeURIComponent(filename)}/resume`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["servers", serverId, "plugins"] }),
  });
}

/** The collection promoted at the top of the Modrinth and Plugins pages (null when Modrinth is unreachable). */
export function useFeaturedCollection() {
  return useQuery({
    queryKey: ["modrinth", "featured"],
    queryFn: () => api.get<{ featured: FeaturedCollectionDto | null }>("/modrinth/featured"),
    staleTime: 30 * 60 * 1000,
  });
}
