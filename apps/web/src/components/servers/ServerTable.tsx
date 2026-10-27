import { Link } from "react-router-dom";
import { Play, Square, RotateCw, ArrowUpRight } from "lucide-react";
import type { ServerDto } from "@latticore/shared";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { StatusLabel } from "./StatusBadge";
import { Sparkline } from "./Sparkline";
import { ServerIconThumb } from "./ServerIconThumb";
import { softwareVersionLabel } from "@/lib/softwareMeta";
import { useServerRowData } from "./useServerRowData";

const LOAD_COLOR = "hsl(var(--primary))";

function ServerTableRow({ server }: { server: ServerDto }) {
  const { canFull, iconUrl, uptime, onlineCount, maxPlayers, address, loadSeries, currentLoad, actions } = useServerRowData(server);
  const { run, busy, canStart, canStop, canRestart, showStop } = actions;

  return (
    <TableRow>
      <TableCell>
        <Link to={`/servers/${server.id}`} className="flex items-center gap-2.5 hover:underline">
          <ServerIconThumb iconUrl={iconUrl} size="h-8 w-8" />
          <span className="truncate font-medium">{server.name}</span>
        </Link>
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {softwareVersionLabel(server.software, server.mcVersion)}
      </TableCell>
      <TableCell>
        <StatusLabel status={server.status} />
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">{uptime}</TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {maxPlayers !== null ? `${onlineCount} / ${maxPlayers}` : "—"}
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">{address}</TableCell>
      <TableCell className="w-28">
        <div className="flex items-center gap-2">
          <div className="w-16">
            <Sparkline data={loadSeries} color={LOAD_COLOR} height={20} />
          </div>
          <span className="text-xs text-muted-foreground">{currentLoad !== null ? `${Math.round(currentLoad)}%` : "—"}</span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-1.5">
          {canFull && (
            <>
              {showStop ? (
                <Button size="icon" variant="outline" className="h-7 w-7" aria-label="Stop server" onClick={() => run("stop")} disabled={!canStop || busy}>
                  <Square className="h-3 w-3" />
                </Button>
              ) : (
                <Button size="icon" className="h-7 w-7" aria-label="Start server" onClick={() => run("start")} disabled={!canStart || busy}>
                  <Play className="h-3 w-3" />
                </Button>
              )}
              <Button size="icon" variant="outline" className="h-7 w-7" aria-label="Restart server" onClick={() => run("restart")} disabled={!canRestart || busy}>
                <RotateCw className="h-3 w-3" />
              </Button>
            </>
          )}
          <Button asChild size="icon" variant="outline" className="h-7 w-7" aria-label="Open server">
            <Link to={`/servers/${server.id}`}>
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

export function ServerTable({ servers }: { servers: ServerDto[] }) {
  return (
    <div className="rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Server</TableHead>
            <TableHead>Version</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Uptime</TableHead>
            <TableHead>Players</TableHead>
            <TableHead>Address</TableHead>
            <TableHead>Load</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {servers.map((server) => (
            <ServerTableRow key={server.id} server={server} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
