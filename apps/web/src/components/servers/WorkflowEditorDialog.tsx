import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import cronstrue from "cronstrue";
import { Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import {
  createWorkflowSchema,
  SCHEDULER_STEP_TYPES,
  type ServerDto,
  type SchedulerStepType,
  type SchedulerWorkflowDto,
} from "@minecraftpanel/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api";
import { useCreateWorkflow, useUpdateWorkflow, useCronPreview } from "@/lib/scheduler";
import { formatInZone } from "@/lib/system";
import {
  buildDailyCron,
  buildEveryNHoursCron,
  buildTimesPerDayCron,
  buildWeeklyCron,
  parseTime,
  WEEKDAY_LABELS,
} from "@/lib/cronTemplates";

const STEP_TYPE_LABELS: Record<SchedulerStepType, string> = {
  COMMAND: "Run command",
  START: "Start server",
  STOP: "Stop server",
  RESTART: "Restart server",
  BACKUP: "Create backup",
};

const COMMAND_CHIPS = ["save-all", "say Server restarting soon", "stop"];

interface StepState {
  key: string;
  type: SchedulerStepType;
  payload: string;
  delayAfterSec: number;
}

let stepKeySeq = 0;
function newStepKey(): string {
  stepKeySeq += 1;
  return `step-${stepKeySeq}`;
}

function stepsFromWorkflow(workflow: SchedulerWorkflowDto | null): StepState[] {
  if (!workflow || workflow.steps.length === 0) {
    return [{ key: newStepKey(), type: "COMMAND", payload: "", delayAfterSec: 0 }];
  }
  return workflow.steps.map((s) => ({ key: newStepKey(), type: s.type, payload: s.payload ?? "", delayAfterSec: s.delayAfterSec }));
}

type SimpleKind = "daily" | "hours" | "timesPerDay" | "weekly";

export function WorkflowEditorDialog({
  server,
  workflow,
  open,
  onOpenChange,
}: {
  server: ServerDto;
  workflow: SchedulerWorkflowDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isEdit = workflow !== null;
  const createWorkflow = useCreateWorkflow(server.id);
  const updateWorkflow = useUpdateWorkflow(server.id);

  const [name, setName] = useState(workflow?.name ?? "");
  const [enabled, setEnabled] = useState(workflow?.enabled ?? true);
  const [steps, setSteps] = useState<StepState[]>(() => stepsFromWorkflow(workflow));

  const [scheduleTab, setScheduleTab] = useState<"simple" | "advanced">(isEdit ? "advanced" : "simple");
  const [cronExpr, setCronExpr] = useState(workflow?.cronExpr ?? buildDailyCron(4, 0));
  const [simpleKind, setSimpleKind] = useState<SimpleKind>("daily");
  const [dailyTime, setDailyTime] = useState("04:00");
  const [everyNHours, setEveryNHours] = useState(6);
  const [timesPerDayHours, setTimesPerDayHours] = useState<number[]>([6, 14, 22]);
  const [weeklyTime, setWeeklyTime] = useState("04:00");
  const [weeklyDays, setWeeklyDays] = useState<number[]>([0]);

  const [saving, setSaving] = useState(false);

  // Reset local state whenever a different workflow is opened (or the "create" dialog reopens).
  useEffect(() => {
    if (!open) return;
    setName(workflow?.name ?? "");
    setEnabled(workflow?.enabled ?? true);
    setSteps(stepsFromWorkflow(workflow));
    setScheduleTab(workflow ? "advanced" : "simple");
    setCronExpr(workflow?.cronExpr ?? buildDailyCron(4, 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workflow?.id]);

  useEffect(() => {
    if (scheduleTab !== "simple") return;
    if (simpleKind === "daily") {
      const { hour, minute } = parseTime(dailyTime);
      setCronExpr(buildDailyCron(hour, minute));
    } else if (simpleKind === "hours") {
      setCronExpr(buildEveryNHoursCron(everyNHours));
    } else if (simpleKind === "timesPerDay") {
      setCronExpr(buildTimesPerDayCron(timesPerDayHours));
    } else if (simpleKind === "weekly") {
      const { hour, minute } = parseTime(weeklyTime);
      setCronExpr(buildWeeklyCron(hour, minute, weeklyDays));
    }
  }, [scheduleTab, simpleKind, dailyTime, everyNHours, timesPerDayHours, weeklyTime, weeklyDays]);

  const [debouncedCron, setDebouncedCron] = useState(cronExpr);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedCron(cronExpr), 300);
    return () => clearTimeout(t);
  }, [cronExpr]);

  const preview = useCronPreview(server.id, debouncedCron);
  const description = useMemo(() => {
    try {
      return cronstrue.toString(debouncedCron, { verbose: false });
    } catch {
      return null;
    }
  }, [debouncedCron]);

  function updateStep(index: number, patch: Partial<StepState>) {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function addStep() {
    setSteps((prev) => [...prev, { key: newStepKey(), type: "COMMAND", payload: "", delayAfterSec: 0 }]);
  }

  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }

  function moveStep(index: number, dir: -1 | 1) {
    setSteps((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      const a = next[index]!;
      const b = next[target]!;
      next[index] = b;
      next[target] = a;
      return next;
    });
  }

  function toggleHour(hour: number) {
    setTimesPerDayHours((prev) => (prev.includes(hour) ? prev.filter((h) => h !== hour) : [...prev, hour].sort((a, b) => a - b)));
  }

  function toggleWeekday(day: number) {
    setWeeklyDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b)));
  }

  const canSubmit = name.trim().length > 0 && steps.length > 0 && steps.every((s) => s.type !== "COMMAND" || s.payload.trim().length > 0);

  async function handleSubmit() {
    const input = {
      name: name.trim(),
      cronExpr,
      enabled,
      steps: steps.map(({ type, payload, delayAfterSec }) => ({
        type,
        payload: payload.trim() ? payload.trim() : undefined,
        delayAfterSec,
      })),
    };
    const parsed = createWorkflowSchema.safeParse(input);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "That workflow isn't valid.");
      return;
    }

    setSaving(true);
    try {
      if (isEdit) {
        await updateWorkflow.mutateAsync({ workflowId: workflow!.id, input: parsed.data });
        toast.success("Workflow updated.");
      } else {
        await createWorkflow.mutateAsync(parsed.data);
        toast.success("Workflow created.");
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save workflow.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${workflow!.name}` : "New workflow"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="workflow-name">Name</Label>
              <Input id="workflow-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Nightly restart" />
            </div>
            <label className="flex items-center gap-2 pb-1.5 text-sm">
              <Switch checked={enabled} onCheckedChange={setEnabled} />
              Enabled
            </label>
          </div>

          <div className="space-y-2">
            <Label>Steps</Label>
            <div className="space-y-2">
              {steps.map((step, i) => (
                <div key={step.key} className="space-y-2 rounded-md border border-border p-3">
                  <div className="flex items-center gap-2">
                    <span className="w-4 shrink-0 text-xs text-muted-foreground">{i + 1}.</span>
                    <Select value={step.type} onValueChange={(v) => updateStep(i, { type: v as SchedulerStepType, payload: "" })}>
                      <SelectTrigger className="w-48">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SCHEDULER_STEP_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {STEP_TYPE_LABELS[t]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="ml-auto flex items-center gap-1">
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" disabled={i === 0} onClick={() => moveStep(i, -1)}>
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={i === steps.length - 1}
                        onClick={() => moveStep(i, 1)}
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        disabled={steps.length === 1}
                        onClick={() => removeStep(i)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {step.type === "COMMAND" && (
                    <div className="space-y-1.5">
                      <Input
                        placeholder="e.g. save-all"
                        value={step.payload}
                        onChange={(e) => updateStep(i, { payload: e.target.value })}
                      />
                      <div className="flex flex-wrap gap-1">
                        {COMMAND_CHIPS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => updateStep(i, { payload: c })}
                            className="rounded border border-border px-1.5 py-0.5 font-mono text-xs text-muted-foreground hover:bg-accent"
                          >
                            {c}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {step.type === "BACKUP" && (
                    <Input
                      placeholder="Optional backup note"
                      value={step.payload}
                      onChange={(e) => updateStep(i, { payload: e.target.value })}
                    />
                  )}

                  {i < steps.length - 1 && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>Then wait</span>
                      <Input
                        type="number"
                        min={0}
                        max={3600}
                        className="h-7 w-20"
                        value={step.delayAfterSec}
                        onChange={(e) => updateStep(i, { delayAfterSec: Math.max(0, Number(e.target.value) || 0) })}
                      />
                      <span>seconds before the next step</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={addStep}>
              <Plus className="h-3.5 w-3.5" /> Add step
            </Button>
          </div>

          <div className="space-y-2">
            <Label>Schedule</Label>
            <Tabs value={scheduleTab} onValueChange={(v) => setScheduleTab(v as "simple" | "advanced")}>
              <TabsList>
                <TabsTrigger value="simple">Simple</TabsTrigger>
                <TabsTrigger value="advanced">Advanced</TabsTrigger>
              </TabsList>

              <TabsContent value="simple" className="space-y-3">
                <Select value={simpleKind} onValueChange={(v) => setSimpleKind(v as SimpleKind)}>
                  <SelectTrigger className="w-64">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Every day at a time</SelectItem>
                    <SelectItem value="hours">Every N hours</SelectItem>
                    <SelectItem value="timesPerDay">Several times a day</SelectItem>
                    <SelectItem value="weekly">Specific days of the week</SelectItem>
                  </SelectContent>
                </Select>

                {simpleKind === "daily" && (
                  <Input type="time" className="w-32" value={dailyTime} onChange={(e) => setDailyTime(e.target.value)} />
                )}

                {simpleKind === "hours" && (
                  <div className="flex items-center gap-2 text-sm">
                    <span>Every</span>
                    <Input
                      type="number"
                      min={1}
                      max={23}
                      className="w-16"
                      value={everyNHours}
                      onChange={(e) => setEveryNHours(Math.min(23, Math.max(1, Number(e.target.value) || 1)))}
                    />
                    <span>hours</span>
                  </div>
                )}

                {simpleKind === "timesPerDay" && (
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground">On the hour, every hour selected:</p>
                    <div className="flex flex-wrap gap-1">
                      {Array.from({ length: 24 }, (_, h) => h).map((h) => (
                        <button
                          key={h}
                          type="button"
                          onClick={() => toggleHour(h)}
                          className={cn(
                            "h-7 w-10 rounded border text-xs",
                            timesPerDayHours.includes(h)
                              ? "border-primary bg-primary/15 text-primary"
                              : "border-border text-muted-foreground hover:bg-accent",
                          )}
                        >
                          {String(h).padStart(2, "0")}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {simpleKind === "weekly" && (
                  <div className="space-y-1.5">
                    <Input type="time" className="w-32" value={weeklyTime} onChange={(e) => setWeeklyTime(e.target.value)} />
                    <div className="flex flex-wrap gap-1">
                      {WEEKDAY_LABELS.map((label, day) => (
                        <button
                          key={label}
                          type="button"
                          onClick={() => toggleWeekday(day)}
                          className={cn(
                            "h-7 w-12 rounded border text-xs",
                            weeklyDays.includes(day)
                              ? "border-primary bg-primary/15 text-primary"
                              : "border-border text-muted-foreground hover:bg-accent",
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="advanced">
                <Input
                  className="font-mono"
                  placeholder="min hour day month weekday"
                  value={cronExpr}
                  onChange={(e) => setCronExpr(e.target.value)}
                />
                <p className="mt-1 text-xs text-muted-foreground">Standard 5-field cron: minute hour day-of-month month day-of-week.</p>
              </TabsContent>
            </Tabs>

            <div className="rounded-md border border-border bg-muted/30 p-2.5 text-xs">
              <p className={cn("font-medium", !description && "text-destructive")}>{description ?? "Invalid cron expression."}</p>
              {preview.data?.valid && preview.data.nextRuns.length > 0 && (
                <p className="mt-1 text-muted-foreground">
                  Next: {preview.data.nextRuns.map((r) => formatInZone(r, preview.data!.timezone)).join(" · ")}
                  <span className="block">Times are in the server's time zone ({preview.data.timezone}).</span>
                </p>
              )}
              {preview.data && !preview.data.valid && preview.data.error && (
                <p className="mt-1 text-destructive">{preview.data.error}</p>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || saving}>
            {saving ? "Saving..." : isEdit ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
