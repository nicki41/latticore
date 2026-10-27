import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ServerConfigFileValuesDto } from "@latticore/shared";
import { api } from "./api";

export function useServerConfigFile(serverId: string, fileId: string, enabled = true) {
  return useQuery({
    queryKey: ["servers", serverId, "config", fileId],
    queryFn: () => api.get<ServerConfigFileValuesDto>(`/servers/${serverId}/config/${fileId}`),
    enabled,
  });
}

export function useUpdateServerConfigFile(serverId: string, fileId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: Record<string, string | number | boolean>) =>
      api.patch<ServerConfigFileValuesDto>(`/servers/${serverId}/config/${fileId}`, { values }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["servers", serverId, "config", fileId] }),
  });
}
