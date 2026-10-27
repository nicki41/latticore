import type { PlayerDto } from "@latticore/shared";

interface PlayerStatusChipProps {
  player: Pick<PlayerDto, "online" | "banned">;
  className?: string;
}

/** Online/Offline/Banned status pill — shared between the card grid and the detail modal header so the color logic lives in exactly one place. */
export function PlayerStatusChip({ player: p, className }: PlayerStatusChipProps) {
  const statusText = p.banned ? "Banned" : p.online ? "Online" : "Offline";
  const textColor = p.banned ? "text-status-error" : p.online ? "text-status-online" : "text-status-offline";
  const dotColor = p.banned ? "bg-status-error" : p.online ? "bg-status-online" : "bg-status-offline";
  const bg = p.banned ? "bg-status-error/15" : p.online ? "bg-status-online/15" : "bg-status-offline/15";

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${bg} ${textColor} ${className ?? ""}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
      {statusText}
    </span>
  );
}
