import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import type { PlayerDto } from "@latticore/shared";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { SkinViewer3D } from "./SkinViewer3D";
import { PlayerStatusChip } from "./PlayerStatusChip";
import { useCopyField } from "./useCopyField";
import type { PlayerActionHandlers } from "./playerActions";
import { PlayerActivityTab } from "./tabs/PlayerActivityTab";
import { PlayerModerationTab } from "./tabs/PlayerModerationTab";
import { PlayerStatsTab } from "./tabs/PlayerStatsTab";

interface PlayerDetailModalProps {
  player: PlayerDto | null;
  serverId: string;
  actions: PlayerActionHandlers;
  initialCompose: boolean;
  onClose: () => void;
  onSendMessage: (username: string, message: string) => Promise<void> | void;
  sending: boolean;
}

export function PlayerDetailModal({ player: p, serverId, actions, initialCompose, onClose, onSendMessage, sending }: PlayerDetailModalProps) {
  const { copiedField, copy } = useCopyField();
  const [tab, setTab] = useState(initialCompose ? "moderation" : "activity");

  useEffect(() => {
    setTab(initialCompose ? "moderation" : "activity");
  }, [p?.username, initialCompose]);

  if (!p) return null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/*
        overflow-x-hidden, not overflow-hidden: the base DialogContent
        already sets overflow-y-auto (Phase 1 mobile fix) so tall content
        can scroll — overflow-hidden here would win via tailwind-merge
        (same axis, last one wins) and silently make the whole dialog
        unscrollable again. overflow-x-hidden only clips the sideways
        corner-bleed this was originally added for, without touching Y.
      */}
      <DialogContent className="grid max-w-4xl grid-cols-1 gap-0 overflow-x-hidden p-0 sm:grid-cols-[260px_1fr]">
        <div className="flex flex-col items-center justify-center gap-3 bg-muted/30 p-6">
          {p.uuid ? (
            <>
              <SkinViewer3D uuid={p.uuid} />
              <div className="text-center text-[11px] text-muted-foreground">Drag to rotate</div>
            </>
          ) : (
            <div className="flex h-[300px] w-[260px] items-center justify-center rounded-lg bg-muted/40 text-xs text-muted-foreground">
              No UUID on record
            </div>
          )}
        </div>

        {/*
          Fixed height + independently-scrolling tab content is a desktop-
          only affordance (sm:h-[600px]/sm:overflow-hidden below) — on
          mobile the columns stack (grid-cols-1 above sm), so this box is
          left auto-height and flows naturally, letting the outer Dialog's
          own scroll (see the overflow-x-hidden note above) reach
          everything instead of relying on a second, nested scroll region,
          which is exactly the kind of thing iOS Safari handles unreliably.
        */}
        <div className="flex flex-col p-6 sm:h-[600px] sm:overflow-hidden">
          <div className="mb-1 flex items-center gap-2">
            <div className="text-xl font-bold">{p.username}</div>
            <button onClick={() => copy("username", p.username)} className="text-muted-foreground hover:text-foreground" title="Copy username">
              {copiedField === "username" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
          <div className="mb-2.5 flex items-center gap-1.5">
            <span className="font-mono text-xs text-muted-foreground">{p.uuid ?? "Unknown UUID"}</span>
            {p.uuid && (
              <button onClick={() => copy("uuid", p.uuid!)} className="text-muted-foreground hover:text-foreground" title="Copy UUID">
                {copiedField === "uuid" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            )}
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            <PlayerStatusChip player={p} />
            {p.whitelisted && (
              <Badge variant="outline" className="border-transparent bg-amber-500/15 text-amber-500">
                Whitelisted
              </Badge>
            )}
            {p.op && (
              <Badge variant="outline" className="border-transparent bg-violet-500/15 text-violet-400">
                Operator
              </Badge>
            )}
          </div>

          <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
            <TabsList className="shrink-0">
              <TabsTrigger value="activity">Activity</TabsTrigger>
              <TabsTrigger value="moderation">Moderation</TabsTrigger>
              <TabsTrigger value="stats">Ingame Statistic</TabsTrigger>
            </TabsList>

            <div className="mt-4 min-h-0 flex-1 pr-1 sm:overflow-y-auto">
              <TabsContent value="activity" className="mt-0">
                <PlayerActivityTab player={p} serverId={serverId} />
              </TabsContent>
              <TabsContent value="moderation" className="mt-0">
                <PlayerModerationTab
                  player={p}
                  serverId={serverId}
                  actions={actions}
                  initialCompose={initialCompose}
                  onSendMessage={onSendMessage}
                  sending={sending}
                />
              </TabsContent>
              <TabsContent value="stats" className="mt-0">
                <PlayerStatsTab player={p} serverId={serverId} />
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
