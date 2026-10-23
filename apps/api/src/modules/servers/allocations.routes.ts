import type { FastifyInstance } from "fastify";
import { createAllocationSchema } from "@minecraftpanel/shared";
import { AuditAction } from "../audit/audit.service.js";
import { ConflictError, NotFoundError } from "../../lib/errors.js";

/**
 * Extra ports a server publishes in addition to its fixed Server.port — see
 * the ServerAllocation model doc comment. Mounted at
 * /api/servers/:id/allocations (see modules/index.ts), so every handler
 * here runs behind requireServerAccess and has request.mcServer available.
 */
export async function allocationsRoutes(fastify: FastifyInstance) {
  fastify.post("/", { preHandler: fastify.requireServerAccess("servers.settings.edit") }, async (request, reply) => {
    const { port } = createAllocationSchema.parse(request.body);
    const server = request.mcServer!;

    const conflict = await fastify.serverManager.findPortConflict(port, { serverId: server.id });
    if (conflict) throw new ConflictError(conflict);

    const allocation = await fastify.prisma.serverAllocation.create({ data: { serverId: server.id, port } });

    await fastify.audit.record(AuditAction.SERVER_ALLOCATION_CREATE, {
      userId: request.user!.id,
      serverId: server.id,
      ipAddress: request.ip,
    }, { port });

    return reply.status(201).send({
      allocation: { id: allocation.id, port: allocation.port, createdAt: allocation.createdAt.toISOString() },
      restartRequired: server.status === "RUNNING",
    });
  });

  fastify.delete("/:allocationId", { preHandler: fastify.requireServerAccess("servers.settings.edit") }, async (request, reply) => {
    const { allocationId } = request.params as { allocationId: string };
    const server = request.mcServer!;

    const allocation = await fastify.prisma.serverAllocation.findUnique({ where: { id: allocationId } });
    if (!allocation || allocation.serverId !== server.id) {
      throw new NotFoundError("Allocation not found.");
    }

    await fastify.prisma.serverAllocation.delete({ where: { id: allocationId } });

    await fastify.audit.record(AuditAction.SERVER_ALLOCATION_DELETE, {
      userId: request.user!.id,
      serverId: server.id,
      ipAddress: request.ip,
    }, { port: allocation.port });

    return reply.send({ restartRequired: server.status === "RUNNING" });
  });
}
