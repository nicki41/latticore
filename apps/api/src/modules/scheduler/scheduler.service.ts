import { CronExpressionParser } from "cron-parser";
import type { PrismaClient, Server, SchedulerStep as PrismaSchedulerStep } from "@prisma/client";
import type {
  CreateWorkflowInput,
  UpdateWorkflowInput,
  CronPreviewDto,
  SchedulerRunDto,
  SchedulerRunStatus,
  SchedulerRunStepLogEntry,
  SchedulerStepType,
  SchedulerWorkflowDto,
} from "@minecraftpanel/shared";
import { BadRequestError, ConflictError, NotFoundError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { env } from "../../config/env.js";
import type { MinecraftServerManager } from "../../minecraft/MinecraftServerManager.js";
import { BackupService } from "../backups/backups.service.js";
import { AuditAction, type AuditService } from "../audit/audit.service.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** How many past runs to keep per workflow — enough history to debug a flaky workflow, without an every-minute cron growing the table forever. */
const RUNS_KEPT_PER_WORKFLOW = 50;

/**
 * Cron expressions are evaluated in the panel's configured time zone (env.TZ
 * — the host's zone, not UTC), so "0 4 * * *" means 04:00 on the server's
 * clock, DST transitions included.
 */
function parseCron(cronExpr: string, currentDate: Date = new Date()) {
  return CronExpressionParser.parse(cronExpr, { currentDate, tz: env.TZ });
}

/** Next fire time strictly after `from`, or null if the expression is somehow no longer parseable (defensive — create/update already reject invalid expressions). */
function computeNextRun(cronExpr: string, from: Date = new Date()): Date | null {
  try {
    return parseCron(cronExpr, from).next().toDate();
  } catch {
    return null;
  }
}

type WorkflowWithSteps = {
  id: string;
  serverId: string;
  name: string;
  cronExpr: string;
  enabled: boolean;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  steps: PrismaSchedulerStep[];
  createdBy?: { username: string } | null;
};

/**
 * User-defined workflows: an ordered list of steps (console command / start /
 * stop / restart / create backup, each with an optional delay before the
 * next one runs) fired on a cron schedule. Executes both on a manual
 * "Run now" and from the ticking SchedulerPlugin — both paths funnel through
 * startExecution/executeSteps so there's exactly one re-entrancy guard.
 */
export class SchedulerService {
  /** Workflow ids currently executing, so a slow run (long delays between steps) never overlaps itself across ticks or a manual re-trigger. */
  private readonly runningWorkflowIds = new Set<string>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly serverManager: MinecraftServerManager,
    private readonly backupService: BackupService,
    private readonly audit: AuditService,
  ) {}

  async list(serverId: string): Promise<SchedulerWorkflowDto[]> {
    const workflows = await this.prisma.schedulerWorkflow.findMany({
      where: { serverId },
      orderBy: { createdAt: "asc" },
      include: { steps: { orderBy: { order: "asc" } }, createdBy: { select: { username: true } } },
    });
    return workflows.map((w) => this.serializeWorkflow(w));
  }

  async get(serverId: string, workflowId: string): Promise<SchedulerWorkflowDto> {
    return this.serializeWorkflow(await this.requireWorkflow(serverId, workflowId, true));
  }

  async create(server: Server, input: CreateWorkflowInput, createdById: string): Promise<SchedulerWorkflowDto> {
    const nextRunAt = this.requireValidCron(input.cronExpr);
    const workflow = await this.prisma.schedulerWorkflow.create({
      data: {
        serverId: server.id,
        name: input.name,
        cronExpr: input.cronExpr,
        enabled: input.enabled ?? true,
        createdById,
        nextRunAt,
        steps: {
          create: input.steps.map((step, index) => ({
            order: index,
            type: step.type,
            payload: step.payload ?? null,
            delayAfterSec: step.delayAfterSec ?? 0,
          })),
        },
      },
      include: { steps: { orderBy: { order: "asc" } }, createdBy: { select: { username: true } } },
    });
    return this.serializeWorkflow(workflow);
  }

  async update(server: Server, workflowId: string, input: UpdateWorkflowInput): Promise<SchedulerWorkflowDto> {
    const existing = await this.requireWorkflow(server.id, workflowId, false);
    const cronExpr = input.cronExpr ?? existing.cronExpr;
    const nextRunAt = this.requireValidCron(cronExpr);

    await this.prisma.$transaction(async (tx) => {
      await tx.schedulerWorkflow.update({
        where: { id: workflowId },
        data: { name: input.name, cronExpr, enabled: input.enabled, nextRunAt },
      });
      if (input.steps) {
        await tx.schedulerStep.deleteMany({ where: { workflowId } });
        await tx.schedulerStep.createMany({
          data: input.steps.map((step, index) => ({
            workflowId,
            order: index,
            type: step.type,
            payload: step.payload ?? null,
            delayAfterSec: step.delayAfterSec ?? 0,
          })),
        });
      }
    });

    return this.get(server.id, workflowId);
  }

  async delete(serverId: string, workflowId: string): Promise<void> {
    await this.requireWorkflow(serverId, workflowId, false);
    await this.prisma.schedulerWorkflow.delete({ where: { id: workflowId } });
  }

  async listRuns(serverId: string, workflowId: string, limit = 20): Promise<SchedulerRunDto[]> {
    await this.requireWorkflow(serverId, workflowId, false);
    const runs = await this.prisma.schedulerRun.findMany({
      where: { workflowId },
      orderBy: { startedAt: "desc" },
      take: limit,
    });
    return runs.map((r) => this.serializeRun(r));
  }

  previewCron(cronExpr: string, count = 3): CronPreviewDto {
    try {
      const interval = parseCron(cronExpr);
      const nextRuns: string[] = [];
      for (let i = 0; i < count; i++) nextRuns.push(interval.next().toDate().toISOString());
      return { valid: true, error: null, nextRuns, timezone: env.TZ };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : "Invalid cron expression.", nextRuns: [], timezone: env.TZ };
    }
  }

  async runNow(server: Server, workflowId: string): Promise<SchedulerRunDto> {
    const workflow = await this.requireWorkflow(server.id, workflowId, true);
    if (this.runningWorkflowIds.has(workflow.id)) {
      throw new ConflictError("This workflow is already running.");
    }
    return this.startExecution(server, workflow);
  }

  startTicking(intervalMs = 20_000): void {
    if (this.tickTimer) return;
    this.failInterruptedRuns().catch((err) => logger.error({ err }, "Failed to close out interrupted scheduler runs"));
    this.tickTimer = setInterval(() => {
      this.tick().catch((err) => logger.error({ err }, "Scheduler tick failed"));
    }, intervalMs);
    this.tickTimer.unref?.();
  }

  stopTicking(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  /** Called on every tick — fires every enabled workflow whose nextRunAt has passed and isn't already running. */
  private async tick(): Promise<void> {
    const due = await this.prisma.schedulerWorkflow.findMany({
      where: { enabled: true, nextRunAt: { lte: new Date() } },
      include: { steps: { orderBy: { order: "asc" } }, server: true },
    });
    for (const workflow of due) {
      if (this.runningWorkflowIds.has(workflow.id)) continue;
      this.startExecution(workflow.server, workflow).catch((err) => {
        logger.error({ err, workflowId: workflow.id }, "Scheduled workflow failed to start");
      });
    }
  }

  /** A run still RUNNING at boot belonged to the previous process — it will never finish, so record it as failed instead of leaving it "running" forever. */
  private async failInterruptedRuns(): Promise<void> {
    const { count } = await this.prisma.schedulerRun.updateMany({
      where: { status: "RUNNING" },
      data: { status: "FAILED", finishedAt: new Date(), log: JSON.stringify([{ stepId: null, type: null, ok: false, message: "Interrupted by a panel restart.", at: new Date().toISOString() }]) },
    });
    if (count) logger.info({ count }, "Marked scheduler runs interrupted by a restart as failed");
  }

  private async pruneRuns(workflowId: string): Promise<void> {
    const stale = await this.prisma.schedulerRun.findMany({
      where: { workflowId },
      orderBy: { startedAt: "desc" },
      skip: RUNS_KEPT_PER_WORKFLOW,
      select: { id: true },
    });
    if (stale.length) await this.prisma.schedulerRun.deleteMany({ where: { id: { in: stale.map((r) => r.id) } } });
  }

  private requireValidCron(cronExpr: string): Date {
    try {
      return parseCron(cronExpr).next().toDate();
    } catch (err) {
      throw new BadRequestError(`Invalid cron expression: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  private async requireWorkflow(serverId: string, workflowId: string, withCreatedBy: boolean): Promise<WorkflowWithSteps> {
    const workflow = await this.prisma.schedulerWorkflow.findUnique({
      where: { id: workflowId },
      include: {
        steps: { orderBy: { order: "asc" } },
        createdBy: withCreatedBy ? { select: { username: true } } : false,
      },
    });
    if (!workflow || workflow.serverId !== serverId) throw new NotFoundError("Workflow not found.");
    return workflow;
  }

  private async startExecution(server: Server, workflow: WorkflowWithSteps): Promise<SchedulerRunDto> {
    this.runningWorkflowIds.add(workflow.id);
    const run = await this.prisma.schedulerRun.create({
      data: { workflowId: workflow.id, status: "RUNNING" },
    });

    this.executeSteps(server, workflow, run.id).catch((err) => {
      logger.error({ err, workflowId: workflow.id, runId: run.id }, "Scheduler workflow execution crashed");
    });

    return {
      id: run.id,
      workflowId: workflow.id,
      startedAt: run.startedAt.toISOString(),
      finishedAt: null,
      status: "RUNNING",
      log: [],
    };
  }

  private async executeSteps(server: Server, workflow: WorkflowWithSteps, runId: string): Promise<void> {
    const log: SchedulerRunStepLogEntry[] = [];
    let ok = true;

    try {
      for (const step of workflow.steps) {
        const entry = await this.runStep(server, step, workflow.createdById);
        log.push(entry);
        if (!entry.ok) ok = false;
        if (step.delayAfterSec > 0) await sleep(step.delayAfterSec * 1000);
      }
    } finally {
      const status: SchedulerRunStatus = ok ? "SUCCESS" : "FAILED";
      await this.prisma.$transaction([
        this.prisma.schedulerRun.update({
          where: { id: runId },
          data: { finishedAt: new Date(), status, log: JSON.stringify(log) },
        }),
        this.prisma.schedulerWorkflow.update({
          where: { id: workflow.id },
          data: { lastRunAt: new Date(), nextRunAt: computeNextRun(workflow.cronExpr) },
        }),
      ]);
      this.runningWorkflowIds.delete(workflow.id);
      await this.pruneRuns(workflow.id).catch((err) => logger.warn({ err, workflowId: workflow.id }, "Failed to prune old scheduler runs"));
      await this.audit.record(
        AuditAction.SCHEDULER_RUN,
        { serverId: server.id, userId: workflow.createdById },
        { workflowId: workflow.id, workflowName: workflow.name, runId, status, stepCount: log.length },
      );
    }
  }

  private async runStep(
    server: Server,
    step: PrismaSchedulerStep,
    createdById: string | null,
  ): Promise<SchedulerRunStepLogEntry> {
    const at = new Date().toISOString();
    const type = step.type as SchedulerStepType;
    try {
      switch (type) {
        case "COMMAND": {
          if (!step.payload) throw new Error("Step has no command configured.");
          const output = await this.serverManager.sendCommand(server.id, step.payload, { silent: true });
          return { stepId: step.id, type, ok: true, message: output || null, at };
        }
        case "START":
          await this.serverManager.startServer(server.id);
          return { stepId: step.id, type, ok: true, message: null, at };
        case "STOP":
          await this.serverManager.stopServer(server.id);
          return { stepId: step.id, type, ok: true, message: null, at };
        case "RESTART":
          await this.serverManager.restartServer(server.id);
          return { stepId: step.id, type, ok: true, message: null, at };
        case "BACKUP": {
          const backup = await this.backupService.create(server, step.payload ?? undefined, createdById ?? undefined);
          return { stepId: step.id, type, ok: true, message: backup.fileName, at };
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, serverId: server.id, stepType: type }, "Scheduler step failed");
      return { stepId: step.id, type, ok: false, message, at };
    }
  }

  private serializeWorkflow(workflow: WorkflowWithSteps): SchedulerWorkflowDto {
    return {
      id: workflow.id,
      serverId: workflow.serverId,
      name: workflow.name,
      cronExpr: workflow.cronExpr,
      enabled: workflow.enabled,
      createdByUsername: workflow.createdBy?.username ?? null,
      createdAt: workflow.createdAt.toISOString(),
      updatedAt: workflow.updatedAt.toISOString(),
      lastRunAt: workflow.lastRunAt ? workflow.lastRunAt.toISOString() : null,
      nextRunAt: workflow.nextRunAt ? workflow.nextRunAt.toISOString() : null,
      steps: workflow.steps.map((s) => ({
        id: s.id,
        order: s.order,
        type: s.type as SchedulerStepType,
        payload: s.payload,
        delayAfterSec: s.delayAfterSec,
      })),
    };
  }

  private serializeRun(run: {
    id: string;
    workflowId: string;
    startedAt: Date;
    finishedAt: Date | null;
    status: string;
    log: string | null;
  }): SchedulerRunDto {
    return {
      id: run.id,
      workflowId: run.workflowId,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
      status: run.status as SchedulerRunStatus,
      log: run.log ? (JSON.parse(run.log) as SchedulerRunStepLogEntry[]) : [],
    };
  }
}
