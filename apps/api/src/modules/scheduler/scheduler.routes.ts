import type { FastifyInstance } from "fastify";
import { createWorkflowSchema, updateWorkflowSchema } from "@latticore/shared";
import { z } from "zod";
import { AuditAction } from "../audit/audit.service.js";

const cronPreviewSchema = z.object({ cronExpr: z.string().trim().min(1) });

export async function schedulerRoutes(fastify: FastifyInstance) {
  fastify.get("/", { preHandler: fastify.requireServerAccess("scheduler.view") }, async (request, reply) => {
    const workflows = await fastify.schedulerService.list(request.mcServer!.id);
    return reply.send({ workflows });
  });

  fastify.get("/:workflowId", { preHandler: fastify.requireServerAccess("scheduler.view") }, async (request, reply) => {
    const { workflowId } = request.params as { workflowId: string };
    const workflow = await fastify.schedulerService.get(request.mcServer!.id, workflowId);
    return reply.send({ workflow });
  });

  fastify.get(
    "/:workflowId/runs",
    { preHandler: fastify.requireServerAccess("scheduler.view") },
    async (request, reply) => {
      const { workflowId } = request.params as { workflowId: string };
      const runs = await fastify.schedulerService.listRuns(request.mcServer!.id, workflowId);
      return reply.send({ runs });
    },
  );

  fastify.post("/cron/preview", { preHandler: fastify.requireServerAccess("scheduler.view") }, async (request, reply) => {
    const { cronExpr } = cronPreviewSchema.parse(request.body ?? {});
    return reply.send(fastify.schedulerService.previewCron(cronExpr));
  });

  fastify.post("/", { preHandler: fastify.requireServerAccess("scheduler.manage") }, async (request, reply) => {
    const input = createWorkflowSchema.parse(request.body ?? {});
    const workflow = await fastify.schedulerService.create(request.mcServer!, input, request.user!.id);

    await fastify.audit.record(
      AuditAction.SCHEDULER_WORKFLOW_CREATE,
      { userId: request.user!.id, serverId: request.mcServer!.id, ipAddress: request.ip },
      { workflowId: workflow.id, name: workflow.name },
    );
    return reply.status(201).send({ workflow });
  });

  fastify.patch("/:workflowId", { preHandler: fastify.requireServerAccess("scheduler.manage") }, async (request, reply) => {
    const { workflowId } = request.params as { workflowId: string };
    const input = updateWorkflowSchema.parse(request.body ?? {});
    const workflow = await fastify.schedulerService.update(request.mcServer!, workflowId, input);

    await fastify.audit.record(
      AuditAction.SCHEDULER_WORKFLOW_UPDATE,
      { userId: request.user!.id, serverId: request.mcServer!.id, ipAddress: request.ip },
      { workflowId },
    );
    return reply.send({ workflow });
  });

  fastify.delete(
    "/:workflowId",
    { preHandler: fastify.requireServerAccess("scheduler.manage") },
    async (request, reply) => {
      const { workflowId } = request.params as { workflowId: string };
      await fastify.schedulerService.delete(request.mcServer!.id, workflowId);

      await fastify.audit.record(
        AuditAction.SCHEDULER_WORKFLOW_DELETE,
        { userId: request.user!.id, serverId: request.mcServer!.id, ipAddress: request.ip },
        { workflowId },
      );
      return reply.status(204).send();
    },
  );

  fastify.post(
    "/:workflowId/run",
    { preHandler: fastify.requireServerAccess("scheduler.manage") },
    async (request, reply) => {
      const { workflowId } = request.params as { workflowId: string };
      const run = await fastify.schedulerService.runNow(request.mcServer!, workflowId);
      return reply.status(202).send({ run });
    },
  );
}
