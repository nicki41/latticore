import type { MetricsRange, MetricsSampleDto } from "@latticore/shared";

const RANGE_MS: Record<MetricsRange, number> = {
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "6h": 6 * 60 * 60_000,
  "24h": 24 * 60 * 60_000,
};

/** Keep the longest supported range plus a little slack, at the collector's ~30s sampling interval. */
const MAX_SAMPLES_PER_SERVER = Math.ceil(RANGE_MS["24h"] / 30_000) + 10;

/**
 * In-memory, per-process ring buffer of recent metrics samples per server —
 * intentionally not persisted (resets on API restart, same as the live
 * WebSocket stats never claimed to survive one). Good enough for "recent
 * trends" dashboards without a time-series DB; if longer retention is ever
 * needed, this is the one place that would grow a storage backend.
 */
export class MetricsHistoryStore {
  private readonly history = new Map<string, MetricsSampleDto[]>();

  record(serverId: string, sample: MetricsSampleDto): void {
    let samples = this.history.get(serverId);
    if (!samples) {
      samples = [];
      this.history.set(serverId, samples);
    }
    samples.push(sample);
    if (samples.length > MAX_SAMPLES_PER_SERVER) samples.splice(0, samples.length - MAX_SAMPLES_PER_SERVER);
  }

  getRange(serverId: string, range: MetricsRange): MetricsSampleDto[] {
    const since = Date.now() - RANGE_MS[range];
    return (this.history.get(serverId) ?? []).filter((s) => s.timestamp >= since);
  }

  /** Called when a server is deleted so its history doesn't linger forever in memory. */
  clear(serverId: string): void {
    this.history.delete(serverId);
  }
}
