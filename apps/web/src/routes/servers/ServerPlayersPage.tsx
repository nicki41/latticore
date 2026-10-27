import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Filter, Search, Users, X } from "lucide-react";
import type { PlayerDto } from "@latticore/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/layout/EmptyState";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import {
  usePlayers,
  useOpPlayer,
  useDeopPlayer,
  useWhitelistAddPlayer,
  useWhitelistRemovePlayer,
  useKickPlayer,
  useBanPlayer,
  useUnbanPlayer,
  useMessagePlayer,
} from "@/lib/players";
import { useIpBan, useIpUnban, useSetGamemode, useTempBan, useWipe } from "@/lib/playerDetails";
import { PlayerCard } from "@/components/players/PlayerCard";
import { PlayerDetailModal } from "@/components/players/PlayerDetailModal";
import type { PlayerActionHandlers } from "@/components/players/playerActions";
import { useServerOutletContext } from "./useServerOutletContext";

type StatusKey = "online" | "offline" | "banned" | "whitelisted" | "op";
type SortKey = "online" | "name" | "lastSeen" | "playtime";

const STATUS_OPTIONS: { key: StatusKey; label: string }[] = [
  { key: "online", label: "Online" },
  { key: "offline", label: "Offline" },
  { key: "banned", label: "Banned" },
  { key: "whitelisted", label: "Whitelisted" },
  { key: "op", label: "OP" },
];

const SORTS: { key: SortKey; label: string }[] = [
  { key: "online", label: "Online first" },
  { key: "name", label: "Name (A–Z)" },
  { key: "lastSeen", label: "Last seen (recent first)" },
  { key: "playtime", label: "Playtime (most first)" },
];

function matchesStatus(p: PlayerDto, status: StatusKey): boolean {
  switch (status) {
    case "online":
      return p.online;
    case "offline":
      return !p.online;
    case "banned":
      return p.banned;
    case "whitelisted":
      return p.whitelisted;
    case "op":
      return p.op;
  }
}

function lastSeenTime(p: PlayerDto): number {
  if (p.online) return Infinity;
  return p.lastSeenAt ? new Date(p.lastSeenAt).getTime() : -Infinity;
}

