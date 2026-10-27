import { useState } from "react";
import { Ban, LogOut, ShieldCheck, ShieldOff, ListPlus, ListX, ShieldX, Trash2, Clock, Globe, Gamepad2, Eye, EyeOff, MessageSquare, Check, Copy } from "lucide-react";
import type { PlayerBanDto, PlayerDto, PlayerGamemode } from "@latticore/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmActionDialog } from "../ConfirmActionDialog";
import { useCopyField } from "../useCopyField";
import type { PlayerActionHandlers } from "../playerActions";
import { useGamemode, usePlayerBans, usePlayerIpHistory, usePlayerNameHistory } from "@/lib/playerDetails";
import { formatDateTime, formatJoinDate } from "@/lib/playerFormat";

const DURATION_PRESETS = [
  { label: "10m", minutes: 10 },
  { label: "1h", minutes: 60 },
  { label: "6h", minutes: 360 },
  { label: "1d", minutes: 1440 },
  { label: "3d", minutes: 4320 },
  { label: "7d", minutes: 10080 },
  { label: "30d", minutes: 43200 },
];

const GAMEMODES: PlayerGamemode[] = ["SURVIVAL", "CREATIVE", "ADVENTURE", "SPECTATOR"];
const GAMEMODE_LABEL: Record<PlayerGamemode, string> = {
  SURVIVAL: "Survival",
  CREATIVE: "Creative",
  ADVENTURE: "Adventure",
  SPECTATOR: "Spectator",
};

interface PlayerModerationTabProps {
  player: PlayerDto;
  serverId: string;
  actions: PlayerActionHandlers;
  initialCompose: boolean;
  onSendMessage: (username: string, message: string) => Promise<void> | void;
  sending: boolean;
}

