import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, Puzzle } from "lucide-react";
import { SOFTWARE_TO_MODRINTH_LOADER, isProxySoftware, pluginTerminologyFor } from "@latticore/shared";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/layout/EmptyState";
import { ModrinthResultCard } from "@/components/modrinth/ModrinthResultCard";
import { ModrinthFilterBar } from "@/components/modrinth/ModrinthFilterBar";
import { ModrinthPagination } from "@/components/modrinth/ModrinthPagination";
import { InstalledPluginsList } from "@/components/modrinth/InstalledPluginsList";
import { FeaturedCollectionCard } from "@/components/modrinth/FeaturedCollectionCard";
import { Badge } from "@/components/ui/badge";
import { useFeaturedCollection, useInstalledPlugins, useModrinthSearch, useQuickInstallPlugin } from "@/lib/modrinth";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { useServerOutletContext } from "./useServerOutletContext";

const PAGE_SIZE = 24;

export default function ServerPluginsPage() {
  const { server } = useServerOutletContext();
  const { hasPermission } = useAuth();
  const kind = pluginTerminologyFor(server.software);
  const serverLoader = SOFTWARE_TO_MODRINTH_LOADER[server.software];
  // A proxy's version (e.g. Velocity 3.5.1) isn't a Minecraft version — don't filter or match installs by it.
  const isProxy = isProxySoftware(server.software);
  const serverGameVersion = isProxy ? undefined : server.mcVersion;

  const [query, setQuery] = useState("");
  const [loaderFilter, setLoaderFilter] = useState(serverLoader ?? "all");
  const [gameVersions, setGameVersions] = useState<string[]>(serverGameVersion ? [serverGameVersion] : []);
  const [page, setPage] = useState(0);
  const [installingProjectId, setInstallingProjectId] = useState<string | null>(null);

  function resetToFirstPage<T>(setter: (v: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(0);
    };
  }

  const search = useModrinthSearch(
    {
      query,
      projectTypes: kind === "none" ? [] : [kind],
      loaders: loaderFilter === "all" ? undefined : [loaderFilter],
      gameVersions,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    },
    kind !== "none",
  );
  const installed = useInstalledPlugins(server.id);
  const quickInstall = useQuickInstallPlugin(server.id);

  const installedProjectIds = useMemo(
    () => new Set((installed.data?.installed ?? []).map((p) => p.modrinthProjectId).filter((id): id is string => Boolean(id))),
    [installed.data],
  );
  const featured = useFeaturedCollection().data?.featured;
  // Only what this server can actually load — the promo box disappears entirely for e.g. a Fabric server.
  const compatibleFeatured = useMemo(
    () => (featured && serverLoader ? featured.projects.filter((p) => p.loaders.includes(serverLoader)) : []),
    [featured, serverLoader],
  );
  const total = search.data?.total_hits ?? 0;

  if (kind === "none") {
    return (
      <EmptyState
        icon={Puzzle}
        title="Vanilla servers don't support plugins or mods"
        description="Change the server's software to Paper (plugins) or Fabric/Forge/NeoForge (mods) to use Modrinth installs."
      />
    );
  }

  async function handleInstall(projectId: string, title: string, slug: string, author: string) {
    setInstallingProjectId(projectId);
    try {
      const result = await quickInstall.mutateAsync({ slug, loader: serverLoader, gameVersion: serverGameVersion, author });
      toast.success(`Installed ${title} (${result.filename}). Restart the server to load it.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : `Failed to install ${title}.`);
    } finally {
      setInstallingProjectId(null);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Installed {kind === "plugin" ? "plugins" : "mods"}</CardTitle>
            <CardDescription>Manage what&apos;s loaded on this server.</CardDescription>
          </div>
          <Badge variant="secondary">{kind === "plugin" ? "Plugin loader" : "Mod loader"}: {serverLoader}</Badge>
        </CardHeader>
        <CardContent>
          <InstalledPluginsList server={server} installed={installed.data?.installed ?? []} isLoading={installed.isLoading} />
        </CardContent>
      </Card>

      {featured && (
        <FeaturedCollectionCard
          featured={featured}
          projects={compatibleFeatured}
          install={{
            installedProjectIds,
            installingProjectId,
            canInstall: hasPermission("plugins.install"),
            onInstall: (project) => handleInstall(project.id, project.title, project.slug, featured.author ?? ""),
          }}
        />
      )}

      <div className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold">Browse Modrinth</h2>
          <p className="text-xs text-muted-foreground">
            Installing always picks the newest version matching this server&apos;s actual loader ({serverLoader}){isProxy ? "" : " and Minecraft version"},
            regardless of the loader filter below — the filter is just for browsing/discovery.
          </p>
        </div>

        <ModrinthFilterBar
          query={query}
          onQueryChange={resetToFirstPage(setQuery)}
          searchPlaceholder={`Search ${kind}s...`}
          loader={loaderFilter}
          onLoaderChange={resetToFirstPage(setLoaderFilter)}
          gameVersions={gameVersions}
          onGameVersionsChange={resetToFirstPage(setGameVersions)}
        />

        {search.isLoading && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        )}

        {!search.isLoading && (search.data?.hits.length ?? 0) === 0 && (
          <EmptyState icon={Puzzle} title="No results" description="Try different filters or a different search term." />
        )}

        {!search.isLoading && (search.data?.hits.length ?? 0) > 0 && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {search.data!.hits.map((hit) => (
                <ModrinthResultCard
                  key={hit.project_id}
                  hit={hit}
                  installed={installedProjectIds.has(hit.project_id)}
                  compatibleWith={serverGameVersion}
                  action={{
                    label: installedProjectIds.has(hit.project_id) ? "Reinstall" : "Install",
                    icon: Download,
                    variant: "default",
                    loading: installingProjectId === hit.project_id,
                    disabled: !hasPermission("plugins.install") || installingProjectId !== null,
                    onClick: () => handleInstall(hit.project_id, hit.title, hit.slug, hit.author),
                  }}
                />
              ))}
            </div>

            <ModrinthPagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
          </>
        )}
      </div>
    </div>
  );
}
