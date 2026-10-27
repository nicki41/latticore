import type { FastifyInstance } from "fastify";
import { addNetworkBackendSchema, reorderNetworkSchema } from "@latticore/shared";
import { AuditAction } from "../audit/audit.service.js";

/**
 * A proxy's network — mounted at /api/servers/:id/network, so every handler
 * runs behind requireServerAccess on the proxy. Changing the network also
 * reconfigures the backend; NetworkService checks the viewer may edit that
 * server too.
 */
export async function networkRoutes(fastify: FastifyInstance) {
  const service = fastify.networkService;

  fastify.get("/", { preHandler: fastify.requireServerAccess("servers.view") }, async (request, reply) => {
    return reply.send({ network: await service.getNetwork(request.mcServer!, request.user!) });
  });

  fastify.get("/candidates", { preHandler: fastify.requireServerAccess("servers.settings.edit") }, async (request, reply) => {
    return reply.send({ candidates: await service.listCandidates(request.mcServer!, request.user!) });
  });

  fastify.post("/backends", { preHandler: fastify.requireServerAccess("servers.settings.edit") }, async (request, reply) => {
    const input = addNetworkBackendSchema.parse(request.body);
    const result = await service.addBackend(request.mcServer!, input, request.user!);
    await fastify.audit.record(
      AuditAction.NETWORK_BACKEND_ADD,
      { userId: request.user!.id, serverId: request.mcServer!.id, ipAddress: request.ip },
      { backendServerId: input.serverId, name: result.network.backends.find((b) => b.server?.id === input.serverId)?.name },
    );
    return reply.status(201).send(result);
  });

  fastify.delete("/backends/:memberId", { preHandler: fastify.requireServerAccess("servers.settings.edit") }, async (request, reply) => {
    const { memberId } = request.params as { memberId: string };
    const result = await service.removeBackend(request.mcServer!, memberId, request.user!);
    await fastify.audit.record(AuditAction.NETWORK_BACKEND_REMOVE, { userId: request.user!.id, serverId: request.mcServer!.id, ipAddress: request.ip }, { memberId });
    return reply.send(result);
  });

  fastify.put("/order", { preHandler: fastify.requireServerAccess("servers.settings.edit") }, async (request, reply) => {
    const { memberIds } = reorderNetworkSchema.parse(request.body);
    const result = await service.reorder(request.mcServer!, memberIds, request.user!);
    await fastify.audit.record(AuditAction.NETWORK_REORDER, { userId: request.user!.id, serverId: request.mcServer!.id, ipAddress: request.ip }, { memberIds });
    return reply.send(result);
  });
}
