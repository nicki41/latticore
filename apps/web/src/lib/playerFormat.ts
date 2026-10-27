import { format, formatDistanceToNowStrict } from "date-fns";
import type { PlayerDto } from "@latticore/shared";

export function formatPlaytime(seconds: number): string {
  if (seconds <= 0) return "0m";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

export function formatLastSeen(player: Pick<PlayerDto, "online" | "lastSeenAt">): string {
  if (player.online) return "Online now";
  if (!player.lastSeenAt) return "Never";
  return formatDistanceToNowStrict(new Date(player.lastSeenAt), { addSuffix: true });
}

export function formatJoinDate(isoDate: string | null): string {
  if (!isoDate) return "Unknown";
  return format(new Date(isoDate), "MMM d, yyyy");
}

/** Date + time — used where minute-level precision matters (tempban expiry can be as short as 10 minutes, so a date-only label would be ambiguous/useless). */
export function formatDateTime(isoDate: string | null): string {
  if (!isoDate) return "Unknown";
  return format(new Date(isoDate), "MMM d, yyyy HH:mm");
}
