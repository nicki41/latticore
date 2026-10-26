import { Link } from "react-router-dom";
import { ChevronRight, PlusCircle, Radio, Waypoints } from "lucide-react";
import { isProxySoftware, type ServerDto } from "@minecraftpanel/shared";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/layout/EmptyState";
import { StatusDot, StatusLabel } from "@/components/servers/StatusBadge";
import { useServers } from "@/lib/servers";
import { useNetwork } from "@/lib/network";
import { usePublicIp } from "@/lib/system";
import { serverAddressLabel } from "@/lib/serverSummary";
import { softwareVersionLabel } from "@/lib/softwareMeta";
import { useAuth } from "@/lib/auth";

/** One proxy with everything behind it, in join order. */
function NetworkCard({ proxy, publicIp }: { proxy: ServerDto; publicIp: string | null | undefined }) {
  const network = useNetwork(proxy.id);
  const backends = network.data?.network.backends ?? [];

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="min-w-0 space-y-1">
          <Link to={`/servers/${proxy.id}/network`} className="flex items-center gap-2 text-base font-semibold hover:underline">
            <Waypoints className="h-4 w-4 text-primary" /> {proxy.name}
          </Link>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusLabel status={proxy.status} />
            <Badge variant="secondary">{softwareVersionLabel(proxy.software, proxy.mcVersion)}</Badge>
            <Badge variant="secondary" className="gap-1">
              <Radio className="h-3 w-3" /> {serverAddressLabel(proxy, publicIp)}
            </Badge>
          </div>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link to={`/servers/${proxy.id}/network`}>
            Manage <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {network.isLoading && <Skeleton className="h-10 w-full" />}
        {!network.isLoading && backends.length === 0 && (
          <p className="text-sm text-muted-foreground">No servers behind this proxy yet.</p>
        )}
        {backends.length > 0 && (
          <ol className="relative space-y-1 border-l border-border pl-4">
            {backends.map((backend, index) => (
              <li key={backend.memberId} className="flex items-center gap-2 text-sm">
                {backend.server && <StatusDot status={backend.server.status} />}
                {backend.server ? (
                  <Link to={`/servers/${backend.server.id}`} className="truncate font-medium hover:underline">
                    {backend.server.name}
                  </Link>
                ) : (
                  <span className="truncate text-muted-foreground">Server you can&apos;t see</span>
                )}
                <code className="truncate font-mono text-xs text-muted-foreground">/server {backend.name}</code>
                {index === 0 && <Badge variant="secondary" className="text-[11px]">Default</Badge>}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

export default function NetworksPage() {
  const { hasPermission } = useAuth();
  const { data, isLoading } = useServers();
  const publicIp = usePublicIp().data?.publicIp;
  const servers = data?.servers ?? [];
  const proxies = servers.filter((s) => isProxySoftware(s.software));
  const standalone = servers.filter((s) => !isProxySoftware(s.software) && !s.network);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Networks</h1>
          <p className="text-sm text-muted-foreground">Proxies and the servers behind them. Players join the proxy and move between servers with /server.</p>
        </div>
        {hasPermission("servers.create") && (
          <Button asChild size="sm">
            <Link to="/servers/new">
              <PlusCircle /> New proxy
            </Link>
          </Button>
        )}
      </div>

      {isLoading && <Skeleton className="h-40 w-full" />}

      {!isLoading && proxies.length === 0 && (
        <EmptyState
          icon={Waypoints}
          title="No networks yet"
          description="Create a Velocity (or BungeeCord) server, then add your other servers to it from its Network tab — the panel configures forwarding, login checks and ports automatically."
          action={
            hasPermission("servers.create") ? (
              <Button asChild size="sm">
                <Link to="/servers/new">
                  <PlusCircle /> Create a proxy
                </Link>
              </Button>
            ) : undefined
          }
        />
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {proxies.map((proxy) => (
          <NetworkCard key={proxy.id} proxy={proxy} publicIp={publicIp} />
        ))}
      </div>

      {proxies.length > 0 && standalone.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {standalone.length} server{standalone.length === 1 ? " isn't" : "s aren't"} in a network yet:{" "}
          {standalone.map((s, i) => (
            <span key={s.id}>
              {i > 0 && ", "}
              <Link to={`/servers/${s.id}`} className="font-medium text-foreground hover:underline">
                {s.name}
              </Link>
            </span>
          ))}
          .
        </p>
      )}
    </div>
  );
}