export default function ServerPlayersPage() {
  const { server } = useServerOutletContext();
  const { hasPermission } = useAuth();
  const { data, isLoading } = usePlayers(server.id);
  const [search, setSearch] = useState("");
  const [statuses, setStatuses] = useState<Set<StatusKey>>(new Set());
  const [sort, setSort] = useState<SortKey>("online");
  const [minPlaytimeHours, setMinPlaytimeHours] = useState("");
  const [selected, setSelected] = useState<{ username: string; compose: boolean } | null>(null);

  const hasFullAccess = server.myAccessLevel === "FULL";
  const canOp = hasFullAccess && hasPermission("players.op");
  const canWhitelist = hasFullAccess && hasPermission("players.whitelist");
  const canKick = hasFullAccess && hasPermission("players.kick");
  const canBan = hasFullAccess && hasPermission("players.ban");
  const canMessage = hasFullAccess && hasPermission("players.message");
  const canWipe = hasFullAccess && hasPermission("players.wipe");

  const op = useOpPlayer(server.id);
  const deop = useDeopPlayer(server.id);
  const whitelistAdd = useWhitelistAddPlayer(server.id);
  const whitelistRemove = useWhitelistRemovePlayer(server.id);
  const kick = useKickPlayer(server.id);
  const ban = useBanPlayer(server.id);
  const unban = useUnbanPlayer(server.id);
  const message = useMessagePlayer(server.id);
  const tempBan = useTempBan(server.id);
  const ipBan = useIpBan(server.id);
  const ipUnban = useIpUnban(server.id);
  const wipe = useWipe(server.id);
  const setGamemode = useSetGamemode(server.id);

  async function run<TVars extends { username: string }>(action: { mutateAsync: (v: TVars) => Promise<unknown> }, vars: TVars, label: string) {
    try {
      await action.mutateAsync(vars);
      toast.success(`${label} ${vars.username}.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : `Failed to ${label.toLowerCase()} ${vars.username}.`);
    }
  }

  async function handleSendMessage(username: string, text: string) {
    try {
      await message.mutateAsync({ username, message: text });
      toast.success(`Message sent to ${username}.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : `Failed to message ${username}.`);
    }
  }

  const actions: PlayerActionHandlers = {
    canKick,
    canBan,
    canWhitelist,
    canOp,
    canMessage,
    canWipe,
    onKick: (username, reason) => void run(kick, { username, reason }, "Kicked"),
    onBan: (username, reason) => void run(ban, { username, reason }, "Banned"),
    onUnban: (username) => void run(unban, { username }, "Unbanned"),
    onWhitelistAdd: (username) => void run(whitelistAdd, { username }, "Whitelisted"),
    onWhitelistRemove: (username) => void run(whitelistRemove, { username }, "Removed from whitelist"),
    onOp: (username) => void run(op, { username }, "Opped"),
    onDeop: (username) => void run(deop, { username }, "De-opped"),
    onOpenDetail: (username) => setSelected({ username, compose: false }),
    onOpenMessage: (username) => setSelected({ username, compose: true }),
    onTempBan: (username, durationMinutes, reason) => void run(tempBan, { username, durationMinutes, reason }, "Temporarily banned"),
    onIpBan: (username, ip, reason) => void run(ipBan, { username, ip, reason }, "Banned IP for"),
    onIpUnban: (username, ip) => void run(ipUnban, { username, ip }, "Removed IP ban for"),
    onWipe: (username) => void run(wipe, { username }, "Wiped data for"),
    onSetGamemode: (username, mode) => void run(setGamemode, { username, mode }, "Changed gamemode for"),
  };

  const players = useMemo(() => data?.players ?? [], [data]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const minSeconds = Number(minPlaytimeHours) > 0 ? Number(minPlaytimeHours) * 3600 : 0;
    const result = players
      .filter((p) => !term || p.username.toLowerCase().includes(term))
      .filter((p) => p.playtimeSeconds >= minSeconds)
      .filter((p) => [...statuses].every((status) => matchesStatus(p, status)));

    switch (sort) {
      case "name":
        result.sort((a, b) => a.username.localeCompare(b.username));
        break;
      case "lastSeen":
        result.sort((a, b) => lastSeenTime(b) - lastSeenTime(a));
        break;
      case "playtime":
        result.sort((a, b) => b.playtimeSeconds - a.playtimeSeconds);
        break;
      default:
        result.sort((a, b) => Number(b.online) - Number(a.online) || a.username.localeCompare(b.username));
    }
    return result;
  }, [players, search, statuses, sort, minPlaytimeHours]);

  const selectedPlayer: PlayerDto | null = selected ? (players.find((p) => p.username === selected.username) ?? null) : null;

  const activeFilterCount = statuses.size + (Number(minPlaytimeHours) > 0 ? 1 : 0);

  function toggleStatus(status: StatusKey, checked: boolean) {
    setStatuses((prev) => {
      const next = new Set(prev);
      if (checked) next.add(status);
      else next.delete(status);
      return next;
    });
  }

  function clearFilters() {
    setStatuses(new Set());
    setMinPlaytimeHours("");
    setSort("online");
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Players</h1>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 basis-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search players…" className="pl-9" />
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant={activeFilterCount > 0 ? "default" : "outline"}>
              <Filter className="h-3.5 w-3.5" /> Filter
              {activeFilterCount > 0 && (
                <span className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary-foreground text-[10px] font-semibold text-primary">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 space-y-4" align="start">
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</div>
              <div className="space-y-2">
                {STATUS_OPTIONS.map((opt) => (
                  <label key={opt.key} className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox checked={statuses.has(opt.key)} onCheckedChange={(checked) => toggleStatus(opt.key, checked === true)} />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Sort by</Label>
              <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORTS.map((s) => (
                    <SelectItem key={s.key} value={s.key}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Min. playtime (hours)</Label>
              <Input
                type="number"
                min={0}
                value={minPlaytimeHours}
                onChange={(e) => setMinPlaytimeHours(e.target.value)}
                placeholder="0"
              />
            </div>

            {activeFilterCount > 0 && (
              <Button variant="ghost" size="sm" className="w-full" onClick={clearFilters}>
                <X className="h-3.5 w-3.5" /> Clear filters
              </Button>
            )}
          </PopoverContent>
        </Popover>
      </div>

      {isLoading && <Skeleton className="h-48 w-full" />}

      {!isLoading && players.length === 0 && (
        <EmptyState icon={Users} title="No known players" description="Players appear here once they join or are whitelisted/opped." />
      )}

      {!isLoading && players.length > 0 && filtered.length === 0 && (
        <EmptyState icon={Search} title="No matching players" description="Try a different search term or filter." />
      )}

      {!isLoading && filtered.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((p) => (
            <PlayerCard key={p.username} player={p} actions={actions} />
          ))}
        </div>
      )}

      {selected && (
        <PlayerDetailModal
          player={selectedPlayer}
          serverId={server.id}
          actions={actions}
          initialCompose={selected.compose}
          onClose={() => setSelected(null)}
          onSendMessage={handleSendMessage}
          sending={message.isPending}
        />
      )}
    </div>
  );
}
