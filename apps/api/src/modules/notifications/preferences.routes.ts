import type { FastifyInstance } from "fastify";
import {
  updateNotificationPreferenceSchema,
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
  type NotificationPreferenceDto,
} from "@latticore/shared";

const DEFAULTS: Record<NotificationCategory, boolean> = {
  serverStatus: true,
  playerActivity: false,
  crash: true,
  backup: false,
  performance: false,
  updateAvailable: false,
};

function toDto(serverId: string, values: Record<NotificationCategory, boolean>): NotificationPreferenceDto {
  const categories = Object.fromEntries(NOTIFICATION_CATEGORIES.map((c) => [c, values[c]])) as Record<NotificationCategory, boolean>;
  return { serverId, ...categories };
}

/**
 * A user's own push-notification toggles for one server — mounted at
 * /api/servers/:id/notifications/preferences (see modules/index.ts).
 * Gated on "servers.view" rather than "servers.settings.edit": anyone with
 * ANY access to the server (FULL or VIEW_ONLY) may set their own push
 * preferences, per the task spec — this is purely personal, not a
 * server-wide config change (that's NotificationChannel, gated separately).
 */
export async function preferencesRoutes(fastify: FastifyInstance) {
  fastify.get("/", { preHandler: fastify.requireServerAccess("servers.view") }, async (request, reply) => {
    const server = request.mcServer!;
    const pref = await fastify.prisma.notificationPreference.findUnique({
      where: { userId_serverId: { userId: request.user!.id, serverId: server.id } },
    });

    const dto = toDto(server.id, pref ?? DEFAULTS);
    return reply.send({ preference: dto });
  });

  fastify.put("/", { preHandler: fastify.requireServerAccess("servers.view") }, async (request, reply) => {
    const server = request.mcServer!;
    const input = updateNotificationPreferenceSchema.parse(request.body);

    const pref = await fastify.prisma.notificationPreference.upsert({
      where: { userId_serverId: { userId: request.user!.id, serverId: server.id } },
      create: { userId: request.user!.id, serverId: server.id, ...input },
      update: input,
    });

    const dto = toDto(server.id, pref);
    return reply.send({ preference: dto });
  });
}
