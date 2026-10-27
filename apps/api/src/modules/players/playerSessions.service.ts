import type { PrismaClient } from "@prisma/client";
import type { PlayerSessionSummaryDto, PlayerSessionsRange } from "@latticore/shared";

const DAY_MS = 24 * 60 * 60 * 1000;

function rangeStart(range: PlayerSessionsRange, now: Date): Date | null {
  switch (range) {
    case "today": {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return start;
    }
    case "7d":
      return new Date(now.getTime() - 7 * DAY_MS);
    case "30d":
      return new Date(now.getTime() - 30 * DAY_MS);
    case "all":
      return null;
  }
}

function bucketKey(date: Date, range: PlayerSessionsRange): string {
  const iso = date.toISOString();
  // "today" buckets by hour for a more useful mini chart; everything else buckets by day.
  return range === "today" ? iso.slice(0, 13) + ":00" : iso.slice(0, 10);
}

export interface SessionLike {
  startedAt: Date;
  endedAt: Date | null;
  durationSeconds: number | null;
}

/**
 * Pure aggregation over already-fetched session rows — exported separately
 * from the DB query so it's directly unit-testable. A session's whole
 * duration is attributed to the bucket containing its start time (not split
 * across a midnight boundary) — a deliberate simplification for a "mini
 * chart", not meant to be minute-perfect.
 */
export function summarizeSessions(sessions: SessionLike[], range: PlayerSessionsRange, now: Date = new Date()): PlayerSessionSummaryDto {
  const start = rangeStart(range, now);
  const inRange = sessions.filter((s) => !start || s.startedAt >= start);

  const durationOf = (s: SessionLike) => s.durationSeconds ?? Math.max(0, Math.round((now.getTime() - s.startedAt.getTime()) / 1000));

  const buckets = new Map<string, number>();
  let total = 0;
  let longest = 0;
  for (const s of inRange) {
    const duration = durationOf(s);
    total += duration;
    if (duration > longest) longest = duration;
    const key = bucketKey(s.startedAt, range);
    buckets.set(key, (buckets.get(key) ?? 0) + duration);
  }

  return {
    range,
    buckets: [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([bucket, seconds]) => ({ bucket, seconds })),
    sessionCount: inRange.length,
    averageSessionSeconds: inRange.length > 0 ? Math.round(total / inRange.length) : 0,
    longestSessionSeconds: longest,
    totalSeconds: total,
  };
}

export class PlayerSessionService {
  constructor(private readonly prisma: PrismaClient) {}

  async summarize(serverId: string, usernameLower: string, range: PlayerSessionsRange): Promise<PlayerSessionSummaryDto> {
    const sessions = await this.prisma.playerSession.findMany({
      where: { serverId, usernameLower },
      select: { startedAt: true, endedAt: true, durationSeconds: true },
      orderBy: { startedAt: "asc" },
    });
    return summarizeSessions(sessions, range);
  }
}
