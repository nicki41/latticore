import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { PlayerDto } from "@latticore/shared";
import { api } from "./api";

export function usePlayers(serverId: string, enabled = true) {
  return useQuery({
    queryKey: ["servers", serverId, "players"],
    queryFn: () => api.get<{ players: PlayerDto[] }>(`/servers/${serverId}/players`),
    enabled,
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
  });
}

function invalidate(qc: QueryClient, serverId: string) {
  qc.invalidateQueries({ queryKey: ["servers", serverId, "players"] });
}

function useAction(serverId: string, path: (username: string) => string, method: "post" | "delete" = "post") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ username, reason }: { username: string; reason?: string }) =>
      method === "post" ? api.post(path(username), reason !== undefined ? { reason } : undefined) : api.delete(path(username)),
    onSuccess: () => invalidate(qc, serverId),
  });
}

export function useOpPlayer(serverId: string) {
  return useAction(serverId, (u) => `/servers/${serverId}/players/${encodeURIComponent(u)}/op`);
}
export function useDeopPlayer(serverId: string) {
  return useAction(serverId, (u) => `/servers/${serverId}/players/${encodeURIComponent(u)}/deop`);
}
export function useWhitelistAddPlayer(serverId: string) {
  return useAction(serverId, (u) => `/servers/${serverId}/players/${encodeURIComponent(u)}/whitelist`);
}
export function useWhitelistRemovePlayer(serverId: string) {
  return useAction(serverId, (u) => `/servers/${serverId}/players/${encodeURIComponent(u)}/whitelist`, "delete");
}
export function useKickPlayer(serverId: string) {
  return useAction(serverId, (u) => `/servers/${serverId}/players/${encodeURIComponent(u)}/kick`);
}
export function useBanPlayer(serverId: string) {
  return useAction(serverId, (u) => `/servers/${serverId}/players/${encodeURIComponent(u)}/ban`);
}
export function useUnbanPlayer(serverId: string) {
  return useAction(serverId, (u) => `/servers/${serverId}/players/${encodeURIComponent(u)}/unban`);
}

export function useMessagePlayer(serverId: string) {
  return useMutation({
    mutationFn: ({ username, message }: { username: string; message: string }) =>
      api.post(`/servers/${serverId}/players/${encodeURIComponent(username)}/message`, { message }),
  });
}
