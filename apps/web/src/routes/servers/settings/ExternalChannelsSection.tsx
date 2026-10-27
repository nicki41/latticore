import { useState } from "react";
import { Plus, Send, Trash2, Webhook } from "lucide-react";
import { NOTIFICATION_CATEGORIES, NOTIFICATION_CATEGORY_LABELS, NOTIFICATION_CHANNEL_TYPE_LABELS, type NotificationChannelDto } from "@latticore/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/layout/EmptyState";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  useNotificationChannels,
  useUpdateNotificationChannel,
  useDeleteNotificationChannel,
  useTestNotificationChannel,
} from "@/lib/notifications";
import { ApiError } from "@/lib/api";
import { CreateChannelDialog } from "./CreateChannelDialog";

function ChannelRow({ serverId, channel, canEdit }: { serverId: string; channel: NotificationChannelDto; canEdit: boolean }) {
  const update = useUpdateNotificationChannel(serverId);
  const remove = useDeleteNotificationChannel(serverId);
  const test = useTestNotificationChannel(serverId);

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{channel.label}</span>
          <Badge variant="secondary">{NOTIFICATION_CHANNEL_TYPE_LABELS[channel.type]}</Badge>
        </div>
        {canEdit && (
          <div className="flex shrink-0 items-center gap-1.5">
            <Button type="button" variant="outline" size="sm" disabled={test.isPending} onClick={() => test.mutate(channel.id)}>
              <Send /> {test.isPending ? "Sending..." : "Test send"}
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="ghost" size="icon" aria-label="Remove">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove "{channel.label}"?</AlertDialogTitle>
                  <AlertDialogDescription>It will stop receiving notifications immediately. This can't be undone.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={() => remove.mutate(channel.id)}>
                    Remove
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        {NOTIFICATION_CATEGORIES.map((category) => (
          <div key={category} className="flex items-center justify-between gap-4">
            <Label htmlFor={`${channel.id}-${category}`} className="text-sm font-normal text-muted-foreground">
              {NOTIFICATION_CATEGORY_LABELS[category]}
            </Label>
            <Switch
              id={`${channel.id}-${category}`}
              checked={channel[category]}
              disabled={!canEdit || update.isPending}
              onCheckedChange={(checked) => update.mutate({ channelId: channel.id, input: { [category]: checked } })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Server-wide external notification targets — read-only (no Add/Test/
 * Delete, toggles disabled) unless canEdit, matching every other tab on
 * this page's convention (server.myAccessLevel === "FULL" &&
 * hasPermission("servers.settings.edit")).
 */
export function ExternalChannelsSection({ serverId, canEdit }: { serverId: string; canEdit: boolean }) {
  const { data, isLoading, isError, error } = useNotificationChannels(serverId);
  const [addOpen, setAddOpen] = useState(false);

  const channels = data?.channels ?? [];

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>External services</CardTitle>
          <CardDescription>Discord, Telegram, Slack, or a generic webhook — visible to everyone with this server, regardless of who's logged in.</CardDescription>
        </div>
        {canEdit && (
          <Button type="button" size="sm" className="shrink-0" onClick={() => setAddOpen(true)}>
            <Plus /> Add target
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && (
          <div className="space-y-3">
            {[...Array(2)].map((_, i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        )}

        {isError && (
          <p className="text-sm text-destructive">{error instanceof ApiError ? error.message : "Failed to load notification targets."}</p>
        )}

        {!isLoading && !isError && channels.length === 0 && (
          <EmptyState icon={Webhook} title="No targets configured" description="Add a Discord webhook, Telegram bot, Slack webhook, or generic webhook to post events there." />
        )}

        {channels.map((channel) => (
          <ChannelRow key={channel.id} serverId={serverId} channel={channel} canEdit={canEdit} />
        ))}
      </CardContent>

      <CreateChannelDialog serverId={serverId} open={addOpen} onOpenChange={setAddOpen} />
    </Card>
  );
}
