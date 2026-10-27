import type { FastifyInstance } from "fastify";
import {
  createNotificationChannelSchema,
  updateNotificationChannelSchema,
  NOTIFICATION_CATEGORIES,
  type CreateNotificationChannelInput,
  type NotificationCategory,
  type NotificationChannelDto,
} from "@latticore/shared";
import type { NotificationChannel } from "@prisma/client";
import { encryptChannelConfig, decryptChannelConfig } from "../../lib/webhookCrypto.js";
import { sendToChannel } from "./channels/index.js";
import { AuditAction } from "../audit/audit.service.js";
import { NotFoundError } from "../../lib/errors.js";

function extractConfig(input: CreateNotificationChannelInput): unknown {
  switch (input.type) {
    case "DISCORD":
    case "SLACK":
      return { webhookUrl: input.webhookUrl };
    case "TELEGRAM":
      return { botToken: input.botToken, chatId: input.chatId };
    case "WEBHOOK":
      return { url: input.url };
  }
}

function toggleValues(input: { [K in NotificationCategory]?: boolean }): Partial<Record<NotificationCategory, boolean>> {
  const result: Partial<Record<NotificationCategory, boolean>> = {};
  for (const category of NOTIFICATION_CATEGORIES) {
    if (input[category] !== undefined) result[category] = input[category];
  }
  return result;
}

function toDto(channel: NotificationChannel): NotificationChannelDto {
  const categories = Object.fromEntries(NOTIFICATION_CATEGORIES.map((c) => [c, channel[c]])) as Record<NotificationCategory, boolean>;
  return {
    id: channel.id,
    serverId: channel.serverId,
    type: channel.type as NotificationChannelDto["type"],
    label: channel.label,
    configured: true,
    createdAt: channel.createdAt.toISOString(),
    updatedAt: channel.updatedAt.toISOString(),
    ...categories,
  };
}

/**
 * Per-server external notification targets (Discord/Telegram/Slack/generic
 * webhook) — mounted at /api/servers/:id/notifications/channels (see
 * modules/index.ts). Reading is available to any server access level;
 * every mutating route requires "servers.settings.edit" (FULL access
 * only), per the task's requirement that view-only users see these
 * read-only. See lib/webhookCrypto.ts for how the secret config is
 * encrypted at rest and never returned in a GET response.
 */
export async function channelsRoutes(fastify: FastifyInstance) {
  fastify.get("/", { preHandler: fastify.requireServerAccess("servers.view") }, async (request, reply) => {
    const channels = await fastify.prisma.notificationChannel.findMany({
      where: { serverId: request.mcServer!.id },
      orderBy: { createdAt: "asc" },
    });
    return reply.send({ channels: channels.map(toDto) });
  });

  fastify.post("/", { preHandler: fastify.requireServerAccess("servers.settings.edit") }, async (request, reply) => {
    const server = request.mcServer!;
    const input = createNotificationChannelSchema.parse(request.body);

    const channel = await fastify.prisma.notificationChannel.create({
      data: {
        serverId: server.id,
        type: input.type,
        label: input.label,
        configEncrypted: encryptChannelConfig(extractConfig(input)),
        ...toggleValues(input),
      },
    });

    await fastify.audit.record(
      AuditAction.NOTIFICATION_CHANNEL_CREATE,
      { userId: request.user!.id, serverId: server.id, ipAddress: request.ip },
      { channelId: channel.id, type: channel.type, label: channel.label },
    );

    return reply.status(201).send({ channel: toDto(channel) });
  });

  fastify.patch("/:channelId", { preHandler: fastify.requireServerAccess("servers.settings.edit") }, async (request, reply) => {
    const server = request.mcServer!;
    const { channelId } = request.params as { channelId: string };
    const input = updateNotificationChannelSchema.parse(request.body);

    const existing = await fastify.prisma.notificationChannel.findUnique({ where: { id: channelId } });
    if (!existing || existing.serverId !== server.id) throw new NotFoundError("Notification channel not found.");

    const channel = await fastify.prisma.notificationChannel.update({
      where: { id: channelId },
      data: { label: input.label, ...toggleValues(input) },
    });

    await fastify.audit.record(
      AuditAction.NOTIFICATION_CHANNEL_UPDATE,
      { userId: request.user!.id, serverId: server.id, ipAddress: request.ip },
      { channelId: channel.id, type: channel.type, label: channel.label },
    );

    return reply.send({ channel: toDto(channel) });
  });

  fastify.delete("/:channelId", { preHandler: fastify.requireServerAccess("servers.settings.edit") }, async (request, reply) => {
    const server = request.mcServer!;
    const { channelId } = request.params as { channelId: string };

    const existing = await fastify.prisma.notificationChannel.findUnique({ where: { id: channelId } });
    if (!existing || existing.serverId !== server.id) throw new NotFoundError("Notification channel not found.");

    await fastify.prisma.notificationChannel.delete({ where: { id: channelId } });

    await fastify.audit.record(
      AuditAction.NOTIFICATION_CHANNEL_DELETE,
      { userId: request.user!.id, serverId: server.id, ipAddress: request.ip },
      { channelId: existing.id, type: existing.type, label: existing.label },
    );

    return reply.status(204).send();
  });

  fastify.post("/:channelId/test", { preHandler: fastify.requireServerAccess("servers.settings.edit") }, async (request, reply) => {
    const server = request.mcServer!;
    const { channelId } = request.params as { channelId: string };

    const channel = await fastify.prisma.notificationChannel.findUnique({ where: { id: channelId } });
    if (!channel || channel.serverId !== server.id) throw new NotFoundError("Notification channel not found.");

    try {
      const config = decryptChannelConfig(channel.configEncrypted);
      await sendToChannel(channel.type as CreateNotificationChannelInput["type"], config, {
        title: `Test notification from ${server.name}`,
        body: "If you can see this, the connection is working.",
      });
      return reply.send({ ok: true });
    } catch (err) {
      return reply.send({ ok: false, error: err instanceof Error ? err.message : "Test send failed." });
    }
  });
}
