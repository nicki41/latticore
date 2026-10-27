import type { ServerStatus } from "@latticore/shared";
import { cn } from "@/lib/utils";

const STATUS_CONFIG: Record<ServerStatus, { label: string; color: string; pulse?: boolean }> = {
  RUNNING: { label: "Online", color: "bg-status-online" },
  STARTING: { label: "Starting", color: "bg-status-starting", pulse: true },
  CREATING: { label: "Creating", color: "bg-status-starting", pulse: true },
  INSTALLING: { label: "Installing", color: "bg-status-starting", pulse: true },
  STOPPING: { label: "Stopping", color: "bg-status-stopping", pulse: true },
  DELETING: { label: "Deleting", color: "bg-status-stopping", pulse: true },
  STOPPED: { label: "Offline", color: "bg-status-offline" },
  ERROR: { label: "Error", color: "bg-status-error" },
};

export function StatusDot({ status, className }: { status: ServerStatus; className?: string }) {
  const config = STATUS_CONFIG[status];
  return <span className={cn("inline-block h-2 w-2 shrink-0 rounded-full", config.color, config.pulse && "animate-pulse", className)} />;
}

export function StatusLabel({ status, className }: { status: ServerStatus; className?: string }) {
  const config = STATUS_CONFIG[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm font-medium", className)}>
      <StatusDot status={status} />
      {config.label}
    </span>
  );
}

export function statusLabelText(status: ServerStatus): string {
  return STATUS_CONFIG[status].label;
}
