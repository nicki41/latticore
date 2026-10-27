import { useQuery } from "@tanstack/react-query";
import type { MetricsHistoryDto, MetricsRange } from "@latticore/shared";
import { api } from "./api";

export function useMetricsHistory(serverId: string, range: MetricsRange, enabled = true) {
  return useQuery({
    queryKey: ["servers", serverId, "stats", "history", range],
    queryFn: () => api.get<MetricsHistoryDto>(`/servers/${serverId}/stats/history?range=${range}`),
    enabled,
    refetchInterval: 30_000,
  });
}
