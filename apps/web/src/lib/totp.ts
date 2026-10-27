import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { EnableTotpInput } from "@latticore/shared";
import { api } from "./api";

interface TotpSetupResult {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

export function useSetupTotp() {
  return useMutation({
    mutationFn: () => api.post<TotpSetupResult>("/auth/totp/setup"),
  });
}

export function useEnableTotp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EnableTotpInput) => api.post<{ recoveryCodes: string[] }>("/auth/totp/enable", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth", "me"] }),
  });
}

export function useDisableTotp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (password: string) => api.post<void>("/auth/totp/disable", { password }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth", "me"] }),
  });
}
