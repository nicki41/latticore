import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateUserInput, ServerAccessGrantDto, UpdateUserInput, UserDto } from "@latticore/shared";
import { api } from "./api";

export function useUsers() {
  return useQuery({
    queryKey: ["users"],
    queryFn: () => api.get<{ users: UserDto[] }>("/users"),
  });
}

export function useUser(id: string | undefined) {
  return useQuery({
    queryKey: ["users", id],
    queryFn: () => api.get<{ user: UserDto }>(`/users/${id}`),
    enabled: Boolean(id),
  });
}

export function useUserAccess(id: string | undefined) {
  return useQuery({
    queryKey: ["users", id, "access"],
    queryFn: () => api.get<{ access: ServerAccessGrantDto[]; allServers: { id: string; name: string }[] }>(`/users/${id}/access`),
    enabled: Boolean(id),
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateUserInput) => api.post<{ user: UserDto }>("/users", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useUpdateUser(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateUserInput) => api.patch<{ user: UserDto }>(`/users/${id}`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["users", id] });
    },
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useSetServerAccess(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ serverId, level }: { serverId: string; level: "FULL" | "VIEW_ONLY" | null }) =>
      api.put(`/users/${userId}/access/${serverId}`, { level }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users", userId, "access"] }),
  });
}
