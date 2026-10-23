import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { RefreshCw, Trash2 } from "lucide-react";
import { compareMcVersions, type ServerDto } from "@minecraftpanel/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { useDeleteServer, useReinstallServer, useServerVersions } from "@/lib/servers";
import { SOFTWARE_META } from "@/lib/softwareMeta";
import { ApiError } from "@/lib/api";

/**
 * Re-runs the install for the same software — same Minecraft version (picks
 * up the newest build/loader) or a different one. World, configs and
 * plugins/mods stay; only the server jar/libraries are replaced.
 */
function ReinstallSection({ server }: { server: ServerDto }) {
  const reinstall = useReinstallServer(server.id);
  const versions = useServerVersions(server.software);
  const [targetVersion, setTargetVersion] = useState(server.mcVersion);
  const stopped = server.status === "STOPPED" || server.status === "ERROR";
  const isDowngrade = compareMcVersions(targetVersion, server.mcVersion) < 0;
  const isChange = targetVersion !== server.mcVersion;

  async function handleReinstall() {
    try {
      await reinstall.mutateAsync(isChange ? { mcVersion: targetVersion } : {});
      toast.success(isChange ? `Installing ${SOFTWARE_META[server.software].label} ${targetVersion}...` : "Reinstalling...");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to start the reinstall.");
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">Reinstall or change version</p>
        <p className="text-xs text-muted-foreground">
          Replaces the server software ({SOFTWARE_META[server.software].label} {server.mcVersion}
          {server.buildVersion ? `, build ${server.buildVersion}` : ""}) with the newest build for the chosen version. Worlds, configs and
          plugins/mods are kept.{!stopped && " Stop the server first."}
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="reinstall-version" className="text-xs">
            Minecraft version
          </Label>
          <Select value={targetVersion} onValueChange={setTargetVersion} disabled={versions.isLoading}>
            <SelectTrigger id="reinstall-version" className="h-9 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(versions.data?.versions ?? [{ id: server.mcVersion, stable: true }]).map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.id}
                  {v.id === server.mcVersion ? " (current)" : ""}
                  {!v.stable ? " · pre-release" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" disabled={!stopped || reinstall.isPending}>
              <RefreshCw /> {isChange ? "Change version" : "Reinstall"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{isChange ? `Switch to ${targetVersion}?` : "Reinstall server software?"}</AlertDialogTitle>
              <AlertDialogDescription>
                {isDowngrade
                  ? "Downgrading can corrupt worlds that were already opened in a newer version — take a backup first. "
                  : isChange
                    ? "Plugins and mods built for the current version may not load on the new one. Taking a backup first is a good idea. "
                    : ""}
                The server jar and libraries are replaced; worlds, configs and plugins/mods stay.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant={isDowngrade ? "destructive" : "default"} onClick={handleReinstall}>
                {isChange ? "Switch version" : "Reinstall"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

export function DangerZoneCard({ server }: { server: ServerDto }) {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const del = useDeleteServer();
  const canDelete = server.myAccessLevel === "FULL" && hasPermission("servers.delete");
  // Legacy (itzg-image) servers install themselves at container boot; the panel can't reinstall them.
  const canReinstall = server.myAccessLevel === "FULL" && hasPermission("servers.reinstall") && server.runtime === "PANEL_MANAGED";

  if (!canDelete && !canReinstall) return null;

  async function handleDelete(keepFiles: boolean) {
    try {
      await del.mutateAsync({ id: server.id, keepFiles });
      toast.success("Server deleted.");
      navigate("/");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete server.");
    }
  }

  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <CardTitle className="text-destructive">Danger zone</CardTitle>
        <CardDescription>Actions that replace or remove this server&apos;s software or data.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {canReinstall && <ReinstallSection server={server} />}
        {canReinstall && canDelete && <Separator />}
        {canDelete && (
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">Delete server</p>
              <p className="text-xs text-muted-foreground">Permanently delete this server and its Docker container.</p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={del.isPending}>
                  <Trash2 /> Delete server
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete server?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete the Docker container, server files, configuration and installed
                    plugins/mods for <strong>{server.name}</strong>. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <Button variant="outline" onClick={() => handleDelete(true)}>
                    Delete, keep files
                  </Button>
                  <AlertDialogAction variant="destructive" onClick={() => handleDelete(false)}>
                    Delete permanently
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
