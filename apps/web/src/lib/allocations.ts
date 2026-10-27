import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ServerAllocationDto } from "@latticore/shared";
import { api, ApiError } from "./api";

interface AllocationMutationResult {
  restartRequired: boolean;
}

function notifyRestart(result: AllocationMutationResult, message: string) {
  toast.success(result.restartRequired ? `${message} Restart the server to apply it.` : message);
}

export function useCreateAllocation(serverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (port: number) =>
      api.post<{ allocation: ServerAllocationDto } & AllocationMutationResult>(`/servers/${serverId}/allocations`, { port }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["servers"] });
      qc.invalidateQueries({ queryKey: ["servers", serverId] });
      notifyRestart(result, "Port allocated.");
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Failed to allocate port.");
    },
  });
}

export function useDeleteAllocation(serverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (allocationId: string) =>
      api.delete<AllocationMutationResult>(`/servers/${serverId}/allocations/${allocationId}`),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["servers"] });
      qc.invalidateQueries({ queryKey: ["servers", serverId] });
      notifyRestart(result, "Port removed.");
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Failed to remove port.");
    },
  });
}
