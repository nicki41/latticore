import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BackupDto, BackupSettingsDto, BackupSettingsInput, CreateBackupInput } from "@latticore/shared";
import { api } from "./api";

export function useBackups(serverId: string) {
  return useQuery({
    queryKey: ["servers", serverId, "backups"],
    queryFn: () => api.get<{ backups: BackupDto[]; settings: BackupSettingsDto }>(`/servers/${serverId}/backups`),
  });
}

export function useCreateBackup(serverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBackupInput) => api.post<{ backup: BackupDto }>(`/servers/${serverId}/backups`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["servers", serverId, "backups"] }),
  });
}

export function useDeleteBackup(serverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (backupId: string) => api.delete(`/servers/${serverId}/backups/${backupId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["servers", serverId, "backups"] }),
  });
}

export function useSetBackupLocked(serverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ backupId, locked }: { backupId: string; locked: boolean }) =>
      api.patch<{ backup: BackupDto }>(`/servers/${serverId}/backups/${backupId}`, { locked }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["servers", serverId, "backups"] }),
  });
}

export function useUpdateBackupSettings(serverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BackupSettingsInput) => api.put<{ settings: BackupSettingsDto }>(`/servers/${serverId}/backups/settings`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["servers", serverId, "backups"] }),
  });
}

export function useRestoreBackup(serverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (backupId: string) => api.post(`/servers/${serverId}/backups/${backupId}/restore`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["servers", serverId] }),
  });
}

export function backupDownloadUrl(serverId: string, backupId: string): string {
  return `/api/servers/${serverId}/backups/${backupId}/download`;
}
