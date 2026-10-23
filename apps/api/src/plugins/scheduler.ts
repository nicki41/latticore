import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { SchedulerService } from "../modules/scheduler/scheduler.service.js";

declare module "fastify" {
  interface FastifyInstance {
    schedulerService: SchedulerService;
  }
}

/** Must be registered after the minecraft/backups/audit plugins in app.ts — all three are read off `fastify` here at registration time. */
export default fp(async (fastify: FastifyInstance) => {
  const service = new SchedulerService(
    fastify.prisma,
    fastify.serverManager,
    fastify.backupService,
    fastify.audit,
  );
  service.startTicking();

  fastify.decorate("schedulerService", service);
  fastify.addHook("onClose", async () => {
    service.stopTicking();
  });
});
