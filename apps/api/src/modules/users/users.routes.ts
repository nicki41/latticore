import type { FastifyInstance } from "fastify";
import { createUserSchema, updateUserSchema, setServerAccessSchema, type AccessLevel, type ServerAccessGrantDto } from "@latticore/shared";
import { UserService } from "./users.service.js";
import { AuditAction } from "../audit/audit.service.js";
import { NotFoundError } from "../../lib/errors.js";

export async function usersRoutes(fastify: FastifyInstance) {
  const userService = new UserService(fastify.prisma);

  fastify.get("/", { preHandler: fastify.requirePermission("users.view") }, async (_request, reply) => {
    const users = await userService.list();
    return reply.send({ users });
  });

  fastify.post("/", { preHandler: fastify.requirePermission("users.create") }, async (request, reply) => {
    const input = createUserSchema.parse(request.body);
    const user = await userService.create(input, request.user!.isOwner);
    await fastify.audit.record(AuditAction.USER_CREATE, { userId: request.user!.id, ipAddress: request.ip }, { targetUserId: user.id, username: user.username });
    return reply.status(201).send({ user });
  });

  fastify.get("/:id", { preHandler: fastify.requirePermission("users.view") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = await userService.get(id);
    return reply.send({ user });
  });

  fastify.patch("/:id", { preHandler: fastify.requirePermission("users.edit") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = updateUserSchema.parse(request.body);
    const user = await userService.update(id, input, request.user!.id, request.user!.isOwner);
    await fastify.audit.record(AuditAction.USER_UPDATE, { userId: request.user!.id, ipAddress: request.ip }, { targetUserId: id, ...input });
    return reply.send({ user });
  });

  fastify.delete("/:id", { preHandler: fastify.requirePermission("users.delete") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await userService.delete(id, request.user!.id);
    await fastify.audit.record(AuditAction.USER_DELETE, { userId: request.user!.id, ipAddress: request.ip }, { targetUserId: id });
    return reply.status(204).send();
  });

  fastify.get("/:id/access", { preHandler: fastify.requirePermission("users.view") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const grants = await fastify.prisma.serverAccess.findMany({
      where: { userId: id },
      include: { server: { select: { id: true, name: true } } },
    });
    const servers = await fastify.prisma.server.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
    const byServerId = new Map(grants.map((g) => [g.serverId, g.level]));

    const access: ServerAccessGrantDto[] = servers
      .filter((s) => byServerId.has(s.id))
      .map((s) => ({ serverId: s.id, serverName: s.name, level: byServerId.get(s.id) as AccessLevel }));

    return reply.send({ access, allServers: servers });
  });

  fastify.put("/:id/access/:serverId", { preHandler: fastify.requirePermission("users.edit") }, async (request, reply) => {
    const { id, serverId } = request.params as { id: string; serverId: string };
    const { level } = setServerAccessSchema.parse(request.body);

    const server = await fastify.prisma.server.findUnique({ where: { id: serverId } });
    if (!server) throw new NotFoundError("Server not found.");

    if (level === null) {
      await fastify.prisma.serverAccess.deleteMany({ where: { userId: id, serverId } });
    } else {
      await fastify.prisma.serverAccess.upsert({
        where: { userId_serverId: { userId: id, serverId } },
        update: { level },
        create: { userId: id, serverId, level },
      });
    }

    await fastify.audit.record(
      AuditAction.USER_UPDATE,
      { userId: request.user!.id, serverId, ipAddress: request.ip },
      { targetUserId: id, accessLevel: level },
    );
    return reply.status(204).send();
  });
}
