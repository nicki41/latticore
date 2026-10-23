import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { BackupService } from "../modules/backups/backups.service.js";

declare module "fastify" {
  interface FastifyInstance {
    backupService: BackupService;
  }
}

/**
 * One BackupService for the whole app — the REST routes and the scheduler's
 * BACKUP steps share it, so they share its per-server backup/restore lock,
 * retention handling, and "created"/"failed" events (see plugins/notifications.ts).
 * Must be registered after minecraftPlugin, whose console it uses to pause
 * autosave around a backup.
 */
export default fp(async (fastify: FastifyInstance) => {
  fastify.decorate("backupService", new BackupService(fastify.prisma, fastify.serverManager));
});
