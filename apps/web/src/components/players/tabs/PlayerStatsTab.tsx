import type { PlayerDto } from "@latticore/shared";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/layout/EmptyState";
import { Swords } from "lucide-react";
import { usePlayerStats } from "@/lib/playerDetails";
import { StatsBarChart } from "../StatsBarChart";

interface PlayerStatsTabProps {
  player: PlayerDto;
  serverId: string;
}

function formatCount(v: number) {
  return v.toLocaleString();
}

function formatKm(meters: number) {
  return `${(meters / 1000).toFixed(meters >= 1000 ? 1 : 2)} km`;
}

function formatRatio(v: number | null) {
  return v === null ? "—" : v.toFixed(2);
}

export function PlayerStatsTab({ player: p, serverId }: PlayerStatsTabProps) {
  const { data, isLoading } = usePlayerStats(serverId, p.username);
  const stats = data?.stats;

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  if (!stats) {
    return (
      <EmptyState
        icon={Swords}
        title="No stats yet"
        description="This player hasn't spawned into the world yet, or their stats file was wiped."
      />
    );
  }

  const combatData = [
    { label: "Player kills", value: stats.playerKills },
    { label: "Mob kills", value: stats.mobKills },
    { label: "Deaths to players", value: stats.deathsToPlayers ?? 0 },
    { label: "Deaths to mobs", value: stats.deathsToMobs },
  ];

  const distanceData = [
    { label: "Walking", value: stats.distance.walkingMeters },
    { label: "Sprinting", value: stats.distance.sprintingMeters },
    { label: "Swimming", value: stats.distance.swimmingMeters },
    { label: "Flying", value: stats.distance.flyingMeters },
    { label: "Boat", value: stats.distance.boatMeters },
    { label: "Minecart", value: stats.distance.minecartMeters },
    { label: "Mounted", value: stats.distance.mountedMeters },
    { label: "Climbing", value: stats.distance.climbingMeters },
  ];

  return (
    <Tabs defaultValue="combat">
      <TabsList>
        <TabsTrigger value="combat">Combat</TabsTrigger>
        <TabsTrigger value="movement">Movement</TabsTrigger>
      </TabsList>

      <TabsContent value="combat" className="space-y-4">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Stat label="Player K/D" value={formatRatio(stats.playerKdRatio)} />
          <Stat label="Mob K/D" value={formatRatio(stats.mobKdRatio)} />
          <Stat label="Deaths (total)" value={formatCount(stats.deaths)} />
          <Stat label="Player kills" value={formatCount(stats.playerKills)} />
        </div>
        <StatsBarChart data={combatData} color="hsl(var(--status-error))" valueFormatter={formatCount} />
      </TabsContent>

      <TabsContent value="movement" className="space-y-4">
        <Stat label="Total distance" value={formatKm(stats.distance.totalMeters)} className="max-w-[200px]" />
        <StatsBarChart data={distanceData} color="hsl(var(--primary))" valueFormatter={(v) => formatKm(v)} />
      </TabsContent>
    </Tabs>
  );
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={`rounded-lg bg-muted/40 px-3 py-2.5 ${className ?? ""}`}>
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-medium">{value}</div>
    </div>
  );
}
