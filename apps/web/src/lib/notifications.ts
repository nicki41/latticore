import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type {
  NotificationPreferenceDto,
  NotificationChannelDto,
  UpdateNotificationPreferenceInput,
  CreateNotificationChannelInput,
  UpdateNotificationChannelInput,
} from "@latticore/shared";
import { api, ApiError } from "./api";

export function useNotificationPreferences(serverId: string) {
  return useQuery({
    queryKey: ["servers", serverId, "notifications", "preferences"],
    queryFn: () => api.get<{ preference: NotificationPreferenceDto }>(`/servers/${serverId}/notifications/preferences`),
  });
}

export function useUpdateNotificationPreferences(serverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateNotificationPreferenceInput) =>
      api.put<{ preference: NotificationPreferenceDto }>(`/servers/${serverId}/notifications/preferences`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["servers", serverId, "notifications", "preferences"] }),
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to save push preferences."),
  });
}

export function useNotificationChannels(serverId: string) {
  return useQuery({
    queryKey: ["servers", serverId, "notifications", "channels"],
    queryFn: () => api.get<{ channels: NotificationChannelDto[] }>(`/servers/${serverId}/notifications/channels`),
  });
}

export function useCreateNotificationChannel(serverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateNotificationChannelInput) =>
      api.post<{ channel: NotificationChannelDto }>(`/servers/${serverId}/notifications/channels`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["servers", serverId, "notifications", "channels"] });
      toast.success("Notification target added.");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to add notification target."),
  });
}

export function useUpdateNotificationChannel(serverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, input }: { channelId: string; input: UpdateNotificationChannelInput }) =>
      api.patch<{ channel: NotificationChannelDto }>(`/servers/${serverId}/notifications/channels/${channelId}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["servers", serverId, "notifications", "channels"] }),
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to update notification target."),
  });
}

export function useDeleteNotificationChannel(serverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (channelId: string) => api.delete<void>(`/servers/${serverId}/notifications/channels/${channelId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["servers", serverId, "notifications", "channels"] });
      toast.success("Notification target removed.");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to remove notification target."),
  });
}

export function useTestNotificationChannel(serverId: string) {
  return useMutation({
    mutationFn: (channelId: string) =>
      api.post<{ ok: boolean; error?: string }>(`/servers/${serverId}/notifications/channels/${channelId}/test`),
    onSuccess: (result) => {
      if (result.ok) toast.success("Test notification sent.");
      else toast.error(result.error ?? "Test send failed.");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Test send failed."),
  });
}
