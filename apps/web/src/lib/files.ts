import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { FileContentDto, FileEntryDto } from "@latticore/shared";
import { api, ApiError } from "./api";

export function useFileList(serverId: string, dirPath: string) {
  return useQuery({
    queryKey: ["servers", serverId, "files", "list", dirPath],
    queryFn: () => api.get<{ path: string; entries: FileEntryDto[] }>(`/servers/${serverId}/files?path=${encodeURIComponent(dirPath)}`),
  });
}

export function useFileContent(serverId: string, filePath: string | null) {
  return useQuery({
    queryKey: ["servers", serverId, "files", "content", filePath],
    queryFn: () => api.get<FileContentDto>(`/servers/${serverId}/files/content?path=${encodeURIComponent(filePath!)}`),
    enabled: Boolean(filePath),
    retry: false,
  });
}

export function useFileSearch(serverId: string, dirPath: string, query: string) {
  return useQuery({
    queryKey: ["servers", serverId, "files", "search", dirPath, query],
    queryFn: () =>
      api.get<{ entries: FileEntryDto[] }>(
        `/servers/${serverId}/files/search?path=${encodeURIComponent(dirPath)}&query=${encodeURIComponent(query)}`,
      ),
    enabled: query.trim().length > 0,
  });
}

function invalidateList(qc: QueryClient, serverId: string) {
  qc.invalidateQueries({ queryKey: ["servers", serverId, "files", "list"] });
}

export function useCreateEntry(serverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { path: string; type: "file" | "directory" }) => api.post(`/servers/${serverId}/files/create`, input),
    onSuccess: () => invalidateList(qc, serverId),
  });
}

export function useDeleteEntry(serverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => api.delete(`/servers/${serverId}/files?path=${encodeURIComponent(path)}`),
    onSuccess: () => invalidateList(qc, serverId),
  });
}

export function useMoveEntry(serverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { from: string; to: string }) => api.post(`/servers/${serverId}/files/move`, input),
    onSuccess: () => invalidateList(qc, serverId),
  });
}

export function useCopyEntry(serverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { from: string; to: string }) => api.post(`/servers/${serverId}/files/copy`, input),
    onSuccess: () => invalidateList(qc, serverId),
  });
}

export function useExtractZip(serverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { path: string; destination?: string }) => api.post(`/servers/${serverId}/files/extract`, input),
    onSuccess: () => invalidateList(qc, serverId),
  });
}

export function useSaveFileContent(serverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, content }: { path: string; content: string }) =>
      api.put<FileContentDto>(`/servers/${serverId}/files/content?path=${encodeURIComponent(path)}`, { content }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["servers", serverId, "files", "content", variables.path] });
      invalidateList(qc, serverId);
    },
  });
}

export async function uploadFiles(serverId: string, destDir: string, files: FileList | File[]): Promise<{ uploaded: number }> {
  const formData = new FormData();
  for (const file of Array.from(files)) formData.append("files", file, file.name);

  const res = await api.raw(`/servers/${serverId}/files/upload?path=${encodeURIComponent(destDir)}`, {
    method: "POST",
    body: formData,
  });

  const contentType = res.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await res.json() : undefined;
  if (!res.ok) {
    if (payload?.error) throw new ApiError(res.status, payload);
    throw new ApiError(res.status, { error: { code: "INTERNAL_ERROR", message: "Upload failed." } });
  }
  return payload as { uploaded: number };
}

export function downloadFileUrl(serverId: string, filePath: string): string {
  return `/api/servers/${serverId}/files/download?path=${encodeURIComponent(filePath)}`;
}
