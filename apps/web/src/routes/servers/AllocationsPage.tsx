import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Network, Plus, X } from "lucide-react";
import type { ServerDto } from "@minecraftpanel/shared";
import { useServers } from "@/lib/servers";
import { useCreateAllocation, useDeleteAllocation } from "@/lib/allocations";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/layout/EmptyState";
import { StatusLabel } from "@/components/servers/StatusBadge";

function usedPortsExcluding(servers: ServerDto[], serverId: string): Set<number> {
  const used = new Set<number>();
  for (const server of servers) {
    if (server.id === serverId) continue;
    used.add(server.port);
    for (const allocation of server.allocations) used.add(allocation.port);
  }
  return used;
}

function ServerAllocationsCard({ server, allServers, canEdit }: { server: ServerDto; allServers: ServerDto[]; canEdit: boolean }) {
  const [portInput, setPortInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const create = useCreateAllocation(server.id);
  const remove = useDeleteAllocation(server.id);

  const usedElsewhere = useMemo(() => usedPortsExcluding(allServers, server.id), [allServers, server.id]);
  const ownPorts = useMemo(() => new Set([server.port, ...server.allocations.map((a) => a.port)]), [server]);

  function handleAdd() {
    const port = Number(portInput);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setError("Enter a port between 1 and 65535.");
      return;
    }
    if (ownPorts.has(port) || usedElsewhere.has(port)) {
      setError(`Port ${port} is already in use.`);
      return;
    }
    setError(null);
    create.mutate(port, { onSuccess: () => setPortInput("") });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <div className="min-w-0">
          <Link to={`/servers/${server.id}`} className="truncate text-sm font-semibold hover:underline">
            {server.name}
          </Link>
        </div>
        <StatusLabel status={server.status} />
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" title="Primary game port">
            {server.port}
          </Badge>
          {server.allocations.map((allocation) => (
            <Badge key={allocation.id} variant="outline" className="gap-1.5 pr-1">
              {allocation.port}
              {canEdit && (
                <button
                  type="button"
                  aria-label={`Remove port ${allocation.port}`}
                  className="rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(allocation.id)}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))}
          {server.allocations.length === 0 && (
            <span className="text-xs text-muted-foreground">No extra ports.</span>
          )}
        </div>

        {canEdit && (
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <Input
                type="number"
                min={1}
                max={65535}
                placeholder="Port, e.g. 8123"
                value={portInput}
                onChange={(e) => {
                  setPortInput(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAdd();
                  }
                }}
              />
              {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
            </div>
            <Button type="button" size="sm" variant="outline" onClick={handleAdd} disabled={create.isPending || !portInput}>
              <Plus /> Add
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AllocationsPage() {
  const { data, isLoading } = useServers();
  const { hasPermission } = useAuth();
  const servers = data?.servers ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Allocations</h1>
        <p className="text-sm text-muted-foreground">
          Open extra ports on your servers (e.g. for a map, voice chat, or Geyser). No two servers can share a port.
        </p>
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      )}

      {!isLoading && servers.length === 0 && (
        <EmptyState icon={Network} title="No servers yet" description="Create a server first to manage its port allocations." />
      )}

      {!isLoading && servers.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {servers.map((server) => (
            <ServerAllocationsCard
              key={server.id}
              server={server}
              allServers={servers}
              canEdit={hasPermission("servers.settings.edit") && server.myAccessLevel === "FULL"}
            />
          ))}
        </div>
      )}
    </div>
  );
}