export function PlayerModerationTab({ player: p, serverId, actions, initialCompose, onSendMessage, sending }: PlayerModerationTabProps) {
  const [showCompose, setShowCompose] = useState(initialCompose);
  const [messageText, setMessageText] = useState("");
  const [showIps, setShowIps] = useState(false);
  const { copiedField, copy } = useCopyField();
  const { data: bansData, isLoading: bansLoading } = usePlayerBans(serverId, p.username);
  const { data: nameHistoryData } = usePlayerNameHistory(serverId, p.username);
  const { data: ipHistoryData } = usePlayerIpHistory(serverId, p.username);

  // The current IP is always recorded into IP history too (see
  // PlayerActivityTracker.recordIp), so it normally already leads the list —
  // this fallback only kicks in for profiles whose lastIp predates history
  // tracking, so "current IP" never silently disappears from the list.
  const ipEntries: { ip: string; seenAt: string | null }[] =
    p.lastIp && ipHistoryData?.history[0]?.ip !== p.lastIp
      ? [{ ip: p.lastIp, seenAt: null }, ...(ipHistoryData?.history ?? [])]
      : (ipHistoryData?.history ?? []);

  async function handleSend() {
    if (!messageText.trim()) return;
    await onSendMessage(p.username, messageText.trim());
    setMessageText("");
    setShowCompose(false);
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 text-sm font-medium">Quick actions</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {actions.canWhitelist &&
            (p.whitelisted ? (
              <ConfirmActionDialog
                trigger={
                  <Button variant="outline" size="sm" className="w-full">
                    <ListX className="h-3.5 w-3.5" /> Remove WL
                  </Button>
                }
                title={`Remove ${p.username} from the whitelist?`}
                description="They won't be able to join while the server is whitelisted."
                confirmLabel="Remove"
                onConfirm={() => actions.onWhitelistRemove(p.username)}
              />
            ) : (
              <ConfirmActionDialog
                trigger={
                  <Button variant="outline" size="sm" className="w-full">
                    <ListPlus className="h-3.5 w-3.5" /> Whitelist
                  </Button>
                }
                title={`Whitelist ${p.username}?`}
                description="They'll be allowed to join while the server is whitelisted."
                confirmLabel="Whitelist"
                onConfirm={() => actions.onWhitelistAdd(p.username)}
              />
            ))}
          {actions.canMessage && (
            <Button variant="outline" size="sm" className="w-full" disabled={!p.online} onClick={() => setShowCompose((v) => !v)}>
              <MessageSquare className="h-3.5 w-3.5" /> Message
            </Button>
          )}
          {actions.canOp && <GamemodeChanger player={p} serverId={serverId} actions={actions} />}
          {actions.canKick && (
            <ConfirmActionDialog
              trigger={
                <Button variant="outline" size="sm" disabled={!p.online} className="w-full">
                  <LogOut className="h-3.5 w-3.5" /> Kick
                </Button>
              }
              title={`Kick ${p.username}?`}
              description="They'll be disconnected immediately and can rejoin right away."
              confirmLabel="Kick"
              showReason
              onConfirm={(reason) => actions.onKick(p.username, reason)}
            />
          )}
          {actions.canBan &&
            (p.banned ? (
              <ConfirmActionDialog
                trigger={
                  <Button variant="outline" size="sm" className="w-full">
                    <ShieldX className="h-3.5 w-3.5" /> Unban
                  </Button>
                }
                title={`Unban ${p.username}?`}
                description="They'll be able to join the server again."
                confirmLabel="Unban"
                onConfirm={() => actions.onUnban(p.username)}
              />
            ) : (
              <ConfirmActionDialog
                trigger={
                  <Button variant="outline" size="sm" className="w-full">
                    <Ban className="h-3.5 w-3.5" /> Ban
                  </Button>
                }
                title={`Ban ${p.username}?`}
                description="They'll be disconnected and unable to rejoin until unbanned."
                confirmLabel="Ban"
                destructive
                showReason
                onConfirm={(reason) => actions.onBan(p.username, reason)}
              />
            ))}
          {actions.canBan && !p.banned && <TempBanDialog player={p} actions={actions} />}
          {actions.canBan && <IpBanDialog player={p} actions={actions} />}
          {actions.canWipe && (
            <ConfirmActionDialog
              trigger={
                <Button variant="destructive" size="sm" className="w-full">
                  <Trash2 className="h-3.5 w-3.5" /> Wipe
                </Button>
              }
              title={`Permanently wipe ${p.username}'s data?`}
              description="Deletes their stats and playerdata files — kills, deaths, distance, inventory, XP, everything. They'll start completely fresh next time they join. This cannot be undone."
              confirmLabel="Wipe data"
              destructive
              onConfirm={() => actions.onWipe(p.username)}
            />
          )}
          {actions.canOp &&
            (p.op ? (
              <ConfirmActionDialog
                trigger={
                  <Button variant="outline" size="sm" className="w-full">
                    <ShieldOff className="h-3.5 w-3.5" /> Deop
                  </Button>
                }
                title={`Remove operator from ${p.username}?`}
                description="They'll lose access to operator/admin commands."
                confirmLabel="Remove OP"
                onConfirm={() => actions.onDeop(p.username)}
              />
            ) : (
              <ConfirmActionDialog
                trigger={
                  <Button variant="destructive" size="sm" className="w-full">
                    <ShieldCheck className="h-3.5 w-3.5" /> Make OP
                  </Button>
                }
                title={`Make ${p.username} an operator?`}
                description="They'll gain access to operator/admin commands."
                confirmLabel="Make OP"
                destructive
                onConfirm={() => actions.onOp(p.username)}
              />
            ))}
        </div>

        {showCompose && (
          <div className="mt-3 flex gap-2">
            <Textarea
              autoFocus
              rows={1}
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              placeholder={`Message to ${p.username}…`}
              className="min-h-9 min-w-0 flex-1 resize-none py-2"
            />
            <Button onClick={() => void handleSend()} disabled={!messageText.trim() || sending}>
              Send
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <div className="mb-2 text-sm font-medium">Name history</div>
          {!nameHistoryData?.history.length ? (
            <div className="text-sm text-muted-foreground">No name changes on record.</div>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {nameHistoryData.history.map((entry, i) => (
                <li key={i} className="flex items-center justify-between rounded-md bg-muted/40 px-2.5 py-1.5">
                  <span className="font-medium">{entry.username}</span>
                  <span className="text-xs text-muted-foreground">{formatJoinDate(entry.changedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-medium">IP history</div>
            {!!ipEntries.length && (
              <button
                onClick={() => setShowIps((v) => !v)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                title={showIps ? "Hide IPs" : "Show IPs"}
              >
                {showIps ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {showIps ? "Hide" : "Show"}
              </button>
            )}
          </div>
          {!ipEntries.length ? (
            <div className="text-sm text-muted-foreground">No IPs on record.</div>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {ipEntries.map((entry, i) => (
                <li key={i} className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2.5 py-1.5">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-mono">{showIps ? entry.ip : "•••.•••.•••.•••"}</span>
                    {i === 0 && (
                      <Badge variant="outline" className="border-transparent bg-primary/15 text-primary">
                        Latest
                      </Badge>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-muted-foreground">{entry.seenAt ? formatJoinDate(entry.seenAt) : "current"}</span>
                    <button onClick={() => copy(`ip-${i}`, entry.ip)} className="text-muted-foreground hover:text-foreground" title="Copy IP">
                      {copiedField === `ip-${i}` ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div>
        <div className="mb-2 text-sm font-medium">Ban history</div>
        {bansLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : !bansData?.bans.length ? (
          <div className="text-sm text-muted-foreground">No bans on record.</div>
        ) : (
          <div className="space-y-2">
            {bansData.bans.map((ban) => (
              <BanRow key={ban.id} ban={ban} player={p} actions={actions} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GamemodeChanger({ player: p, serverId, actions }: { player: PlayerDto; serverId: string; actions: PlayerActionHandlers }) {
  const { data } = useGamemode(serverId, p.username);
  return (
    <Select value={data?.gamemode ?? undefined} onValueChange={(v) => actions.onSetGamemode(p.username, v as PlayerGamemode)} disabled={!p.online}>
      {/* Matches buttonVariants({variant:"outline", size:"sm"}) exactly (h-8, text-xs, rounded-md border shadow-sm) so it lines up with its sibling quick-action buttons instead of using Select's own (taller) default box. */}
      <SelectTrigger className="h-8 w-full gap-1.5 rounded-md border-input px-3 text-xs shadow-sm">
        <div className="flex min-w-0 items-center gap-1.5">
          <Gamepad2 className="h-3.5 w-3.5 shrink-0" />
          <SelectValue placeholder="Gamemode" />
        </div>
      </SelectTrigger>
      <SelectContent>
        {GAMEMODES.map((mode) => (
          <SelectItem key={mode} value={mode}>
            {GAMEMODE_LABEL[mode]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function BanRow({ ban, player: p, actions }: { ban: PlayerBanDto; player: PlayerDto; actions: PlayerActionHandlers }) {
  const isActive = !ban.revokedAt;
  const isExpired = ban.expiresAt && new Date(ban.expiresAt) <= new Date();

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline">{ban.type === "IP" ? "IP ban" : "Name ban"}</Badge>
        <span className="font-mono text-xs">{ban.target}</span>
        {isActive && !isExpired && (
          <Badge variant="outline" className="border-transparent bg-status-error/15 text-status-error">
            Active
          </Badge>
        )}
        {ban.revokedAt && <Badge variant="secondary">Removed</Badge>}
        {ban.expiresAt && <span className="text-xs text-muted-foreground">until {formatDateTime(ban.expiresAt)}</span>}
        {isActive && (
          <ConfirmActionDialog
            trigger={
              <Button variant="ghost" size="sm" className="ml-auto h-6 px-2 text-xs">
                Remove
              </Button>
            }
            title="Remove this ban?"
            description="They'll be able to join again immediately."
            confirmLabel="Remove ban"
            onConfirm={() => (ban.type === "IP" ? actions.onIpUnban(p.username, ban.target) : actions.onUnban(p.username))}
          />
        )}
      </div>
      <div className="mt-1.5 text-xs text-muted-foreground">
        {ban.reason ? `"${ban.reason}"` : "No reason given"} — by {ban.createdByUsername ?? "unknown"} on {formatDateTime(ban.createdAt)}
      </div>
    </div>
  );
}

function TempBanDialog({ player: p, actions }: { player: PlayerDto; actions: PlayerActionHandlers }) {
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState(String(DURATION_PRESETS[2]!.minutes));
  const [reason, setReason] = useState("");

  function handleConfirm() {
    const duration = Number(minutes);
    if (!duration || duration < 1) return;
    actions.onTempBan(p.username, duration, reason.trim() || undefined);
    setOpen(false);
    setReason("");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full">
          <Clock className="h-3.5 w-3.5" /> Tempban
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Temporarily ban {p.username}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Duration</Label>
            <div className="flex flex-wrap gap-1.5">
              {DURATION_PRESETS.map((preset) => (
                <Button
                  key={preset.minutes}
                  type="button"
                  size="sm"
                  variant={minutes === String(preset.minutes) ? "default" : "outline"}
                  className="h-7 px-2 text-xs"
                  onClick={() => setMinutes(String(preset.minutes))}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                className="w-28"
              />
              <span className="text-xs text-muted-foreground">minutes</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Reason (optional)</Label>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="resize-none text-sm" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!Number(minutes) || Number(minutes) < 1} onClick={handleConfirm}>
            Tempban
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IpBanDialog({ player: p, actions }: { player: PlayerDto; actions: PlayerActionHandlers }) {
  const [open, setOpen] = useState(false);
  const [ip, setIp] = useState(p.lastIp ?? "");
  const [reason, setReason] = useState("");

  function handleConfirm() {
    if (!ip.trim()) return;
    actions.onIpBan(p.username, ip.trim(), reason.trim() || undefined);
    setOpen(false);
    setReason("");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setIp(p.lastIp ?? "");
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full">
          <Globe className="h-3.5 w-3.5" /> IP ban
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ban an IP address</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">IP address</Label>
            <Input value={ip} onChange={(e) => setIp(e.target.value)} placeholder="203.0.113.11" className="font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Reason (optional)</Label>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="resize-none text-sm" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!ip.trim()} onClick={handleConfirm}>
            Ban IP
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
