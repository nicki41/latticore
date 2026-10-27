import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  PlayerBanDto,
  PlayerGamemode,
  PlayerGamemodeDto,
  PlayerIpHistoryEntryDto,
  PlayerNameHistoryEntryDto,
  PlayerSessionSummaryDto,
  PlayerSessionsRange,
  PlayerStatsDto,
} from "@latticore/shared";
import { api } from "./api";

function encoded(username: string) {
  return encodeURIComponent(username);
}

export function useGamemode(serverId: string, username: string) {
  return useQuery({
    queryKey: ["servers", serverId, "players", username, "gamemode"],
    queryFn: () => api.get<PlayerGamemodeDto>(`/servers/${serverId}/players/${encoded(username)}/gamemode`),
  });
}

export function usePlayerStats(serverId: string, username: string) {
  return useQuery({
    queryKey: ["servers", serverId, "players", username, "stats"],
    queryFn: () => api.get<{ stats: PlayerStatsDto | null }>(`/servers/${serverId}/players/${encoded(username)}/stats`),
  });
}

export function usePlayerSessions(serverId: string, username: string, range: PlayerSessionsRange) {
  return useQuery({
    queryKey: ["servers", serverId, "players", username, "sessions", range],
    queryFn: () => api.get<PlayerSessionSummaryDto>(`/servers/${serverId}/players/${encoded(username)}/sessions?range=${range}`),
  });
}

export function usePlayerBans(serverId: string, username: string) {
  return useQuery({
    queryKey: ["servers", serverId, "players", username, "bans"],
    queryFn: () => api.get<{ bans: PlayerBanDto[] }>(`/servers/${serverId}/players/${encoded(username)}/bans`),
  });
}

export function usePlayerNameHistory(serverId: string, username: string) {
  return useQuery({
    queryKey: ["servers", serverId, "players", username, "name-history"],
    queryFn: () => api.get<{ history: PlayerNameHistoryEntryDto[] }>(`/servers/${serverId}/players/${encoded(username)}/name-history`),
  });
}

export function usePlayerIpHistory(serverId: string, username: string) {
  return useQuery({
    queryKey: ["servers", serverId, "players", username, "ip-history"],
    queryFn: () => api.get<{ history: PlayerIpHistoryEntryDto[] }>(`/servers/${serverId}/players/${encoded(username)}/ip-history`),
  });
}

export function useTempBan(serverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ username, durationMinutes, reason }: { username: string; durationMinutes: number; reason?: string }) =>
      api.post(`/servers/${serverId}/players/${encoded(username)}/tempban`, { durationMinutes, reason }),
    onSuccess: (_data, { username }) => {
      qc.invalidateQueries({ queryKey: ["servers", serverId, "players"] });
      qc.invalidateQueries({ queryKey: ["servers", serverId, "players", username, "bans"] });
    },
  });
}

export function useIpBan(serverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ username, ip, reason }: { username: string; ip: string; reason?: string }) =>
      api.post(`/servers/${serverId}/players/${encoded(username)}/ip-ban`, { ip, reason }),
    onSuccess: (_data, { username }) => qc.invalidateQueries({ queryKey: ["servers", serverId, "players", username, "bans"] }),
  });
}

export function useIpUnban(serverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ username, ip }: { username: string; ip: string }) =>
      api.post(`/servers/${serverId}/players/${encoded(username)}/ip-unban`, { ip }),
    onSuccess: (_data, { username }) => qc.invalidateQueries({ queryKey: ["servers", serverId, "players", username, "bans"] }),
  });
}

export function useWipe(serverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ username }: { username: string }) => api.post(`/servers/${serverId}/players/${encoded(username)}/wipe`),
    onSuccess: (_data, { username }) => {
      qc.invalidateQueries({ queryKey: ["servers", serverId, "players", username, "stats"] });
      qc.invalidateQueries({ queryKey: ["servers", serverId, "players", username, "gamemode"] });
    },
  });
}

export function useSetGamemode(serverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ username, mode }: { username: string; mode: PlayerGamemode }) =>
      api.post(`/servers/${serverId}/players/${encoded(username)}/gamemode`, { mode }),
    // Optimistic, and deliberately never invalidated on success: gamemode is
    // read back from the player's on-disk NBT file, which the Minecraft
    // server only flushes periodically/on disconnect — refetching right
    // after the RCON command returns would just read the still-stale value
    // and make the UI appear to "snap back" to the old gamemode.
    onMutate: async ({ username, mode }) => {
      const key = ["servers", serverId, "players", username, "gamemode"];
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<PlayerGamemodeDto>(key);
      qc.setQueryData<PlayerGamemodeDto>(key, { gamemode: mode });
      return { previous, key };
    },
    onError: (_err, _vars, context) => {
      if (context) qc.setQueryData(context.key, context.previous);
    },
  });
}
