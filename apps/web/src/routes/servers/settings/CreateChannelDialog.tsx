import { useState, type FormEvent } from "react";
import type { CreateNotificationChannelInput, NotificationChannelType } from "@latticore/shared";
import { NOTIFICATION_CHANNEL_TYPES, NOTIFICATION_CHANNEL_TYPE_LABELS } from "@latticore/shared";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateNotificationChannel } from "@/lib/notifications";

interface CreateChannelDialogProps {
  serverId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const TYPE_HELP: Record<NotificationChannelType, string> = {
  DISCORD: "Server Settings → Integrations → Webhooks → New Webhook, then copy its URL.",
  SLACK: "Create an Incoming Webhook for a channel in your Slack workspace's app settings.",
  TELEGRAM: "Create a bot via @BotFather for the token, and use your chat/group's numeric ID.",
  WEBHOOK: "Any URL that accepts a JSON POST — the panel sends { title, body, url }.",
};

export function CreateChannelDialog({ serverId, open, onOpenChange }: CreateChannelDialogProps) {
  const [type, setType] = useState<NotificationChannelType>("DISCORD");
  const [label, setLabel] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [url, setUrl] = useState("");
  const create = useCreateNotificationChannel(serverId);

  function reset() {
    setType("DISCORD");
    setLabel("");
    setWebhookUrl("");
    setBotToken("");
    setChatId("");
    setUrl("");
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    let input: CreateNotificationChannelInput;
    if (type === "DISCORD" || type === "SLACK") {
      input = { type, label, webhookUrl };
    } else if (type === "TELEGRAM") {
      input = { type, label, botToken, chatId };
    } else {
      input = { type, label, url };
    }
    create.mutate(input, {
      onSuccess: () => {
        reset();
        onOpenChange(false);
      },
    });
  }

  const valid =
    label.trim().length > 0 &&
    ((type === "DISCORD" || type === "SLACK") ? webhookUrl.trim().length > 0 : type === "TELEGRAM" ? botToken.trim().length > 0 && chatId.trim().length > 0 : url.trim().length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add notification target</DialogTitle>
          <DialogDescription>Server-wide — every event this channel is subscribed to is posted here regardless of who's logged in.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <FormField label="Service" htmlFor="channel-type">
            <Select value={type} onValueChange={(v) => setType(v as NotificationChannelType)}>
              <SelectTrigger id="channel-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NOTIFICATION_CHANNEL_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {NOTIFICATION_CHANNEL_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField label="Name" htmlFor="channel-label">
            <Input id="channel-label" placeholder="e.g. Community Discord" value={label} onChange={(e) => setLabel(e.target.value)} />
          </FormField>

          {(type === "DISCORD" || type === "SLACK") && (
            <FormField label="Webhook URL" htmlFor="channel-webhook-url">
              <Input
                id="channel-webhook-url"
                type="url"
                placeholder="https://..."
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
              />
            </FormField>
          )}

          {type === "TELEGRAM" && (
            <>
              <FormField label="Bot token" htmlFor="channel-bot-token">
                <Input id="channel-bot-token" value={botToken} onChange={(e) => setBotToken(e.target.value)} />
              </FormField>
              <FormField label="Chat ID" htmlFor="channel-chat-id">
                <Input id="channel-chat-id" value={chatId} onChange={(e) => setChatId(e.target.value)} />
              </FormField>
            </>
          )}

          {type === "WEBHOOK" && (
            <FormField label="URL" htmlFor="channel-url">
              <Input id="channel-url" type="url" placeholder="https://..." value={url} onChange={(e) => setUrl(e.target.value)} />
            </FormField>
          )}

          <p className="text-xs text-muted-foreground">{TYPE_HELP[type]}</p>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || create.isPending}>
              {create.isPending ? "Adding..." : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
