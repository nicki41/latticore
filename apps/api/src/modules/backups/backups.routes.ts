import fs from "node:fs";
import type { FastifyInstance } from "fastify";
import { backupSettingsSchema, createBackupSchema, updateBackupSchema } from "@minecraftpanel/shared";
import { AuditAction } from "../audit/audit.service.js";

export async function backupsRoutes(fastify: FastifyInstance) {
  const backupService = fastify.backupService;

  fastify.get("/", { preHandler: fastify.requireServerAccess("backups.view") }, async (request, reply) => {
    const backups = await backupService.list(request.mcServer!.id);
    return reply.send({ backups, settings: backupService.getSettings(request.mcServer!) });
  });

  fastify.post("/", { preHandler: fastify.requireServerAccess("backups.create") }, async (request, reply) => {
    const { note } = createBackupSchema.parse(request.body ?? {});
    const server = request.mcServer!;
    const backup = await backupService.create(server, note, request.user!.id);

    await fastify.audit.record(
      AuditAction.BACKUP_CREATE,
      { userId: request.user!.id, serverId: server.id, ipAddress: request.ip },
      { backupId: backup.id, fileName: backup.fileName },
    );
    return reply.status(201).send({ backup });
  });

  // Retention deletes backups, so changing it needs the same permission as deleting one by hand.
  fastify.put("/settings", { preHandler: fastify.requireServerAccess("backups.delete") }, async (request, reply) => {
    const input = backupSettingsSchema.parse(request.body);
    const settings = await backupService.updateSettings(request.mcServer!, input);

    await fastify.audit.record(
      AuditAction.BACKUP_SETTINGS_UPDATE,
      { userId: request.user!.id, serverId: request.mcServer!.id, ipAddress: request.ip },
      input,
    );
    return reply.send({ settings });
  });

  fastify.get("/:backupId/download", { preHandler: fastify.requireServerAccess("backups.view") }, async (request, reply) => {
    const { backupId } = request.params as { backupId: string };
    const { path: filePath, fileName } = await backupService.getFilePath(request.mcServer!.id, backupId);

    reply.header("Content-Disposition", `attachment; filename="${fileName.replace(/"/g, "")}"`);
    reply.type("application/gzip");
    return reply.send(fs.createReadStream(filePath));
  });

  // Locking protects a backup from deletion (and unlocking re-allows it) — gated like delete itself.
  fastify.patch("/:backupId", { preHandler: fastify.requireServerAccess("backups.delete") }, async (request, reply) => {
    const { backupId } = request.params as { backupId: string };
    const { locked } = updateBackupSchema.parse(request.body);
    const backup = await backupService.setLocked(request.mcServer!.id, backupId, locked);

    await fastify.audit.record(
      AuditAction.BACKUP_LOCK,
      { userId: request.user!.id, serverId: request.mcServer!.id, ipAddress: request.ip },
      { backupId, locked },
    );
    return reply.send({ backup });
  });

  fastify.post("/:backupId/restore", { preHandler: fastify.requireServerAccess("backups.restore") }, async (request, reply) => {
    const { backupId } = request.params as { backupId: string };
    await backupService.restore(request.mcServer!, backupId);

    await fastify.audit.record(
      AuditAction.BACKUP_RESTORE,
      { userId: request.user!.id, serverId: request.mcServer!.id, ipAddress: request.ip },
      { backupId },
    );
    return reply.status(204).send();
  });

  fastify.delete("/:backupId", { preHandler: fastify.requireServerAccess("backups.delete") }, async (request, reply) => {
    const { backupId } = request.params as { backupId: string };
    await backupService.delete(request.mcServer!.id, backupId);

    await fastify.audit.record(
      AuditAction.BACKUP_DELETE,
      { userId: request.user!.id, serverId: request.mcServer!.id, ipAddress: request.ip },
      { backupId },
    );
    return reply.status(204).send();
  });
}
