import { useQuery } from "@tanstack/react-query";
import type { AuditLogDto } from "@latticore/shared";
import { api } from "./api";

export interface AuditLogFilters {
  userId?: string;
  serverId?: string;
  action?: string;
  limit?: number;
  offset?: number;
}

function toQueryString(params: AuditLogFilters): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

export function useAuditLog(filters: AuditLogFilters) {
  return useQuery({
    queryKey: ["audit-log", filters],
    queryFn: () => api.get<{ logs: AuditLogDto[]; total: number }>(`/audit-log${toQueryString(filters)}`),
    placeholderData: (prev) => prev,
  });
}

export function useAuditActions() {
  return useQuery({
    queryKey: ["audit-log", "actions"],
    queryFn: () => api.get<{ actions: string[] }>("/audit-log/actions"),
    staleTime: 60_000,
  });
}
