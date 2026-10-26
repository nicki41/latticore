import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { NetworkService } from "../modules/network/network.service.js";

declare module "fastify" {
  interface FastifyInstance {
    networkService: NetworkService;
  }
}

/** Must be registered after minecraftPlugin — the service reloads proxies through the server manager's console. */
export default fp(async (fastify: FastifyInstance) => {
  fastify.decorate("networkService", new NetworkService(fastify.prisma, fastify.serverManager));
});
