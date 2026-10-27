import { useState } from "react";
import { toast } from "sonner";
import type { ServerStatus, UpdateServerSettingsInput } from "@latticore/shared";
import { ApiError } from "@/lib/api";
import { useServerAction, useUpdateServerSettings } from "@/lib/servers";

/**
 * memoryMb/cpuCores are baked into the container's Docker HostConfig at
 * (re)creation — see DockerMinecraftRuntime.createContainer and
 * MinecraftServerManager.restartServer's container-recreation note — so
 * changing them has no effect on an already-running container until
 * restart. `name`/`description`/`diskLimitMb` are pure DB metadata/soft
 * limits and deliberately excluded (diskLimitMb isn't Docker-enforced, see
 * the create-wizard's own hint text).
 */
export const RESTART_REQUIRED_FIELDS = new Set<keyof UpdateServerSettingsInput>(["memoryMb", "cpuCores"]);

/**
 * Shared save flow for every Settings tab: saves are always independent
 * per-tab (no single form spanning the whole page), and any tab whose dirty
 * fields overlap RESTART_REQUIRED_FIELDS pauses on a live server to ask the
 * user how to proceed instead of silently saving something that won't take
 * effect until a restart they didn't ask for.
 */
export function useRestartAwareSettings(serverId: string, serverStatus: ServerStatus) {
  const update = useUpdateServerSettings(serverId);
  const restart = useServerAction(serverId, "restart");
  const [pendingSave, setPendingSave] = useState<UpdateServerSettingsInput | null>(null);

  async function performSave(data: UpdateServerSettingsInput, successMessage: string): Promise<boolean> {
    try {
      await update.mutateAsync(data);
      toast.success(successMessage);
      return true;
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save settings.");
      return false;
    }
  }

  /** Call from a section's onSubmit with only that section's (already partial) dirty data. */
  function requestSave(data: UpdateServerSettingsInput, dirtyKeys: string[]) {
    const touchesRestartField = dirtyKeys.some((k) => RESTART_REQUIRED_FIELDS.has(k as keyof UpdateServerSettingsInput));
    if (touchesRestartField && serverStatus === "RUNNING") {
      setPendingSave(data);
      return;
    }
    void performSave(data, "Settings saved.");
  }

  async function confirmRestartNow() {
    if (!pendingSave) return;
    const data = pendingSave;
    setPendingSave(null);
    const saved = await performSave(data, "Settings saved. Restarting server...");
    if (!saved) return;
    try {
      await restart.mutateAsync();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to restart server.");
    }
  }

  async function confirmSaveLater() {
    if (!pendingSave) return;
    const data = pendingSave;
    setPendingSave(null);
    await performSave(data, "Settings saved. They'll apply the next time the server restarts.");
  }

  function cancelPendingSave() {
    setPendingSave(null);
  }

  return {
    requestSave,
    pendingSave,
    confirmRestartNow,
    confirmSaveLater,
    cancelPendingSave,
    saving: update.isPending || restart.isPending,
  };
}
