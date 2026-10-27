import { CheckCircle2, Download, ExternalLink, Puzzle, Sparkles } from "lucide-react";
import type { FeaturedCollectionDto, FeaturedProjectDto } from "@latticore/shared";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCompactNumber } from "@/lib/format";

const LOADER_LABELS: Record<string, string> = {
  paper: "Paper",
  purpur: "Purpur",
  spigot: "Spigot",
  bukkit: "Bukkit",
  folia: "Folia",
  velocity: "Velocity",
  bungeecord: "BungeeCord",
  waterfall: "Waterfall",
  fabric: "Fabric",
  forge: "Forge",
  neoforge: "NeoForge",
};

/** Present on a server's Plugins tab: lets each project be installed straight onto that server. */
export interface FeaturedInstallContext {
  installedProjectIds: Set<string>;
  installingProjectId: string | null;
  canInstall: boolean;
  onInstall: (project: FeaturedProjectDto) => void;
}

interface FeaturedCollectionCardProps {
  featured: FeaturedCollectionDto;
  /** Only these projects are listed — e.g. the ones compatible with the current server. Defaults to all. */
  projects?: FeaturedProjectDto[];
  install?: FeaturedInstallContext;
}

/**
 * The promoted Modrinth collection (UniversalAdmin and its extensions — see
 * the API's modrinth.featured.ts), shown above the regular search results.
 */
export function FeaturedCollectionCard({ featured, projects = featured.projects, install }: FeaturedCollectionCardProps) {
  if (projects.length === 0) return null;

  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
            {featured.iconUrl ? <img src={featured.iconUrl} alt="" className="h-full w-full object-cover" /> : <Puzzle className="h-6 w-6 text-muted-foreground" />}
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">{featured.name}</h2>
              <Badge className="gap-1">
                <Sparkles className="h-3 w-3" /> Recommended
              </Badge>
            </div>
            {featured.description && <p className="text-sm text-muted-foreground">{featured.description}</p>}
          </div>
          <Button asChild variant="outline" size="sm">
            <a href={featured.url} target="_blank" rel="noreferrer">
              <ExternalLink className="h-3.5 w-3.5" /> View collection
            </a>
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => {
            const installed = install?.installedProjectIds.has(project.id) ?? false;
            return (
              <div key={project.id} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                    {project.iconUrl ? <img src={project.iconUrl} alt="" className="h-full w-full object-cover" /> : <Puzzle className="h-5 w-5 text-muted-foreground" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{project.title}</p>
                    <p className="line-clamp-2 text-xs text-muted-foreground">{project.description}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {project.loaders.map((loader) => (
                    <Badge key={loader} variant="secondary" className="text-[11px]">
                      {LOADER_LABELS[loader] ?? loader}
                    </Badge>
                  ))}
                </div>
                <div className="mt-auto flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Download className="h-3 w-3" /> {formatCompactNumber(project.downloads)}
                  </span>
                  {install ? (
                    <Button
                      size="sm"
                      variant={installed ? "outline" : "default"}
                      disabled={!install.canInstall || install.installingProjectId !== null}
                      onClick={() => install.onInstall(project)}
                    >
                      {installed ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
                      {install.installingProjectId === project.id ? "Installing..." : installed ? "Reinstall" : "Install"}
                    </Button>
                  ) : (
                    <Button asChild size="sm" variant="outline">
                      <a href={`https://modrinth.com/project/${project.slug}`} target="_blank" rel="noreferrer">
                        View
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
