import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Check, Plus, ShieldCheck, Trash2, Waypoints } from "lucide-react";
import type { NetworkBackendDto, NetworkCandidateDto } from "@latticore/shared";
import { networkBackendNameSchema } from "@latticore/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/layout/EmptyState";
import { StatusDot } from "@/components/servers/StatusBadge";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { softwareVersionLabel } from "@/lib/softwareMeta";
import { describeNetworkChange, useAddNetworkBackend, useNetwork, useNetworkCandidates, useRemoveNetworkBackend, useReorderNetwork } from "@/lib/network";
import { cn } from "@/lib/utils";
import { useServerOutletContext } from "./useServerOutletContext";

function slugName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^[-_]+|-+$/g, "")
      .slice(0, 32) || "server"
  );
}

function AddBackendDialog({ proxyId, open, onOpenChange, takenNames }: { proxyId: string; open: boolean; onOpenChange: (open: boolean) => void; takenNames: Set<string> }) {
  const candidates = useNetworkCandidates(proxyId, open);
  const add = useAddNetworkBackend(proxyId);
  const [selected, setSelected] = useState<NetworkCandidateDto | null>(null);
  const [name, setName] = useState("");

  const parsedName = networkBackendNameSchema.safeParse(name);
  const nameError = !name
    ? null
    : !parsedName.success
      ? parsedName.error.issues[0]?.message
      : name === "try"
        ? "“try” is reserved by the proxy"
        : takenNames.has(parsedName.data)
          ? "This network already has a server with that name"
          : null;

  function pick(candidate: NetworkCandidateDto) {
    setSelected(candidate);
    setName(slugName(candidate.name));
  }

  async function submit() {
    if (!selected || nameError || !parsedName.success) return;
    try {
      const result = await add.mutateAsync({ serverId: selected.id, name: parsedName.data });
      toast.success(describeNetworkChange(result, `${selected.name} joined the network`));
      onOpenChange(false);
      setSelected(null);
      setName("");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to add the server.");
    }
  }

  const list = candidates.data?.candidates ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a server to the network</DialogTitle>
          <DialogDescription>Everything is configured for you — pick a server and give it a name players can use with /server.</DialogDescription>
        </DialogHeader>

        {/* min-w-0: DialogContent is a grid, and a grid item won't shrink below its longest unbreakable line otherwise — the truncated reasons would widen the dialog. */}
        <div className="min-w-0 space-y-4">
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-1.5 scrollbar-thin">
            {candidates.isLoading && <Skeleton className="h-10 w-full" />}
            {!candidates.isLoading && list.length === 0 && (
              <p className="p-3 text-sm text-muted-foreground">No other servers yet — create a Paper server first, then add it here.</p>
            )}
            {list.map((candidate) => {
              const disabled = candidate.unsupportedReason !== null;
              const active = selected?.id === candidate.id;
              return (
                <button
                  type="button"
                  key={candidate.id}
                  disabled={disabled}
                  onClick={() => pick(candidate)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
                    active ? "bg-primary/15 text-primary" : "hover:bg-accent",
                    disabled && "cursor-not-allowed opacity-60 hover:bg-transparent",
                  )}
                >
                  <StatusDot status={candidate.status} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{candidate.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {candidate.unsupportedReason ?? softwareVersionLabel(candidate.software, candidate.mcVersion)}
                    </span>
                  </span>
                  {active && <Check className="h-4 w-4 shrink-0" />}
                </button>
              );
            })}
          </div>

          {selected && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="backend-name">Name in the network</Label>
                <Input id="backend-name" value={name} onChange={(e) => setName(e.target.value)} className="font-mono" aria-invalid={Boolean(nameError)} />
                {nameError ? (
                  <p className="text-xs text-destructive">{nameError}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Players switch here with <code className="font-mono">/server {name || "…"}</code>.
                  </p>
                )}
              </div>
              <ul className="space-y-1.5 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                <li className="flex gap-2">
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary" />
                  Sets up player forwarding on {selected.name} and switches its own login check off — the proxy authenticates players.
                </li>
                <li className="flex gap-2">
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary" />
                  Takes its port off the internet, so nobody can join it around the proxy.
                </li>
                <li className="flex gap-2">
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary" />
                  Adds it to the proxy and reloads the proxy if it&apos;s running.
                </li>
              </ul>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!selected || Boolean(nameError) || !name || add.isPending}>
            <Plus /> {add.isPending ? "Adding..." : "Add to network"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BackendRow({
  backend,
  index,
  count,
  canEdit,
  busy,
  onMove,
  onRemove,
}: {
  backend: NetworkBackendDto;
  index: number;
  count: number;
  canEdit: boolean;
  busy: boolean;
  onMove: (from: number, to: number) => void;
  onRemove: (backend: NetworkBackendDto) => void;
}) {
  const title = backend.server?.name ?? "Server you can't see";
  return (
    <div className="flex flex-wrap items-center gap-3 py-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">{index + 1}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {backend.server && <StatusDot status={backend.server.status} />}
          {backend.server ? (
            <Link to={`/servers/${backend.server.id}`} className="truncate text-sm font-medium hover:underline">
              {title}
            </Link>
          ) : (
            <span className="truncate text-sm font-medium text-muted-foreground">{title}</span>
          )}
          {index === 0 && <Badge variant="secondary">Default — players join here</Badge>}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          <code className="font-mono">/server {backend.name}</code>
          {backend.server && <> · {softwareVersionLabel(backend.server.software, backend.server.mcVersion)}</>}
        </p>
      </div>
      {canEdit && (
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" disabled={busy || index === 0} onClick={() => onMove(index, index - 1)} aria-label={`Move ${backend.name} up`}>
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" disabled={busy || index === count - 1} onClick={() => onMove(index, index + 1)} aria-label={`Move ${backend.name} down`}>
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" disabled={busy} aria-label={`Remove ${backend.name} from the network`}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove {title} from the network?</AlertDialogTitle>
                <AlertDialogDescription>
                  It becomes a standalone server again: its own login check is switched back on and its port is published again on its next
                  start. Nothing on the server is deleted.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => onRemove(backend)}>
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </div>
  );
}

export default function ServerNetworkPage() {
  const { server } = useServerOutletContext();
  const { hasPermission } = useAuth();
  const network = useNetwork(server.id);
  const remove = useRemoveNetworkBackend(server.id);
  const reorder = useReorderNetwork(server.id);
  const [adding, setAdding] = useState(false);

  const canEdit = server.myAccessLevel === "FULL" && hasPermission("servers.settings.edit");
  const backends = useMemo(() => network.data?.network.backends ?? [], [network.data]);
  const takenNames = useMemo(() => new Set(backends.map((b) => b.name)), [backends]);
  const busy = remove.isPending || reorder.isPending;

  async function move(from: number, to: number) {
    const ids = backends.map((b) => b.memberId);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved!);
    try {
      const result = await reorder.mutateAsync(ids);
      toast.success(describeNetworkChange(result, "Join order updated"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to change the order.");
    }
  }

  async function handleRemove(backend: NetworkBackendDto) {
    try {
      const result = await remove.mutateAsync(backend.memberId);
      toast.success(describeNetworkChange(result, `${backend.server?.name ?? backend.name} left the network`));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to remove the server.");
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Waypoints className="h-4 w-4" /> Network
            </CardTitle>
            <CardDescription>
              Players join {server.name} and land on the first reachable server below; they switch with /server &lt;name&gt;.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {network.data && (
              <Badge variant="secondary">{network.data.network.forwardingMode === "modern" ? "Modern forwarding (signed)" : "Legacy IP forwarding"}</Badge>
            )}
            {canEdit && (
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus /> Add server
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {network.isLoading && <Skeleton className="h-16 w-full" />}
          {!network.isLoading && backends.length === 0 && (
            <EmptyState
              icon={Waypoints}
              title="No servers behind this proxy yet"
              description="Add your lobby, survival or minigame servers — forwarding, login checks and ports are set up automatically."
            />
          )}
          {backends.length > 0 && (
            <div className="divide-y divide-border">
              {backends.map((backend, index) => (
                <BackendRow
                  key={backend.memberId}
                  backend={backend}
                  index={index}
                  count={backends.length}
                  canEdit={canEdit}
                  busy={busy}
                  onMove={move}
                  onRemove={handleRemove}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {canEdit && <AddBackendDialog proxyId={server.id} open={adding} onOpenChange={setAdding} takenNames={takenNames} />}
    </div>
  );
}
