import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { MinecraftServerManager } from "../minecraft/MinecraftServerManager.js";

declare module "fastify" {
  interface FastifyInstance {
    serverManager: MinecraftServerManager;
  }
}

export default fp(async (fastify: FastifyInstance) => {
  const manager = new MinecraftServerManager(fastify.prisma);
  manager.on("status", (serverId, status) => {
    fastify.log.info({ serverId, status }, "Server status changed");
  });
  // Before the reconciler starts ticking: it skips transitional statuses by
  // design, so anything an earlier process left mid-operation has to be
  // settled once, here, or it would stay stuck forever.
  await manager.recoverInterruptedOperations().catch((err) => fastify.log.error({ err }, "Interrupted-operation recovery failed"));
  manager.startReconciler();

  fastify.decorate("serverManager", manager);
  fastify.addHook("onClose", async () => {
    manager.stopReconciler();
  });
});
