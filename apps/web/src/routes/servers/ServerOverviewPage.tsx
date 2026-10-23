import { useMemo, useState } from "react";
import type { MetricsRange } from "@minecraftpanel/shared";
import { MetricChart, type MetricPoint } from "@/components/servers/MetricChart";
import { MetricsRangeSelector } from "@/components/servers/MetricsRangeSelector";
import { useMetricsHistory } from "@/lib/metricsHistory";
import { formatBytes } from "@/lib/format";
import { useServerOutletContext } from "./useServerOutletContext";

const CPU_COLOR = "hsl(var(--primary))";
const RAM_COLOR = "hsl(var(--status-starting))";
const DISK_COLOR = "hsl(217 91% 60%)";
const NET_RX_COLOR = "hsl(var(--status-online))";
const NET_TX_COLOR = "hsl(var(--status-error))";
const PLAYERS_COLOR = "hsl(280 65% 60%)";

export default function ServerOverviewPage() {
  const { server } = useServerOutletContext();
  const [range, setRange] = useState<MetricsRange>("1h");
  const history = useMetricsHistory(server.id, range);

  const samples = useMemo(() => history.data?.samples ?? [], [history.data]);
  const series = useMemo(() => {
    const map = <T,>(pick: (s: (typeof samples)[number]) => T | null): { timestamp: number; value: T | null }[] =>
      samples.map((s) => ({ timestamp: s.timestamp, value: pick(s) }));
    return {
      cpu: map((s) => s.cpuPercent) as MetricPoint[],
      ram: map((s) => s.memoryUsageBytes) as MetricPoint[],
      disk: map((s) => s.diskUsageBytes) as MetricPoint[],
      netRx: map((s) => s.networkRxBytes) as MetricPoint[],
      netTx: map((s) => s.networkTxBytes) as MetricPoint[],
      players: map((s) => s.playerCount) as MetricPoint[],
    };
  }, [samples]);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">Metrics over time</h2>
          <MetricsRangeSelector value={range} onChange={setRange} />
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <MetricChart title="CPU" data={series.cpu} color={CPU_COLOR} valueFormatter={(v) => `${v.toFixed(0)}%`} yDomain={[0, 100]} />
          <MetricChart title="RAM" data={series.ram} color={RAM_COLOR} valueFormatter={(v) => formatBytes(v)} />
          <MetricChart title="Disk" data={series.disk} color={DISK_COLOR} valueFormatter={(v) => formatBytes(v)} connectNulls />
          <MetricChart title="Players Online" data={series.players} color={PLAYERS_COLOR} valueFormatter={(v) => String(Math.round(v))} yDomain={[0, "auto"]} />
          <MetricChart title="Network In" data={series.netRx} color={NET_RX_COLOR} valueFormatter={(v) => formatBytes(v)} />
          <MetricChart title="Network Out" data={series.netTx} color={NET_TX_COLOR} valueFormatter={(v) => formatBytes(v)} />
        </div>
      </div>
    </div>
  );
}
