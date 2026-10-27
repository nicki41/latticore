import { useQueries } from "@tanstack/react-query";
import type { ServerDto, ServerStatsDto, PlayerDto } from "@latticore/shared";
import { api } from "./api";
import { computeLoadPercent } from "./load";

/**
 * Aggregates per-server stats/players across the whole fleet for the
 * dashboard's summary tiles and table/card views — reuses the exact same
 * query keys as useServerStats/usePlayers (see servers.ts/players.ts), so
 * react-query dedupes these against whatever a mounted ServerCard/table row
 * is already fetching instead of doubling the request count.
 */
export function useFleetOverview(servers: ServerDto[]) {
  const runningServers = servers.filter((s) => s.status === "RUNNING");

  const statsResults = useQueries({
    queries: runningServers.map((s) => ({
      queryKey: ["servers", s.id, "stats"] as const,
      queryFn: () => api.get<ServerStatsDto>(`/servers/${s.id}/stats`),
      refetchInterval: 5_000,
    })),
  });

  const playersResults = useQueries({
    queries: servers.map((s) => ({
      queryKey: ["servers", s.id, "players"] as const,
      queryFn: () => api.get<{ players: PlayerDto[] }>(`/servers/${s.id}/players`),
      refetchInterval: 5_000,
      refetchOnWindowFocus: true,
    })),
  });

  const statsByServerId = new Map<string, ServerStatsDto>();
  runningServers.forEach((s, i) => {
    const data = statsResults[i]?.data;
    if (data) statsByServerId.set(s.id, data);
  });

  const onlineCountByServerId = new Map<string, number>();
  servers.forEach((s, i) => {
    const data = playersResults[i]?.data;
    if (data) onlineCountByServerId.set(s.id, data.players.filter((p) => p.online).length);
  });

  const loads = runningServers
    .map((s) => {
      const stats = statsByServerId.get(s.id);
      return stats ? computeLoadPercent(stats.cpuPercent, stats.memoryUsageBytes, stats.memoryLimitBytes, s.cpuCores) : null;
    })
    .filter((v): v is number => v !== null);
  const avgLoad = loads.length > 0 ? loads.reduce((a, b) => a + b, 0) / loads.length : null;

  const totalOnlinePlayers = [...onlineCountByServerId.values()].reduce((a, b) => a + b, 0);

  return { statsByServerId, onlineCountByServerId, avgLoad, totalOnlinePlayers };
}
