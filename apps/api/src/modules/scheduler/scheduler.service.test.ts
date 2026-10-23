import { afterEach, describe, expect, it, vi } from "vitest";
import type { Server } from "@prisma/client";
import { SchedulerService } from "./scheduler.service.js";
import { ConflictError } from "../../lib/errors.js";

function makeServer(): Server {
   
  return { id: "srv-1", dataDir: "servers/srv-1" } as any as Server;
}

type FakeStep = { id: string; order: number; type: string; payload: string | null; delayAfterSec: number };

function makeWorkflow(steps: FakeStep[]) {
  return {
    id: "wf-1",
    serverId: "srv-1",
    name: "Test workflow",
    cronExpr: "*/5 * * * *",
    enabled: true,
    createdById: "user-1",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastRunAt: null as Date | null,
    nextRunAt: new Date(),
    steps,
  };
}

/**
 * Hand-rolled fake, same convention as players.service.test.ts — no mocking
 * library. `finished` resolves once the finally-block transaction in
 * executeSteps() runs, which is always the last thing a run does (success or
 * failure), so it's a reliable "the background run is done" signal for tests
 * to await instead of racing the un-awaited executeSteps() promise directly.
 */
function makeFakePrisma(workflow: ReturnType<typeof makeWorkflow>) {
  let resolveFinished!: () => void;
  const finished = new Promise<void>((resolve) => (resolveFinished = resolve));

   
  const prisma: any = {
    schedulerWorkflow: {
      findUnique: vi.fn(async () => workflow),
      update: vi.fn(async () => workflow),
    },
    schedulerRun: {
      create: vi.fn(async () => ({ id: "run-1", workflowId: workflow.id, startedAt: new Date(), status: "RUNNING" })),
      update: vi.fn(async (args: { data: unknown }) => ({ id: "run-1", ...(args.data as object) })),
    },
  };
  prisma.$transaction = vi.fn(async (arg: unknown) => {
    const result = typeof arg === "function" ? await (arg as (tx: unknown) => unknown)(prisma) : await Promise.all(arg as Promise<unknown>[]);
    resolveFinished();
    return result;
  });

  return { prisma, finished };
}

function makeFakeManager(overrides: Record<string, unknown> = {}) {
  return {
    sendCommand: vi.fn(async () => "ok"),
    startServer: vi.fn(async () => {}),
    stopServer: vi.fn(async () => {}),
    restartServer: vi.fn(async () => {}),
    ...overrides,
     
  } as any;
}

function makeFakeBackupService() {
   
  return { create: vi.fn(async () => ({ id: "b1", fileName: "backup.tar.gz" })) } as any;
}

function makeFakeAudit() {
   
  return { record: vi.fn(async () => {}) } as any;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("SchedulerService.runNow / executeSteps", () => {
  it("executes steps in order", async () => {
    const calls: string[] = [];
    const manager = makeFakeManager({
      sendCommand: vi.fn(async (_id: string, cmd: string) => {
        calls.push(`command:${cmd}`);
        return "ok";
      }),
      restartServer: vi.fn(async () => {
        calls.push("restart");
      }),
    });
    const workflow = makeWorkflow([
      { id: "s1", order: 0, type: "COMMAND", payload: "save-all", delayAfterSec: 0 },
      { id: "s2", order: 1, type: "RESTART", payload: null, delayAfterSec: 0 },
    ]);
    const { prisma, finished } = makeFakePrisma(workflow);
    const service = new SchedulerService(prisma, manager, makeFakeBackupService(), makeFakeAudit());

    await service.runNow(makeServer(), "wf-1");
    await finished;

    expect(calls).toEqual(["command:save-all", "restart"]);
  });

  it("waits delayAfterSec before running the next step", async () => {
    vi.useFakeTimers();
    const manager = makeFakeManager();
    const workflow = makeWorkflow([
      { id: "s1", order: 0, type: "COMMAND", payload: "save-all", delayAfterSec: 5 },
      { id: "s2", order: 1, type: "RESTART", payload: null, delayAfterSec: 0 },
    ]);
    const { prisma, finished } = makeFakePrisma(workflow);
    const service = new SchedulerService(prisma, manager, makeFakeBackupService(), makeFakeAudit());

    await service.runNow(makeServer(), "wf-1");
    await vi.advanceTimersByTimeAsync(0); // let the first step's microtasks settle and its sleep(5000) get scheduled

    expect(manager.sendCommand).toHaveBeenCalledTimes(1);
    expect(manager.restartServer).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(4999);
    expect(manager.restartServer).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await finished;
    expect(manager.restartServer).toHaveBeenCalledTimes(1);
  });

  it("keeps running later steps after an earlier one fails, and marks the run FAILED", async () => {
    const manager = makeFakeManager({
      sendCommand: vi.fn(async () => {
        throw new Error("server not running");
      }),
    });
    const workflow = makeWorkflow([
      { id: "s1", order: 0, type: "COMMAND", payload: "save-all", delayAfterSec: 0 },
      { id: "s2", order: 1, type: "RESTART", payload: null, delayAfterSec: 0 },
    ]);
    const { prisma, finished } = makeFakePrisma(workflow);
    const service = new SchedulerService(prisma, manager, makeFakeBackupService(), makeFakeAudit());

    await service.runNow(makeServer(), "wf-1");
    await finished;

    expect(manager.restartServer).toHaveBeenCalledTimes(1);
    const updateCall = prisma.schedulerRun.update.mock.calls[0][0];
    expect(updateCall.data.status).toBe("FAILED");
    const log = JSON.parse(updateCall.data.log);
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ type: "COMMAND", ok: false });
    expect(log[1]).toMatchObject({ type: "RESTART", ok: true });
  });

  it("rejects a second run while one is already in progress", async () => {
    vi.useFakeTimers();
    const manager = makeFakeManager();
    const workflow = makeWorkflow([{ id: "s1", order: 0, type: "RESTART", payload: null, delayAfterSec: 10 }]);
    const { prisma, finished } = makeFakePrisma(workflow);
    const service = new SchedulerService(prisma, manager, makeFakeBackupService(), makeFakeAudit());

    await service.runNow(makeServer(), "wf-1");
    await expect(service.runNow(makeServer(), "wf-1")).rejects.toBeInstanceOf(ConflictError);

    await vi.advanceTimersByTimeAsync(10_000);
    await finished;
  });
});
