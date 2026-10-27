import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AddNetworkBackendInput, NetworkCandidateDto, NetworkChangeResultDto, NetworkDto } from "@latticore/shared";
import { api } from "./api";

export function useNetwork(proxyId: string, enabled = true) {
  return useQuery({
    queryKey: ["servers", proxyId, "network"],
    queryFn: () => api.get<{ network: NetworkDto }>(`/servers/${proxyId}/network`),
    enabled,
    refetchInterval: 10_000,
  });
}

export function useNetworkCandidates(proxyId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["servers", proxyId, "network", "candidates"],
    queryFn: () => api.get<{ candidates: NetworkCandidateDto[] }>(`/servers/${proxyId}/network/candidates`),
    enabled,
  });
}

/** Network changes reconfigure backends too (exposePort, membership) — refresh every server, not just the proxy. */
function useNetworkMutation<TInput>(proxyId: string, fn: (input: TInput) => Promise<NetworkChangeResultDto>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["servers"] }),
  });
}

export function useAddNetworkBackend(proxyId: string) {
  return useNetworkMutation(proxyId, (input: AddNetworkBackendInput) => api.post<NetworkChangeResultDto>(`/servers/${proxyId}/network/backends`, input));
}

export function useRemoveNetworkBackend(proxyId: string) {
  return useNetworkMutation(proxyId, (memberId: string) => api.delete<NetworkChangeResultDto>(`/servers/${proxyId}/network/backends/${memberId}`));
}

export function useReorderNetwork(proxyId: string) {
  return useNetworkMutation(proxyId, (memberIds: string[]) => api.put<NetworkChangeResultDto>(`/servers/${proxyId}/network/order`, { memberIds }));
}

/** One toast-ready sentence on what the admin still has to do for a change to take effect. */
export function describeNetworkChange(result: NetworkChangeResultDto, verb: string): string {
  const steps: string[] = [];
  if (result.proxyReloaded) steps.push("the proxy picked it up live");
  if (result.proxyRestartRequired) steps.push("restart the proxy to apply it");
  if (result.backendRestartRequired) steps.push("restart that server so it accepts proxy connections");
  return steps.length ? `${verb} — ${steps.join(", and ")}.` : `${verb}.`;
}
