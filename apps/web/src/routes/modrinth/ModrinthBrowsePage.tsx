import { useState } from "react";
import { Puzzle, Info } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/layout/EmptyState";
import { ModrinthResultCard } from "@/components/modrinth/ModrinthResultCard";
import { ModrinthFilterBar } from "@/components/modrinth/ModrinthFilterBar";
import { ModrinthPagination } from "@/components/modrinth/ModrinthPagination";
import { FeaturedCollectionCard } from "@/components/modrinth/FeaturedCollectionCard";
import { useFeaturedCollection, useModrinthSearch } from "@/lib/modrinth";
import { resolveTypeFilter, type TypeFilterValue } from "@/lib/modrinthDisplay";

const PAGE_SIZE = 24;

export default function ModrinthBrowsePage() {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<TypeFilterValue>("all");
  const [loader, setLoader] = useState("all");
  const [gameVersions, setGameVersions] = useState<string[]>([]);
  const [page, setPage] = useState(0);

  const { projectTypes, loaders } = resolveTypeFilter(type, loader);
  const search = useModrinthSearch({
    query,
    projectTypes,
    loaders,
    gameVersions,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  function resetToFirstPage<T>(setter: (v: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(0);
    };
  }

  const featured = useFeaturedCollection().data?.featured;
  const total = search.data?.total_hits ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Modrinth</h1>
        <p className="text-sm text-muted-foreground">Browse plugins, mods and modpacks.</p>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>To install something, open a server&apos;s Plugins tab — installs are matched to that server&apos;s software and Minecraft version.</p>
      </div>

      {featured && <FeaturedCollectionCard featured={featured} />}

      <ModrinthFilterBar
        query={query}
        onQueryChange={resetToFirstPage(setQuery)}
        type={type}
        onTypeChange={resetToFirstPage((v: TypeFilterValue) => setType(v))}
        loader={loader}
        onLoaderChange={resetToFirstPage(setLoader)}
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
                action={{
                  label: "View",
                  onClick: () => window.open(`https://modrinth.com/project/${hit.slug}`, "_blank", "noopener,noreferrer"),
                }}
              />
            ))}
          </div>

          <ModrinthPagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
