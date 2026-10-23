import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export function usePublicIp() {
  return useQuery({
    queryKey: ["system", "network"],
    queryFn: () => api.get<{ publicIp: string | null }>("/system/network"),
    staleTime: 30 * 60_000,
  });
}

export interface SystemInfo {
  /** IANA zone the panel runs in — scheduler cron expressions are evaluated in it. */
  timezone: string;
}

export function useSystemInfo() {
  return useQuery({
    queryKey: ["system", "info"],
    queryFn: () => api.get<SystemInfo>("/system/info"),
    staleTime: Infinity,
  });
}

/** Formats an instant in the panel's zone (falls back to the browser's while that's still loading). */
export function formatInZone(iso: string, timeZone: string | undefined): string {
  return new Date(iso).toLocaleString(undefined, { timeZone, dateStyle: "medium", timeStyle: "short" });
}
