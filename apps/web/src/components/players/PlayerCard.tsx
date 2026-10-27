import { Ban, LogOut, MessageSquare, ShieldCheck, ShieldOff, ListPlus, ListX, ShieldX } from "lucide-react";
import type { PlayerDto } from "@latticore/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PlayerFaceIcon } from "./PlayerFaceIcon";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
import type { PlayerActionHandlers } from "./playerActions";
import { formatLastSeen, formatPlaytime } from "@/lib/playerFormat";

interface PlayerCardProps {
  player: PlayerDto;
  actions: PlayerActionHandlers;
}

export function PlayerCard({ player: p, actions }: PlayerCardProps) {
  const statusColor = p.banned ? "bg-status-error" : p.online ? "bg-status-online" : "bg-status-offline";

  return (
    <div
      onClick={() => actions.onOpenDetail(p.username)}
      className="flex h-full cursor-pointer flex-col rounded-xl border border-border bg-card p-4 transition-colors hover:border-foreground/20"
    >
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          <PlayerFaceIcon uuid={p.uuid} size={52} className="rounded-lg" />
          <span className={`absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full border-2 border-card ${statusColor}`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold">{p.username}</div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">{p.uuid ?? "—"}</div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {p.whitelisted && (
              <Badge variant="outline" className="border-transparent bg-amber-500/15 text-amber-500">
                WL
              </Badge>
            )}
            {p.op && (
              <Badge variant="outline" className="border-transparent bg-violet-500/15 text-violet-400">
                OP
              </Badge>
            )}
            {p.banned && <Badge variant="destructive">Banned</Badge>}
          </div>
        </div>
      </div>

      {/* Pinned to the card's bottom edge (mt-auto) regardless of how tall the badges row above grows — otherwise cards without WL/OP badges have their stats/buttons sitting higher than cards with badges in the same grid row. */}
      <div className="mt-auto">
        <div className="mt-3.5 grid grid-cols-2 gap-2">
          <div className="rounded-md bg-muted/40 px-2.5 py-1.5">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Last seen</div>
            <div className="mt-0.5 text-sm font-medium">{formatLastSeen(p)}</div>
          </div>
          <div className="rounded-md bg-muted/40 px-2.5 py-1.5">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Playtime</div>
            <div className="mt-0.5 text-sm font-medium">{formatPlaytime(p.playtimeSeconds)}</div>
          </div>
        </div>

        <div className="mt-3 flex gap-1.5" onClick={(e) => e.stopPropagation()}>
        {actions.canKick && (
          <ConfirmActionDialog
            trigger={
              <Button variant="outline" size="icon" className="h-8 flex-1" title="Kick" disabled={!p.online}>
                <LogOut className="h-3.5 w-3.5" />
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
                <Button variant="outline" size="icon" className="h-8 flex-1" title="Unban">
                  <ShieldX className="h-3.5 w-3.5" />
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
                <Button variant="outline" size="icon" className="h-8 flex-1" title="Ban">
                  <Ban className="h-3.5 w-3.5" />
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
        {actions.canWhitelist &&
          (p.whitelisted ? (
            <ConfirmActionDialog
              trigger={
                <Button variant="outline" size="icon" className="h-8 flex-1" title="Remove from whitelist">
                  <ListX className="h-3.5 w-3.5" />
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
                <Button variant="outline" size="icon" className="h-8 flex-1" title="Add to whitelist">
                  <ListPlus className="h-3.5 w-3.5" />
                </Button>
              }
              title={`Whitelist ${p.username}?`}
              description="They'll be allowed to join while the server is whitelisted."
              confirmLabel="Whitelist"
              onConfirm={() => actions.onWhitelistAdd(p.username)}
            />
          ))}
        {actions.canOp &&
          (p.op ? (
            <ConfirmActionDialog
              trigger={
                <Button variant="outline" size="icon" className="h-8 flex-1" title="Remove OP">
                  <ShieldOff className="h-3.5 w-3.5" />
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
                <Button variant="outline" size="icon" className="h-8 flex-1" title="Make OP">
                  <ShieldCheck className="h-3.5 w-3.5" />
                </Button>
              }
              title={`Make ${p.username} an operator?`}
              description="They'll gain access to operator/admin commands."
              confirmLabel="Make OP"
              onConfirm={() => actions.onOp(p.username)}
            />
          ))}
        {actions.canMessage && (
          <Button
            variant="outline"
            size="icon"
            className="h-8 flex-1"
            title="Message"
            disabled={!p.online}
            onClick={(e) => {
              e.stopPropagation();
              actions.onOpenMessage(p.username);
            }}
          >
            <MessageSquare className="h-3.5 w-3.5" />
          </Button>
        )}
        </div>
      </div>
    </div>
  );
}
