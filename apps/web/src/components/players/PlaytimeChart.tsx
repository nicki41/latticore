import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState } from "@/components/layout/EmptyState";
import { Activity } from "lucide-react";
import type { PlayerSessionBucketDto, PlayerSessionsRange } from "@latticore/shared";
import { formatPlaytime } from "@/lib/playerFormat";

interface PlaytimeChartProps {
  buckets: PlayerSessionBucketDto[];
  range: PlayerSessionsRange;
  height?: number;
}

function formatBucketLabel(bucket: string, range: PlayerSessionsRange): string {
  if (range === "today") {
    const hour = bucket.slice(11, 13);
    return `${hour}:00`;
  }
  const date = new Date(`${bucket}T00:00:00`);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function TooltipContent({ active, payload }: { active?: boolean; payload?: { payload: { bucket: string; seconds: number; label: string } }[] }) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md">
      <p className="text-muted-foreground">{point.label}</p>
      <p className="font-medium text-foreground">{formatPlaytime(point.seconds)}</p>
    </div>
  );
}

export function PlaytimeChart({ buckets, range, height = 180 }: PlaytimeChartProps) {
  if (buckets.length === 0) {
    return (
      <div className="flex items-center justify-center" style={{ height }}>
        <EmptyState icon={Activity} title="No playtime yet" description="Sessions will appear here once tracked." className="border-0 py-0" />
      </div>
    );
  }

  const data = buckets.map((b) => ({ ...b, label: formatBucketLabel(b.bucket, range) }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id="fill-playtime" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
            <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis
          tickFormatter={(v: number) => formatPlaytime(v)}
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={56}
        />
        <Tooltip content={<TooltipContent />} />
        <Area type="monotone" dataKey="seconds" stroke="hsl(var(--primary))" strokeWidth={1.75} fill="url(#fill-playtime)" isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
