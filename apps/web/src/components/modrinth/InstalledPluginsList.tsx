import { useState } from "react";
import { toast } from "sonner";
import { Blocks, ExternalLink, MoreHorizontal, Pause, Play, Trash2 } from "lucide-react";
import type { InstalledPluginDto, ServerDto } from "@latticore/shared";
import { pluginTerminologyFor } from "@latticore/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/layout/EmptyState";
import { formatBytes } from "@/lib/format";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { usePausePlugin, useRemovePlugin, useResumePlugin } from "@/lib/modrinth";

function displayName(entry: InstalledPluginDto): string {
  if (entry.title) return entry.title;
  return entry.status === "PAUSED" ? entry.filename.replace(/\.disabled$/, "") : entry.filename;
}

export function InstalledPluginsList({ server, installed, isLoading }: { server: ServerDto; installed: InstalledPluginDto[]; isLoading: boolean }) {
  const { hasPermission } = useAuth();
  const kind = pluginTerminologyFor(server.software);
  const canManage = hasPermission("plugins.install");
  const canRemove = hasPermission("plugins.remove");

  const pause = usePausePlugin(server.id);
  const resume = useResumePlugin(server.id);
  const remove = useRemovePlugin(server.id);
  const [removeTarget, setRemoveTarget] = useState<InstalledPluginDto | null>(null);
  const [pendingFilename, setPendingFilename] = useState<string | null>(null);

  async function handleToggle(entry: InstalledPluginDto) {
    setPendingFilename(entry.filename);
    try {
      if (entry.status === "ACTIVE") {
        await pause.mutateAsync(entry.filename);
        toast.success(`${displayName(entry)} paused. It will no longer load on next start.`);
      } else {
        await resume.mutateAsync(entry.filename);
        toast.success(`${displayName(entry)} resumed. Restart the server to load it.`);
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update status.");
    } finally {
      setPendingFilename(null);
    }
  }

  async function handleRemove() {
    if (!removeTarget) return;
    try {
      await remove.mutateAsync(removeTarget.filename);
      toast.success(`Removed ${displayName(removeTarget)}.`);
      setRemoveTarget(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to remove.");
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (installed.length === 0) {
    return <EmptyState icon={Blocks} title={`No ${kind}s installed yet`} description="Install one from the browser below." className="border-0" />;
  }

  return (
    <div className="divide-y divide-border">
      {installed.map((entry) => {
        const busy = pendingFilename === entry.filename && (pause.isPending || resume.isPending);
        return (
          <div key={entry.filename} className="flex items-center gap-3 py-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
              {entry.iconUrl ? (
                <img src={entry.iconUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <Blocks className="h-4 w-4 text-muted-foreground" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="truncate text-sm font-medium">{displayName(entry)}</p>
                {entry.slug && (
                  <a
                    href={`https://modrinth.com/project/${entry.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    title="View on Modrinth"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                <Badge variant={entry.status === "ACTIVE" ? "outline" : "secondary"} className="shrink-0 gap-1">
                  <span className={entry.status === "ACTIVE" ? "h-1.5 w-1.5 rounded-full bg-status-online" : "h-1.5 w-1.5 rounded-full bg-status-offline"} />
                  {entry.status === "ACTIVE" ? "Active" : "Paused"}
                </Badge>
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {entry.author && <>by {entry.author} · </>}
                {entry.versionNumber && <>v{entry.versionNumber} · </>}
                <span className="font-mono">{entry.filename}</span> · {formatBytes(entry.size)}
              </p>
            </div>

            {canManage && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" disabled={busy}>
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => handleToggle(entry)}>
                    {entry.status === "ACTIVE" ? (
                      <>
                        <Pause /> Pause
                      </>
                    ) : (
                      <>
                        <Play /> Resume
                      </>
                    )}
                  </DropdownMenuItem>
                  {canRemove && (
                    <DropdownMenuItem destructive onClick={() => setRemoveTarget(entry)}>
                      <Trash2 /> Remove
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        );
      })}

      <AlertDialog open={Boolean(removeTarget)} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removeTarget ? displayName(removeTarget) : "this item"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the file from the server&apos;s {kind === "mod" ? "mods" : "plugins"} folder. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleRemove}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
