import type { AccessLevel, ServerRuntime, ServerSoftware, ServerStatus } from "./enums.js";

export interface ServerAllocationDto {
  id: string;
  /** Extra host port published alongside ServerDto.port — see the ServerAllocation model doc comment for why this is a separate table instead of an array column. */
  port: number;
  createdAt: string;
}

export interface ServerDto {
  id: string;
  name: string;
  description: string | null;
  software: ServerSoftware;
  mcVersion: string;
  /** Installed build/loader version (Paper build, Fabric/Forge/NeoForge loader) — null for Vanilla and legacy servers. */
  buildVersion: string | null;
  /** LEGACY (itzg image, RCON) vs PANEL_MANAGED (panel-owned install, direct console attach). Fixed at creation, never changes. */
  runtime: ServerRuntime;
  status: ServerStatus;
  statusDetail: string | null;
  port: number;
  /** Extra ports published in addition to `port` — managed from the Allocations page, applied on next (re)start. */
  allocations: ServerAllocationDto[];
  memoryMb: number;
  cpuCores: number;
  diskLimitMb: number | null;
  eulaAccepted: boolean;
  createdAt: string;
  updatedAt: string;
  /** The requesting user's access level on this server. Owner is always reported as FULL, even though they bypass ServerAccess entirely. */
  myAccessLevel: AccessLevel;
}

export interface ServerStatsDto {
  cpuPercent: number;
  memoryUsageBytes: number;
  memoryLimitBytes: number;
  diskUsageBytes: number;
  networkRxBytes: number;
  networkTxBytes: number;
  /** ISO timestamp the container last started, or null if it isn't running. */
  startedAt: string | null;
}

export type MetricsRange = "5m" | "15m" | "1h" | "6h" | "24h";

export interface MetricsSampleDto {
  timestamp: number;
  cpuPercent: number;
  memoryUsageBytes: number;
  memoryLimitBytes: number;
  /** Directory-size sampling is expensive, so this is populated only on a slower cadence than the other fields — null on samples where it wasn't measured. */
  diskUsageBytes: number | null;
  networkRxBytes: number;
  networkTxBytes: number;
  /** Null when the server wasn't RUNNING (no RCON) at sample time. */
  playerCount: number | null;
}

export interface MetricsHistoryDto {
  range: MetricsRange;
  samples: MetricsSampleDto[];
}
