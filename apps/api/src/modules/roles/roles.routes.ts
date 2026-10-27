import type { FastifyInstance } from "fastify";
import { createRoleSchema, updateRoleSchema } from "@latticore/shared";
import { RoleService } from "./roles.service.js";
import { AuditAction } from "../audit/audit.service.js";

export async function rolesRoutes(fastify: FastifyInstance) {
  const roleService = new RoleService(fastify.prisma);

  fastify.get("/", { preHandler: fastify.requirePermission("roles.view") }, async (_request, reply) => {
    const roles = await roleService.list();
    return reply.send({ roles });
  });

  fastify.post("/", { preHandler: fastify.requirePermission("roles.manage") }, async (request, reply) => {
    const input = createRoleSchema.parse(request.body);
    const role = await roleService.create(input, { isOwner: request.user!.isOwner, permissions: request.user!.permissions });
    await fastify.audit.record(AuditAction.ROLE_CREATE, { userId: request.user!.id, ipAddress: request.ip }, { roleId: role.id, name: role.name });
    return reply.status(201).send({ role });
  });

  fastify.patch("/:id", { preHandler: fastify.requirePermission("roles.manage") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = updateRoleSchema.parse(request.body);
    const role = await roleService.update(id, input, { isOwner: request.user!.isOwner, permissions: request.user!.permissions });
    await fastify.audit.record(AuditAction.ROLE_UPDATE, { userId: request.user!.id, ipAddress: request.ip }, { roleId: id, ...input });
    return reply.send({ role });
  });

  fastify.delete("/:id", { preHandler: fastify.requirePermission("roles.manage") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await roleService.delete(id);
    await fastify.audit.record(AuditAction.ROLE_DELETE, { userId: request.user!.id, ipAddress: request.ip }, { roleId: id });
    return reply.status(204).send();
  });
}
