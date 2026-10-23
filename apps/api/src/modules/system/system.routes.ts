import type { FastifyInstance } from "fastify";
import { getPublicIp } from "../../lib/publicIp.js";
import { getVapidPublicKey } from "../notifications/webPushSender.js";
import { env } from "../../config/env.js";

export async function systemRoutes(fastify: FastifyInstance) {
  /** Instance facts the UI needs to display things correctly — e.g. scheduler times are in the panel's zone, not the browser's. */
  fastify.get("/info", { preHandler: fastify.requireAuth }, async (_request, reply) => {
    return reply.send({ timezone: env.TZ });
  });

  fastify.get("/network", { preHandler: fastify.requireAuth }, async (_request, reply) => {
    const publicIp = await getPublicIp();
    return reply.send({ publicIp });
  });

  fastify.get("/notifications/vapid-public-key", { preHandler: fastify.requireAuth }, async (_request, reply) => {
    return reply.send({ vapidPublicKey: getVapidPublicKey() });
  });
}
