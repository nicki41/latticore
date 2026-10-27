import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Archive, Download, Lock, LockOpen, RotateCcw, Trash2 } from "lucide-react";
import type { ServerDto } from "@latticore/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import {
  useBackups,
  useCreateBackup,
  useDeleteBackup,
  useRestoreBackup,
  useSetBackupLocked,
  useUpdateBackupSettings,
  backupDownloadUrl,
} from "@/lib/backups";

const DEFAULT_RETENTION = 10;

/** "Keep the newest N" — applies to manual and scheduled backups alike; locked backups are exempt. */
function RetentionSetting({ serverId, retentionCount, canEdit }: { serverId: string; retentionCount: number | null; canEdit: boolean }) {
  const update = useUpdateBackupSettings(serverId);
  const [draft, setDraft] = useState(String(retentionCount ?? DEFAULT_RETENTION));
  useEffect(() => setDraft(String(retentionCount ?? DEFAULT_RETENTION)), [retentionCount]);

  async function save(next: number | null) {
    try {
      await update.mutateAsync({ retentionCount: next });
      toast.success(next === null ? "All backups will be kept." : `Keeping the newest ${next} unlocked backup${next === 1 ? "" : "s"}.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save retention setting.");
    }
  }

  const parsed = Number.parseInt(draft, 10);
  const draftValid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 1000;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <Switch
          id={`retention-${serverId}`}
          checked={retentionCount !== null}
          disabled={!canEdit || update.isPending}
          onCheckedChange={(on) => save(on ? (draftValid ? parsed : DEFAULT_RETENTION) : null)}
        />
        <Label htmlFor={`retention-${serverId}`} className="font-normal">
          Delete old backups automatically
        </Label>
      </div>
      {retentionCount !== null && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <span>keep the newest</span>
          <Input
            type="number"
            min={1}
            max={1000}
            className="h-7 w-20"
            value={draft}
            disabled={!canEdit}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => draftValid && parsed !== retentionCount && save(parsed)}
            onKeyDown={(e) => e.key === "Enter" && draftValid && parsed !== retentionCount && save(parsed)}
            aria-label="Number of backups to keep"
          />
          <span>· locked backups never count</span>
        </div>
      )}
    </div>
  );
}

export function BackupsCard({ server }: { server: ServerDto }) {
  const { hasPermission } = useAuth();
  const { data, isLoading } = useBackups(server.id);
  const createBackup = useCreateBackup(server.id);
  const deleteBackup = useDeleteBackup(server.id);
  const restoreBackup = useRestoreBackup(server.id);
  const setLocked = useSetBackupLocked(server.id);
  const [restoring, setRestoring] = useState<string | null>(null);

  const canCreate = hasPermission("backups.create") && server.myAccessLevel === "FULL";
  const canDelete = hasPermission("backups.delete") && server.myAccessLevel === "FULL";
  const canRestore = hasPermission("backups.restore") && server.myAccessLevel === "FULL";
  const canStop = server.status === "STOPPED" || server.status === "ERROR";

  async function handleCreate() {
    try {
      await createBackup.mutateAsync({});
      toast.success("Backup created.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to create backup.");
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteBackup.mutateAsync(id);
      toast.success("Backup deleted.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete backup.");
    }
  }

  async function handleToggleLock(id: string, locked: boolean) {
    try {
      await setLocked.mutateAsync({ backupId: id, locked });
      toast.success(locked ? "Backup locked — it won't be deleted automatically." : "Backup unlocked.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update backup.");
    }
  }

  async function handleRestore(id: string) {
    setRestoring(id);
    try {
      await restoreBackup.mutateAsync(id);
      toast.success("Backup restored.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to restore backup.");
    } finally {
      setRestoring(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Backups</CardTitle>
          <CardDescription>
            Snapshots of this server&apos;s files. Taken safely while running — autosave pauses until the world is flushed to disk.
          </CardDescription>
        </div>
        {canCreate && (
          <Button size="sm" onClick={handleCreate} disabled={createBackup.isPending}>
            <Archive className="h-3.5 w-3.5" /> {createBackup.isPending ? "Creating..." : "Create Backup"}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {data && <RetentionSetting serverId={server.id} retentionCount={data.settings.retentionCount} canEdit={canDelete} />}
        {isLoading && <Skeleton className="h-16 w-full" />}
        {!isLoading && (data?.backups.length ?? 0) === 0 && <p className="text-sm text-muted-foreground">No backups yet.</p>}
        {!isLoading && (data?.backups.length ?? 0) > 0 && (
          <div className="divide-y divide-border">
            {data!.backups.map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 truncate font-mono text-xs">
                    {b.locked && <Lock className="h-3 w-3 shrink-0 text-primary" aria-label="Locked" />}
                    {b.fileName}
                  </p>
                  {b.note && <p className="truncate text-xs">{b.note}</p>}
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(Number(b.sizeBytes))} · {b.createdByUsername ?? "unknown"} · {new Date(b.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button asChild variant="ghost" size="icon" className="h-7 w-7" title="Download">
                    <a href={backupDownloadUrl(server.id, b.id)} download aria-label="Download backup">
                      <Download className="h-3.5 w-3.5" />
                    </a>
                  </Button>
                  {canRestore && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7" disabled={!canStop || restoring === b.id} title="Restore" aria-label="Restore backup">
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Restore this backup?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This replaces all current files for <strong>{server.name}</strong> with the contents of this backup. Files
                            changed since then are lost — take a fresh backup first if you might need them.
                            {!canStop && " The server must be stopped first."}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction variant="destructive" disabled={!canStop} onClick={() => handleRestore(b.id)}>
                            Restore
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                  {canDelete && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title={b.locked ? "Unlock" : "Lock (exempt from automatic deletion)"}
                      aria-label={b.locked ? "Unlock backup" : "Lock backup"}
                      onClick={() => handleToggleLock(b.id, !b.locked)}
                    >
                      {b.locked ? <LockOpen className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                    </Button>
                  )}
                  {canDelete && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      disabled={b.locked}
                      title={b.locked ? "Unlock to delete" : "Delete"}
                      aria-label="Delete backup"
                      onClick={() => handleDelete(b.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
