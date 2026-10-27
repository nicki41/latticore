import { useMemo } from "react";
import { toast } from "sonner";
import type { ServerDto } from "@latticore/shared";
import { useServerAction, useServerStats } from "@/lib/servers";
import { useMetricsHistory } from "@/lib/metricsHistory";
import { usePublicIp } from "@/lib/system";
import { serverAddressLabel, useServerPlayerSummary } from "@/lib/serverSummary";
import { serverIconUrl, useServerIconVersion } from "@/lib/serverIcon";
import { useAuth } from "@/lib/auth";
import { formatUptime } from "@/lib/uptime";
import { computeLoadPercent } from "@/lib/load";
import { ApiError } from "@/lib/api";
import type { SparklinePoint } from "./Sparkline";

/**
 * Everything a server card/table row needs: live stats, players/slots,
 * address, a load-over-time series, and gated quick actions — shared so
 * the card and table views (Dashboard) stay in sync instead of duplicating
 * this per-view.
 */
export function useServerRowData(server: ServerDto) {
  const { hasPermission } = useAuth();
  const isRunning = server.status === "RUNNING";
  const canFull = server.myAccessLevel === "FULL";

  const start = useServerAction(server.id, "start");
  const stop = useServerAction(server.id, "stop");
  const restart = useServerAction(server.id, "restart");

  const stats = useServerStats(server.id, isRunning);
  const { onlineCount, maxPlayers } = useServerPlayerSummary(server);
  const publicIp = usePublicIp();
  const history = useMetricsHistory(server.id, "15m", isRunning);
  const { version: iconVersion } = useServerIconVersion(server.id);


  const loadSeries: SparklinePoint[] = useMemo(
    () =>
      (history.data?.samples ?? []).map((s) => ({
        timestamp: s.timestamp,
        value: computeLoadPercent(s.cpuPercent, s.memoryUsageBytes, s.memoryLimitBytes, server.cpuCores),
      })),
    [history.data, server.cpuCores],
  );

  const currentLoad = stats.data
    ? computeLoadPercent(stats.data.cpuPercent, stats.data.memoryUsageBytes, stats.data.memoryLimitBytes, server.cpuCores)
    : null;

  const address = serverAddressLabel(server, publicIp.data?.publicIp);
  const uptime = isRunning ? formatUptime(stats.data?.startedAt ?? null) : "Offline";

  const busy = start.isPending || stop.isPending || restart.isPending;
  const canStart = (server.status === "STOPPED" || server.status === "ERROR") && hasPermission("servers.start");
  const canStop = server.status === "RUNNING" && hasPermission("servers.stop");
  const canRestart = server.status === "RUNNING" && hasPermission("servers.restart");
  // Once Start has been pressed, the toggle flips to Stop immediately (disabled
  // until the server actually reaches RUNNING) rather than snapping back to Start.
  const showStop = server.status === "STARTING" || server.status === "RUNNING" || server.status === "STOPPING";

  async function run(action: "start" | "stop" | "restart") {
    const mutation = action === "start" ? start : action === "stop" ? stop : restart;
    try {
      await mutation.mutateAsync();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : `Failed to ${action} server.`);
    }
  }

  return {
    isRunning,
    canFull,
    iconUrl: serverIconUrl(server.id, iconVersion),
    uptime,
    onlineCount,
    maxPlayers,
    address,
    loadSeries,
    currentLoad,
    actions: { run, busy, canStart, canStop, canRestart, showStop },
  };
}
