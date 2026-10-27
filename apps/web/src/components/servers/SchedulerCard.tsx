import { useState } from "react";
import { toast } from "sonner";
import cronstrue from "cronstrue";
import { formatDistanceToNow } from "date-fns";
import { CalendarClock, History, Pencil, Play, Trash2 } from "lucide-react";
import type { ServerDto, SchedulerWorkflowDto } from "@latticore/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { useWorkflows, useUpdateWorkflow, useDeleteWorkflow, useRunWorkflowNow, useWorkflowRuns } from "@/lib/scheduler";
import { formatInZone, useSystemInfo } from "@/lib/system";
import { WorkflowEditorDialog } from "./WorkflowEditorDialog";

const RUN_STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  RUNNING: "secondary",
  SUCCESS: "default",
  FAILED: "destructive",
};

function describeCron(cronExpr: string): string {
  try {
    return cronstrue.toString(cronExpr, { verbose: false });
  } catch {
    return cronExpr;
  }
}

function WorkflowRunHistory({ serverId, workflowId }: { serverId: string; workflowId: string }) {
  const { data, isLoading } = useWorkflowRuns(serverId, workflowId);
  if (isLoading) return <Skeleton className="h-8 w-full" />;
  if (!data?.runs.length) return <p className="text-xs text-muted-foreground">No runs yet.</p>;
  return (
    <div className="space-y-1.5">
      {data.runs.map((run) => {
        const failed = run.log.filter((l) => !l.ok).length;
        return (
          <div key={run.id} className="flex items-center gap-2 text-xs">
            <Badge variant={RUN_STATUS_VARIANT[run.status] ?? "secondary"}>{run.status}</Badge>
            <span className="text-muted-foreground">{formatDistanceToNow(new Date(run.startedAt), { addSuffix: true })}</span>
            <span className="ml-auto truncate text-muted-foreground">
              {failed > 0 ? `${failed}/${run.log.length} step(s) failed` : `${run.log.length} step(s) ok`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function SchedulerCard({ server }: { server: ServerDto }) {
  const { hasPermission } = useAuth();
  const { data, isLoading } = useWorkflows(server.id);
  const updateWorkflow = useUpdateWorkflow(server.id);
  const deleteWorkflow = useDeleteWorkflow(server.id);
  const runNow = useRunWorkflowNow(server.id);
  const timezone = useSystemInfo().data?.timezone;

  const [editorWorkflow, setEditorWorkflow] = useState<SchedulerWorkflowDto | null | undefined>(undefined);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const canManage = hasPermission("scheduler.manage") && server.myAccessLevel === "FULL";

  async function toggleEnabled(workflow: SchedulerWorkflowDto, enabledValue: boolean) {
    try {
      await updateWorkflow.mutateAsync({ workflowId: workflow.id, input: { enabled: enabledValue } });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update workflow.");
    }
  }

  async function handleDelete(workflow: SchedulerWorkflowDto) {
    try {
      await deleteWorkflow.mutateAsync(workflow.id);
      toast.success("Workflow deleted.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete workflow.");
    }
  }

  async function handleRunNow(workflow: SchedulerWorkflowDto) {
    try {
      await runNow.mutateAsync(workflow.id);
      toast.success(`Running "${workflow.name}" now.`);
      setExpandedId(workflow.id);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to run workflow.");
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Scheduler</CardTitle>
          <CardDescription>
            Automate console commands and server actions on a recurring schedule.
            {timezone && <> Schedules run on the server's clock ({timezone}).</>}
          </CardDescription>
        </div>
        {canManage && (
          <Button size="sm" onClick={() => setEditorWorkflow(null)}>
            <CalendarClock className="h-3.5 w-3.5" /> New Workflow
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isLoading && <Skeleton className="h-16 w-full" />}
        {!isLoading && (data?.workflows.length ?? 0) === 0 && (
          <p className="text-sm text-muted-foreground">No workflows yet. Create one to automate backups, restarts, or console commands.</p>
        )}
        {!isLoading && (data?.workflows.length ?? 0) > 0 && (
          <div className="divide-y divide-border">
            {data!.workflows.map((workflow) => (
              <div key={workflow.id} className="space-y-2 py-3">
                <div className="flex items-center gap-3">
                  <Switch checked={workflow.enabled} onCheckedChange={(v) => toggleEnabled(workflow, v)} disabled={!canManage} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{workflow.name}</p>
                    <p
                      className="truncate text-xs text-muted-foreground"
                      title={workflow.nextRunAt && workflow.enabled ? `Next run: ${formatInZone(workflow.nextRunAt, timezone)}${timezone ? ` (${timezone})` : ""}` : undefined}
                    >
                      {describeCron(workflow.cronExpr)} · {workflow.steps.length} step{workflow.steps.length === 1 ? "" : "s"}
                      {workflow.nextRunAt && workflow.enabled
                        ? ` · next ${formatDistanceToNow(new Date(workflow.nextRunAt), { addSuffix: true })}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setExpandedId(expandedId === workflow.id ? null : workflow.id)}
                      title="Run history"
                    >
                      <History className="h-3.5 w-3.5" />
                    </Button>
                    {canManage && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleRunNow(workflow)}
                          disabled={runNow.isPending}
                          title="Run now"
                        >
                          <Play className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditorWorkflow(workflow)} title="Edit">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" title="Delete">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete {workflow.name}?</AlertDialogTitle>
                              <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction variant="destructive" onClick={() => handleDelete(workflow)}>
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </>
                    )}
                  </div>
                </div>
                {expandedId === workflow.id && (
                  <div className="ml-11 rounded-md border border-border bg-muted/30 p-2">
                    <WorkflowRunHistory serverId={server.id} workflowId={workflow.id} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {editorWorkflow !== undefined && (
        <WorkflowEditorDialog
          server={server}
          workflow={editorWorkflow}
          open={editorWorkflow !== undefined}
          onOpenChange={(v) => !v && setEditorWorkflow(undefined)}
        />
      )}
    </Card>
  );
}
