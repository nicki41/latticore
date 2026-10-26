import { useState } from "react";
import { Link, Outlet, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Play, Square, RotateCw, Box, Radio, Clock, Users, Waypoints } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusLabel } from "@/components/servers/StatusBadge";
import { softwareVersionLabel } from "@/lib/softwareMeta";
import { useServer, useServerAction, useServerStats } from "@/lib/servers";
import { usePublicIp } from "@/lib/system";
import { serverAddressLabel, useServerPlayerSummary } from "@/lib/serverSummary";
import { serverIconUrl, useServerIconVersion } from "@/lib/serverIcon";
import { formatUptime } from "@/lib/uptime";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ServerLiveProvider } from "./ServerLiveContext";

export default function ServerDetailLayout() {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useAuth();
  const { data, isLoading } = useServer(id);
  const server = data?.server;
  const [hasIcon, setHasIcon] = useState<boolean | null>(null);
  const { version: iconVersion } = useServerIconVersion(id!);

  const start = useServerAction(id!, "start");
  const stop = useServerAction(id!, "stop");
  const restart = useServerAction(id!, "restart");

  const isRunning = server?.status === "RUNNING";
  const stats = useServerStats(id, isRunning);
  const { onlineCount, maxPlayers } = useServerPlayerSummary(server);
  const publicIp = usePublicIp();

  const busy = start.isPending || stop.isPending || restart.isPending;

  async function run(action: typeof start, label: string) {
    try {
      await action.mutateAsync();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : `Failed to ${label} server.`);
    }
  }

  if (isLoading || !server) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const canFull = server.myAccessLevel === "FULL";
  const canStart = (server.status === "STOPPED" || server.status === "ERROR") && hasPermission("servers.start");
  const canStop = server.status === "RUNNING" && hasPermission("servers.stop");
  const canRestart = server.status === "RUNNING" && hasPermission("servers.restart");
  // Once Start has been pressed, the toggle flips to Stop immediately (disabled
  // until the server actually reaches RUNNING) rather than snapping back to Start.
  const showStop = server.status === "STARTING" || server.status === "RUNNING" || server.status === "STOPPING";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-border bg-card p-4">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/40">
              {hasIcon !== false && (
                <img
                  key={iconVersion}
                  src={serverIconUrl(server.id, iconVersion)}
                  alt=""
                  className="h-full w-full [image-rendering:pixelated]"
                  onLoad={() => setHasIcon(true)}
                  onError={() => setHasIcon(false)}
                />
              )}
              {hasIcon === false && <Box className="h-5 w-5 text-muted-foreground" />}
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{server.name}</h1>
              <StatusLabel status={server.status} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="gap-1">
              <Box className="h-3 w-3" /> {softwareVersionLabel(server.software, server.mcVersion)}
            </Badge>
            <Badge variant="secondary" className="gap-1">
              <Radio className="h-3 w-3" /> {serverAddressLabel(server, publicIp.data?.publicIp)}
            </Badge>
            <Badge variant="secondary" className="gap-1">
              <Clock className="h-3 w-3" /> {isRunning ? formatUptime(stats.data?.startedAt ?? null) : "Offline"}
            </Badge>
            <Badge variant="secondary" className="gap-1">
              <Users className="h-3 w-3" /> {isRunning ? onlineCount : "—"} / {typeof maxPlayers === "number" ? maxPlayers : "—"}
            </Badge>
            {server.network && (
              <Badge variant="outline" className="gap-1 border-primary/40 text-primary">
                <Waypoints className="h-3 w-3" />
                {server.network.proxyName ? (
                  <Link to={`/servers/${server.network.proxyId}/network`} className="hover:underline">
                    Behind {server.network.proxyName} as &quot;{server.network.name}&quot;
                  </Link>
                ) : (
                  <>Behind a proxy as &quot;{server.network.name}&quot;</>
                )}
              </Badge>
            )}
          </div>
          {server.status === "ERROR" && server.statusDetail && (
            <p className="text-sm text-destructive">{server.statusDetail}</p>
          )}
        </div>

        {canFull && (
          <div className="flex items-center gap-2">
            {showStop ? (
              <Button size="sm" variant="outline" disabled={!canStop || busy} onClick={() => run(stop, "stop")}>
                <Square /> Stop
              </Button>
            ) : (
              <Button size="sm" variant="default" disabled={!canStart || busy} onClick={() => run(start, "start")}>
                <Play /> Start
              </Button>
            )}
            <Button
              size="sm"
              variant={showStop ? "default" : "outline"}
              disabled={!canRestart || busy}
              onClick={() => run(restart, "restart")}
            >
              <RotateCw /> Restart
            </Button>
          </div>
        )}
      </div>

      <ServerLiveProvider serverId={server.id}>
        <Outlet context={{ server }} />
      </ServerLiveProvider>
    </div>
  );
}
