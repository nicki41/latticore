import type { PrismaClient } from "@prisma/client";
import type { NotificationCategory, NotificationChannelType } from "@latticore/shared";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { decryptChannelConfig } from "../../lib/webhookCrypto.js";
import { sendWebPush } from "./webPushSender.js";
import { sendToChannel } from "./channels/index.js";

export interface NotificationEvent {
  serverId: string;
  category: NotificationCategory;
  title: string;
  body: string;
  /** Relative URL opened on notification click — defaults to the server's page. */
  url?: string;
}

/**
 * Central fan-out point for every notification-worthy event in the panel.
 * Event *sources* (MinecraftServerManager's "status", PlayerActivityTracker's
 * "playerJoin"/"playerLeave", the backups route, the performance/update
 * checkers — see plugins/notifications.ts) call dispatch(); this looks up
 * who's subscribed to that category on that server and sends to each.
 *
 * Fans out to both delivery mechanisms in parallel: push (per-user,
 * per-device, via NotificationPreference) and external service channels
 * (Discord/Telegram/Slack/webhook, per-server, via NotificationChannel).
 */
export class NotificationDispatcherService {
  constructor(private readonly prisma: PrismaClient) {}

  async dispatch(event: NotificationEvent): Promise<void> {
    await Promise.all([this.dispatchPush(event), this.dispatchChannels(event)]);
  }

  private async dispatchChannels(event: NotificationEvent): Promise<void> {
    const channels = await this.prisma.notificationChannel.findMany({
      where: { serverId: event.serverId, [event.category]: true },
    });

    await Promise.all(
      channels.map(async (channel) => {
        try {
          const config = decryptChannelConfig(channel.configEncrypted);
          await sendToChannel(channel.type as NotificationChannelType, config, {
            title: event.title,
            body: event.body,
            url: event.url ? new URL(event.url, env.WEB_ORIGIN).toString() : new URL(`/servers/${event.serverId}`, env.WEB_ORIGIN).toString(),
          });
        } catch (err) {
          logger.debug({ err, channelId: channel.id, serverId: event.serverId }, "Failed to send to notification channel");
        }
      }),
    );
  }

  private async dispatchPush(event: NotificationEvent): Promise<void> {
    const preferences = await this.prisma.notificationPreference.findMany({
      where: { serverId: event.serverId, [event.category]: true },
      include: { user: { include: { pushSubscriptions: true } } },
    });

    const expiredSubscriptionIds: string[] = [];

    await Promise.all(
      preferences.flatMap((pref) =>
        pref.user.pushSubscriptions.map(async (sub) => {
          const result = await sendWebPush(sub, {
            title: event.title,
            body: event.body,
            url: event.url ?? `/servers/${event.serverId}`,
          });
          if (result.expired) expiredSubscriptionIds.push(sub.id);
        }),
      ),
    );

    if (expiredSubscriptionIds.length > 0) {
      await this.prisma.pushSubscription.deleteMany({ where: { id: { in: expiredSubscriptionIds } } }).catch((err) => {
        logger.debug({ err }, "Failed to clean up expired push subscriptions");
      });
    }
  }
}
