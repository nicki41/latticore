import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { subscribePushSchema } from "@latticore/shared";

const unsubscribeSchema = z.object({ endpoint: z.string().url() });

/**
 * Per-user web push device registration — mounted at
 * /api/users/me/push-subscriptions (see modules/index.ts). Every handler
 * here just needs requireAuth: a subscription belongs to whoever's logged
 * in, independent of any particular server's access.
 */
export async function pushRoutes(fastify: FastifyInstance) {
  fastify.get("/", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const subscriptions = await fastify.prisma.pushSubscription.findMany({
      where: { userId: request.user!.id },
      orderBy: { createdAt: "desc" },
    });
    return reply.send({
      subscriptions: subscriptions.map((s) => ({ id: s.id, userAgent: s.userAgent, createdAt: s.createdAt.toISOString() })),
    });
  });

  fastify.post("/", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const input = subscribePushSchema.parse(request.body);

    await fastify.prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: {
        userId: request.user!.id,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: input.userAgent ?? request.headers["user-agent"] ?? null,
      },
      // A browser can re-subscribe the same endpoint (e.g. permission
      // re-granted) — reassign it to whoever's logged in now rather than
      // erroring on the unique constraint.
      update: {
        userId: request.user!.id,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: input.userAgent ?? request.headers["user-agent"] ?? null,
      },
    });

    return reply.status(204).send();
  });

  fastify.delete("/", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const { endpoint } = unsubscribeSchema.parse(request.body);
    await fastify.prisma.pushSubscription.deleteMany({ where: { endpoint, userId: request.user!.id } });
    return reply.status(204).send();
  });
}
