import { isProxySoftware, type ServerDto } from "@minecraftpanel/shared";
import { usePlayers } from "./players";
import { useServerConfigFile } from "./serverConfig";
import { useMetricsHistory } from "./metricsHistory";

/**
 * Online players and slots, however the server type reports them: game
 * servers from their player list and server.properties, proxies (which have
 * neither) from the `glist` count the metrics poller records.
 */
export function useServerPlayerSummary(server: ServerDto | undefined): { onlineCount: number; maxPlayers: number | null } {
  const isProxy = server ? isProxySoftware(server.software) : false;
  const id = server?.id ?? "";
  const players = usePlayers(id, Boolean(server) && !isProxy);
  const properties = useServerConfigFile(id, "server-properties", Boolean(server) && !isProxy);
  const history = useMetricsHistory(id, "15m", Boolean(server) && isProxy && server?.status === "RUNNING");

  if (isProxy) {
    const latest = [...(history.data?.samples ?? [])].reverse().find((s) => s.playerCount !== null);
    return { onlineCount: latest?.playerCount ?? 0, maxPlayers: null };
  }
  const maxPlayersRaw = properties.data?.values["max-players"];
  return {
    onlineCount: players.data?.players.filter((p) => p.online).length ?? 0,
    maxPlayers: typeof maxPlayersRaw === "number" ? maxPlayersRaw : null,
  };
}

/** What players type into Minecraft — or, for a server behind a proxy, that they can't reach it directly. */
export function serverAddressLabel(server: Pick<ServerDto, "port" | "exposePort">, publicIp: string | null | undefined): string {
  if (!server.exposePort) return "Only via proxy";
  return publicIp ? `${publicIp}:${server.port}` : `Port ${server.port}`;
}
