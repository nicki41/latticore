import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateWorkflowInput,
  CronPreviewDto,
  SchedulerRunDto,
  SchedulerWorkflowDto,
  UpdateWorkflowInput,
} from "@latticore/shared";
import { api } from "./api";

export function useWorkflows(serverId: string) {
  return useQuery({
    queryKey: ["servers", serverId, "scheduler"],
    queryFn: () => api.get<{ workflows: SchedulerWorkflowDto[] }>(`/servers/${serverId}/scheduler`),
  });
}

export function useWorkflowRuns(serverId: string, workflowId: string | null) {
  return useQuery({
    queryKey: ["servers", serverId, "scheduler", workflowId, "runs"],
    queryFn: () => api.get<{ runs: SchedulerRunDto[] }>(`/servers/${serverId}/scheduler/${workflowId}/runs`),
    enabled: workflowId !== null,
    refetchInterval: workflowId !== null ? 5000 : false,
  });
}

export function useCreateWorkflow(serverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWorkflowInput) =>
      api.post<{ workflow: SchedulerWorkflowDto }>(`/servers/${serverId}/scheduler`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["servers", serverId, "scheduler"] }),
  });
}

export function useUpdateWorkflow(serverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ workflowId, input }: { workflowId: string; input: UpdateWorkflowInput }) =>
      api.patch<{ workflow: SchedulerWorkflowDto }>(`/servers/${serverId}/scheduler/${workflowId}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["servers", serverId, "scheduler"] }),
  });
}

export function useDeleteWorkflow(serverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (workflowId: string) => api.delete(`/servers/${serverId}/scheduler/${workflowId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["servers", serverId, "scheduler"] }),
  });
}

export function useRunWorkflowNow(serverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (workflowId: string) =>
      api.post<{ run: SchedulerRunDto }>(`/servers/${serverId}/scheduler/${workflowId}/run`),
    onSuccess: (_data, workflowId) => {
      qc.invalidateQueries({ queryKey: ["servers", serverId, "scheduler"] });
      qc.invalidateQueries({ queryKey: ["servers", serverId, "scheduler", workflowId, "runs"] });
    },
  });
}

export function useCronPreview(serverId: string, cronExpr: string) {
  return useQuery({
    queryKey: ["servers", serverId, "scheduler", "cron-preview", cronExpr],
    queryFn: () => api.post<CronPreviewDto>(`/servers/${serverId}/scheduler/cron/preview`, { cronExpr }),
    enabled: cronExpr.trim().length > 0,
    staleTime: 60_000,
  });
}
