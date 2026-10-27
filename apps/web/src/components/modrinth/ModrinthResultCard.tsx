import { CheckCircle2, Download, ExternalLink, Puzzle, TriangleAlert } from "lucide-react";
import type { ComponentType } from "react";
import type { ModrinthSearchHit } from "@latticore/shared";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { modrinthTypeLabel } from "@/lib/modrinthDisplay";
import { formatCompactNumber } from "@/lib/format";

interface ModrinthResultCardAction {
  label: string;
  onClick: () => void;
  icon?: ComponentType<{ className?: string }>;
  loading?: boolean;
  disabled?: boolean;
  variant?: "outline" | "default";
}

interface ModrinthResultCardProps {
  hit: ModrinthSearchHit;
  action: ModrinthResultCardAction;
  /** Shown as a badge when this project is already installed on the current server. */
  installed?: boolean;
  /** When known (server-scoped context), a compact "compatible with X" / "not verified for X" note under the description. */
  compatibleWith?: string;
}

export function ModrinthResultCard({ hit, action, installed, compatibleWith }: ModrinthResultCardProps) {
  const ActionIcon = action.icon;
  const isCompatible = compatibleWith ? hit.versions.includes(compatibleWith) : undefined;

  return (
    <Card className={cn("flex flex-col", installed && "border-primary/40")}>
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
            {hit.icon_url ? (
              <img src={hit.icon_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <Puzzle className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1 truncate text-sm font-semibold">
              {hit.title}
              <a
                href={`https://modrinth.com/project/${hit.slug}`}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="shrink-0 text-muted-foreground hover:text-foreground"
                title="View on Modrinth"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            </p>
            <p className="text-xs text-muted-foreground">by {hit.author}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Badge variant="secondary">{modrinthTypeLabel(hit)}</Badge>
            {installed && (
              <Badge variant="outline" className="gap-1 border-primary/50 text-primary">
                <CheckCircle2 className="h-3 w-3" /> Installed
              </Badge>
            )}
          </div>
        </div>
        {/* min-h-8 reserves 2 lines (text-xs line-height 1rem) even for a short 1-line description, so a page's grid rows don't get a few px taller/shorter than the next depending on which descriptions happen to wrap — which was shifting the pagination bar below on every page change. */}
        <p className="line-clamp-2 min-h-8 flex-1 text-xs text-muted-foreground">{hit.description}</p>
        {compatibleWith && (
          <p className={cn("flex items-center gap-1 text-xs", isCompatible ? "text-status-online" : "text-status-starting")}>
            {isCompatible ? <CheckCircle2 className="h-3 w-3" /> : <TriangleAlert className="h-3 w-3" />}
            {isCompatible ? `Compatible with ${compatibleWith}` : `Not verified for ${compatibleWith}`}
          </p>
        )}
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Download className="h-3 w-3" /> {formatCompactNumber(hit.downloads)}
          </span>
          <Button size="sm" variant={action.variant ?? "outline"} onClick={action.onClick} disabled={action.disabled || action.loading}>
            {ActionIcon && <ActionIcon className="h-3.5 w-3.5" />}
            {action.loading ? "Installing..." : action.label}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
