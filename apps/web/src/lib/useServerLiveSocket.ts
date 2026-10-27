import { useCallback, useEffect, useRef, useState } from "react";
import type { ConsoleLineDto, LiveStatsDto, ServerStatus, ServerWsServerMessage } from "@latticore/shared";

const MAX_LINES = 2000;
const RECONNECT_DELAY_MS = 3000;

export type SocketState = "connecting" | "open" | "closed";

export interface ServerLiveState {
  socketState: SocketState;
  status: ServerStatus | null;
  statusDetail: string | null;
  stats: LiveStatsDto | null;
  lines: ConsoleLineDto[];
  sendCommand: (command: string) => void;
  clearLines: () => void;
}

function wsUrl(serverId: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/servers/${serverId}`;
}

export function useServerLiveSocket(serverId: string | undefined): ServerLiveState {
  const [socketState, setSocketState] = useState<SocketState>("connecting");
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [statusDetail, setStatusDetail] = useState<string | null>(null);
  const [stats, setStats] = useState<LiveStatsDto | null>(null);
  const [lines, setLines] = useState<ConsoleLineDto[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!serverId) return;
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (cancelled || !serverId) return;
      setSocketState("connecting");
      const ws = new WebSocket(wsUrl(serverId));
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) return;
        setSocketState("open");
      };

      ws.onmessage = (event) => {
        if (cancelled) return;
        let message: ServerWsServerMessage;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        switch (message.type) {
          case "status":
            setStatus(message.status);
            setStatusDetail(message.statusDetail);
            break;
          case "stats":
            setStats(message.stats);
            break;
          case "console:backlog":
            setLines(message.lines.slice(-MAX_LINES));
            break;
          case "console:line":
            setLines((prev) => {
              const next = [...prev, message.line];
              return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
            });
            break;
          case "info":
          case "error":
            setLines((prev) => {
              const line: ConsoleLineDto = { id: -Date.now(), timestamp: Date.now(), text: `[panel] ${message.message}` };
              const next = [...prev, line];
              return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
            });
            break;
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        setSocketState("closed");
        wsRef.current = null;
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [serverId]);

  const sendCommand = useCallback((command: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "command", command }));
    }
  }, []);

  const clearLines = useCallback(() => setLines([]), []);

  return { socketState, status, statusDetail, stats, lines, sendCommand, clearLines };
}
