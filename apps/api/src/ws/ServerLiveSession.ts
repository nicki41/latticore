import type { Readable } from "node:stream";
import type { WebSocket } from "ws";
import type { ConsoleLineDto, ServerStatus, ServerWsServerMessage } from "@latticore/shared";
import { logger } from "../lib/logger.js";
import type { MinecraftServerManager } from "../minecraft/MinecraftServerManager.js";

const MAX_BUFFERED_LINES = 1000;
const STATS_POLL_MS = 3000;
const STREAM_RETRY_MS = 5000;

/**
 * One per server that currently has at least one open /ws/servers/:id
 * connection. Owns the live log-follow stream, periodic stats polling, and
 * fan-out to every connected client; torn down when the last client
 * disconnects (a fresh session re-seeds its backlog from Docker's own
 * persisted container logs, so nothing is lost by not keeping this alive
 * indefinitely).
 */
export class ServerLiveSession {
  private clients = new Set<WebSocket>();
  private buffer: ConsoleLineDto[] = [];
  private nextLineId = 1;
  private logStream: Readable | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    private readonly serverId: string,
    private readonly manager: MinecraftServerManager,
    private readonly onEmpty: () => void,
  ) {
    this.manager.on("status", this.handleStatusChange);
  }

  addClient(ws: WebSocket): void {
    this.clients.add(ws);
    this.sendTo(ws, { type: "console:backlog", lines: this.buffer });
    void this.ensureLogStream();
    this.ensureStatsPoll();
  }

  removeClient(ws: WebSocket): void {
    this.clients.delete(ws);
    if (this.clients.size === 0) this.dispose();
  }

  injectSystemLine(text: string): void {
    this.pushLine(text);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.manager.off("status", this.handleStatusChange);
    if (this.statsTimer) clearInterval(this.statsTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.logStream?.destroy();
    this.logStream = null;
    this.onEmpty();
  }

  private handleStatusChange = (serverId: string, status: ServerStatus): void => {
    if (serverId !== this.serverId) return;
    this.broadcast({ type: "status", status, statusDetail: null });
    if (status === "RUNNING" || status === "INSTALLING") void this.ensureLogStream();
  };

  private async ensureLogStream(): Promise<void> {
    if (this.logStream || this.disposed) return;
    try {
      const stream = await this.manager.getLogStream(this.serverId, { tail: 200 });
      if (this.disposed) {
        stream.destroy();
        return;
      }
      this.logStream = stream;
      stream.on("data", (chunk: Buffer) => this.handleLogChunk(chunk));
      stream.on("error", (err) => {
        logger.debug({ err, serverId: this.serverId }, "Console log stream error");
        this.handleStreamEnded();
      });
      stream.on("close", () => this.handleStreamEnded());
    } catch {
      // No container yet (still CREATING) or it just disappeared. A status
      // change will trigger a retry immediately; this is just a backstop.
      this.scheduleRetry();
    }
  }

  private handleStreamEnded(): void {
    this.logStream = null;
    if (!this.disposed && this.clients.size > 0) this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.retryTimer || this.disposed) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.ensureLogStream();
    }, STREAM_RETRY_MS);
  }

  private handleLogChunk(chunk: Buffer): void {
    // ANSI intact — the browser renders colors itself now (ansiToSpans.ts).
    // Only PlayerActivityTracker still strips ANSI, since its join/leave/
    // UUID regexes need plain text to match against.
    const text = chunk.toString("utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      if (rawLine.length === 0) continue;
      this.pushLine(rawLine);
    }
  }

  private pushLine(text: string): void {
    const line: ConsoleLineDto = { id: this.nextLineId++, timestamp: Date.now(), text };
    this.buffer.push(line);
    if (this.buffer.length > MAX_BUFFERED_LINES) this.buffer.shift();
    this.broadcast({ type: "console:line", line });
  }

  private ensureStatsPoll(): void {
    if (this.statsTimer || this.disposed) return;
    this.statsTimer = setInterval(() => void this.pollStats(), STATS_POLL_MS);
    void this.pollStats();
  }

  private async pollStats(): Promise<void> {
    if (this.disposed || this.clients.size === 0) return;
    try {
      const stats = await this.manager.getStats(this.serverId);
      if (stats) this.broadcast({ type: "stats", stats });
    } catch (err) {
      logger.warn({ err, serverId: this.serverId }, "Failed to poll live server stats");
    }
  }

  private broadcast(message: ServerWsServerMessage): void {
    const payload = JSON.stringify(message);
    for (const ws of this.clients) {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    }
  }

  private sendTo(ws: WebSocket, message: ServerWsServerMessage): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  }
}
