import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Server as ServerIcon, PlusCircle, Activity, Users, Gauge, LayoutGrid, Table2 } from "lucide-react";
import { useServers } from "@/lib/servers";
import { useFleetOverview } from "@/lib/fleetStats";
import { ServerCard } from "@/components/servers/ServerCard";
import { ServerTable } from "@/components/servers/ServerTable";
import { EmptyState } from "@/components/layout/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";

type ViewMode = "cards" | "table";
type StatusFilter = "all" | "online" | "offline";

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function SummaryCard({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-semibold leading-none">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "online", label: "Online" },
  { value: "offline", label: "Offline" },
];

export default function DashboardPage() {
  const { data, isLoading } = useServers();
  const { user, hasPermission } = useAuth();
  const servers = useMemo(() => data?.servers ?? [], [data]);
  const online = servers.filter((s) => s.status === "RUNNING").length;

  const { avgLoad, totalOnlinePlayers } = useFleetOverview(servers);

  const [view, setView] = useState<ViewMode>("cards");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [versionFilter, setVersionFilter] = useState<string>("all");

  const versions = useMemo(() => [...new Set(servers.map((s) => s.mcVersion))].sort(), [servers]);

  const filteredServers = useMemo(
    () =>
      servers.filter((s) => {
        if (statusFilter === "online" && s.status !== "RUNNING") return false;
        if (statusFilter === "offline" && s.status === "RUNNING") return false;
        if (versionFilter !== "all" && s.mcVersion !== versionFilter) return false;
        return true;
      }),
    [servers, statusFilter, versionFilter],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {greeting()}
          {user ? `, ${user.username}` : ""}
        </h1>
        <p className="text-sm text-muted-foreground">Here&apos;s what&apos;s happening across your servers.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard icon={ServerIcon} label="Servers" value={servers.length} />
        <SummaryCard icon={Activity} label="Online" value={online} />
        <SummaryCard icon={Users} label="Players" value={totalOnlinePlayers} />
        <SummaryCard icon={Gauge} label="Avg Load" value={avgLoad !== null ? `${Math.round(avgLoad)}%` : "—"} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-md border border-border p-0.5">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setStatusFilter(f.value)}
                className={cn(
                  "rounded-[5px] px-2.5 py-1 text-xs font-medium transition-colors",
                  statusFilter === f.value ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          {versions.length > 1 && (
            <Select value={versionFilter} onValueChange={setVersionFilter}>
              <SelectTrigger className="h-8 w-40 text-xs">
                <SelectValue placeholder="All versions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All versions</SelectItem>
                {versions.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md border border-border p-0.5">
            <button
              type="button"
              aria-label="Card view"
              aria-pressed={view === "cards"}
              onClick={() => setView("cards")}
              className={cn("rounded-[5px] p-1.5", view === "cards" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground")}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label="Table view"
              aria-pressed={view === "table"}
              onClick={() => setView("table")}
              className={cn("rounded-[5px] p-1.5", view === "table" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground")}
            >
              <Table2 className="h-3.5 w-3.5" />
            </button>
          </div>

          {hasPermission("servers.create") && (
            <Button asChild size="sm" variant="outline">
              <Link to="/servers/new">
                <PlusCircle /> Create Server
              </Link>
            </Button>
          )}
        </div>
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      )}

      {!isLoading && servers.length === 0 && (
        <EmptyState
          icon={ServerIcon}
          title="No servers yet"
          description="Create your first Minecraft server to get started."
          action={
            hasPermission("servers.create") ? (
              <Button asChild size="sm">
                <Link to="/servers/new">
                  <PlusCircle /> Create Server
                </Link>
              </Button>
            ) : undefined
          }
        />
      )}

      {!isLoading && servers.length > 0 && filteredServers.length === 0 && (
        <EmptyState icon={ServerIcon} title="No servers match your filters" description="Try a different status or version." />
      )}

      {!isLoading &&
        filteredServers.length > 0 &&
        (view === "cards" ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredServers.map((server) => (
              <ServerCard key={server.id} server={server} />
            ))}
          </div>
        ) : (
          <ServerTable servers={filteredServers} />
        ))}
    </div>
  );
}
