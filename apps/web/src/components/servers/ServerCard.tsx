import { Link } from "react-router-dom";
import { Radio, Clock, Users, Play, Square, RotateCw } from "lucide-react";
import type { ServerDto } from "@latticore/shared";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusLabel } from "./StatusBadge";
import { Sparkline } from "./Sparkline";
import { ServerIconThumb } from "./ServerIconThumb";
import { softwareVersionLabel } from "@/lib/softwareMeta";
import { useServerRowData } from "./useServerRowData";

const LOAD_COLOR = "hsl(var(--primary))";

export function ServerCard({ server }: { server: ServerDto }) {
  const { canFull, iconUrl, uptime, onlineCount, maxPlayers, address, loadSeries, actions } = useServerRowData(server);
  const { run, busy, canStart, canStop, canRestart, showStop } = actions;

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <ServerIconThumb iconUrl={iconUrl} />
            <div className="min-w-0">
              <Link to={`/servers/${server.id}`} className="truncate text-sm font-semibold hover:underline">
                {server.name}
              </Link>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {softwareVersionLabel(server.software, server.mcVersion)}
              </p>
            </div>
          </div>
          <StatusLabel status={server.status} />
        </div>
      </CardHeader>
      <CardContent className="flex-1 space-y-2.5 pb-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <Radio className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate font-medium text-foreground">{address}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 shrink-0" />
          <span className="font-medium text-foreground">{uptime}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5 shrink-0" />
          <span className="font-medium text-foreground">
            {maxPlayers !== null ? `${onlineCount} / ${maxPlayers}` : "—"}
          </span>
        </div>
        <Sparkline data={loadSeries} color={LOAD_COLOR} />
      </CardContent>
      <CardFooter className="gap-1.5">
        {canFull && (
          <>
            {showStop ? (
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8"
                aria-label="Stop server"
                onClick={() => run("stop")}
                disabled={!canStop || busy}
              >
                <Square className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button
                size="icon"
                className="h-8 w-8"
                aria-label="Start server"
                onClick={() => run("start")}
                disabled={!canStart || busy}
              >
                <Play className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              size="icon"
              variant="outline"
              className="h-8 w-8"
              aria-label="Restart server"
              onClick={() => run("restart")}
              disabled={!canRestart || busy}
            >
              <RotateCw className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
        <Button asChild size="sm" variant="outline" className="flex-1">
          <Link to={`/servers/${server.id}`}>Open Server</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
