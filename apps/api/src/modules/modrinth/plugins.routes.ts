import type { FastifyInstance } from "fastify";
import { installModrinthVersionSchema } from "@latticore/shared";
import { ModrinthService } from "./modrinth.service.js";
import { AuditAction } from "../audit/audit.service.js";
import { NotFoundError } from "../../lib/errors.js";

export async function pluginsRoutes(fastify: FastifyInstance) {
  const modrinthService = new ModrinthService(fastify.prisma);

  fastify.get("/", { preHandler: fastify.requireServerAccess("plugins.view") }, async (request, reply) => {
    const installed = await modrinthService.listInstalled(request.mcServer!);
    return reply.send({ installed });
  });

  fastify.post("/install", { preHandler: fastify.requireServerAccess("plugins.install") }, async (request, reply) => {
    const input = installModrinthVersionSchema.parse(request.body);
    const server = request.mcServer!;

    const version = await modrinthService.modrinth.getVersion(input.versionId).catch(() => {
      throw new NotFoundError("Modrinth version not found.");
    });

    const result = await modrinthService.install(server, version, input.author);

    await fastify.audit.record(
      AuditAction.PLUGIN_INSTALL,
      { userId: request.user!.id, serverId: server.id, ipAddress: request.ip },
      { projectId: version.project_id, versionId: version.id, filename: result.filename },
    );

    if (input.restart && server.status === "RUNNING") {
      await fastify.serverManager.restartServer(server.id);
    }

    return reply.status(201).send(result);
  });

  fastify.delete("/:filename", { preHandler: fastify.requireServerAccess("plugins.remove") }, async (request, reply) => {
    const { filename } = request.params as { filename: string };
    const server = request.mcServer!;

    await modrinthService.remove(server, decodeURIComponent(filename));

    await fastify.audit.record(
      AuditAction.PLUGIN_REMOVE,
      { userId: request.user!.id, serverId: server.id, ipAddress: request.ip },
      { filename },
    );
    return reply.status(204).send();
  });

  fastify.post("/:filename/pause", { preHandler: fastify.requireServerAccess("plugins.install") }, async (request, reply) => {
    const { filename } = request.params as { filename: string };
    const server = request.mcServer!;

    const result = await modrinthService.pause(server, decodeURIComponent(filename));

    await fastify.audit.record(
      AuditAction.PLUGIN_PAUSE,
      { userId: request.user!.id, serverId: server.id, ipAddress: request.ip },
      { filename, pausedFilename: result.filename },
    );
    return reply.send(result);
  });

  fastify.post("/:filename/resume", { preHandler: fastify.requireServerAccess("plugins.install") }, async (request, reply) => {
    const { filename } = request.params as { filename: string };
    const server = request.mcServer!;

    const result = await modrinthService.resume(server, decodeURIComponent(filename));

    await fastify.audit.record(
      AuditAction.PLUGIN_RESUME,
      { userId: request.user!.id, serverId: server.id, ipAddress: request.ip },
      { filename, resumedFilename: result.filename },
    );
    return reply.send(result);
  });
}
