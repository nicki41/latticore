import { useState } from "react";
import type { PlayerDto, PlayerSessionsRange } from "@latticore/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePlayerSessions, usePlayerStats } from "@/lib/playerDetails";
import { formatJoinDate, formatLastSeen, formatPlaytime } from "@/lib/playerFormat";
import { PlaytimeChart } from "../PlaytimeChart";

const RANGES: { key: PlayerSessionsRange; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "all", label: "Total" },
];

interface PlayerActivityTabProps {
  player: PlayerDto;
  serverId: string;
}

export function PlayerActivityTab({ player: p, serverId }: PlayerActivityTabProps) {
  const [range, setRange] = useState<PlayerSessionsRange>("all");
  const { data: stats } = usePlayerStats(serverId, p.username);
  const { data: sessions, isLoading } = usePlayerSessions(serverId, p.username, range);

  const playtimeSeconds = stats?.stats?.playtimeSeconds ?? p.playtimeSeconds;
  const playtimeSource = stats?.stats?.playtimeSeconds != null ? "from the server's own stats" : "tracked by the panel";

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <Stat label="First seen" value={formatJoinDate(p.firstSeenAt)} />
        <Stat label="Last seen" value={formatLastSeen(p)} />
        <Stat label="Playtime" value={formatPlaytime(playtimeSeconds)} hint={playtimeSource} />
        <Stat label="Sessions" value={sessions ? String(sessions.sessionCount) : "—"} />
        <Stat label="Avg. session" value={sessions ? formatPlaytime(sessions.averageSessionSeconds) : "—"} />
        <Stat label="Longest session" value={sessions ? formatPlaytime(sessions.longestSessionSeconds) : "—"} />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-medium">Playtime</div>
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <Button key={r.key} size="sm" variant={range === r.key ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => setRange(r.key)}>
                {r.label}
              </Button>
            ))}
          </div>
        </div>
        {isLoading ? <Skeleton className="h-[180px] w-full" /> : <PlaytimeChart buckets={sessions?.buckets ?? []} range={range} />}
      </div>
    </div>
  );
}

function Stat({ label, value, hint, className }: { label: string; value: string; hint?: string; className?: string }) {
  return (
    <div className={`rounded-lg bg-muted/40 px-3 py-2.5 ${className ?? ""}`} title={hint}>
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-medium">{value}</div>
    </div>
  );
}
