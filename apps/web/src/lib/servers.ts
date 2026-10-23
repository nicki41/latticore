import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateServerInput,
  ReinstallServerInput,
  ServerDto,
  ServerSoftware,
  ServerStatsDto,
  UpdateServerSettingsInput,
} from "@minecraftpanel/shared";
import { api } from "./api";

export function useServers() {
  return useQuery({
    queryKey: ["servers"],
    queryFn: () => api.get<{ servers: ServerDto[] }>("/servers"),
    refetchInterval: 10_000,
  });
}

export function useServer(id: string | undefined) {
  return useQuery({
    queryKey: ["servers", id],
    queryFn: () => api.get<{ server: ServerDto }>(`/servers/${id}`),
    enabled: Boolean(id),
    refetchInterval: 10_000,
  });
}

export function useServerStats(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["servers", id, "stats"],
    queryFn: () => api.get<ServerStatsDto>(`/servers/${id}/stats`),
    enabled: Boolean(id) && enabled,
    refetchInterval: 5_000,
  });
}

export function useServerVersions(software: ServerSoftware | undefined) {
  return useQuery({
    queryKey: ["servers", "versions", software],
    queryFn: () => api.get<{ versions: { id: string; stable: boolean }[] }>(`/servers/versions?software=${software}`),
    enabled: Boolean(software),
    staleTime: 5 * 60_000,
  });
}

export function useCreateServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateServerInput) => api.post<{ server: ServerDto }>("/servers", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["servers"] }),
  });
}

export function useServerAction(id: string, action: "start" | "stop" | "restart") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post(`/servers/${id}/${action}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["servers"] });
      qc.invalidateQueries({ queryKey: ["servers", id] });
    },
  });
}

export function useReinstallServer(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ReinstallServerInput) => api.post(`/servers/${id}/reinstall`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["servers"] });
      qc.invalidateQueries({ queryKey: ["servers", id] });
    },
  });
}

export function useDeleteServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, keepFiles }: { id: string; keepFiles?: boolean }) =>
      api.delete(`/servers/${id}${keepFiles ? "?keepFiles=true" : ""}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["servers"] }),
  });
}

export function useUpdateServerSettings(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateServerSettingsInput) => api.patch<{ server: ServerDto }>(`/servers/${id}/settings`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["servers"] });
      qc.invalidateQueries({ queryKey: ["servers", id] });
    },
  });
}
