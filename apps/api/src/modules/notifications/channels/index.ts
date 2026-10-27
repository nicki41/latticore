import type { NotificationChannelType } from "@latticore/shared";
import type { NotificationPayload } from "./types.js";
import { send as sendDiscord } from "./discord.js";
import { send as sendSlack } from "./slack.js";
import { send as sendTelegram } from "./telegram.js";
import { send as sendWebhook } from "./webhook.js";

export type { NotificationPayload } from "./types.js";

/** Dispatches to the right channel client for a decrypted config blob — the config's shape is trusted to match `type` since it was only ever written by createNotificationChannelSchema's matching discriminated-union variant. */
export async function sendToChannel(type: NotificationChannelType, config: unknown, payload: NotificationPayload): Promise<void> {
  switch (type) {
    case "DISCORD":
      return sendDiscord(config as Parameters<typeof sendDiscord>[0], payload);
    case "SLACK":
      return sendSlack(config as Parameters<typeof sendSlack>[0], payload);
    case "TELEGRAM":
      return sendTelegram(config as Parameters<typeof sendTelegram>[0], payload);
    case "WEBHOOK":
      return sendWebhook(config as Parameters<typeof sendWebhook>[0], payload);
  }
}
