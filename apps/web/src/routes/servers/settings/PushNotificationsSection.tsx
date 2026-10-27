import { Bell, BellOff } from "lucide-react";
import { NOTIFICATION_CATEGORIES, NOTIFICATION_CATEGORY_LABELS, type NotificationCategory } from "@latticore/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api";
import { isPushSupported, useIsPushSubscribedOnThisDevice, useSubscribeToPush, useUnsubscribeFromPush } from "@/lib/push";
import { useNotificationPreferences, useUpdateNotificationPreferences } from "@/lib/notifications";

/**
 * A user's own push toggles for this server — visible/editable to anyone
 * with any access to the server, regardless of role or FULL/VIEW_ONLY
 * (this is purely personal, unlike the External services section below it).
 */
export function PushNotificationsSection({ serverId }: { serverId: string }) {
  const { data, isLoading, isError, error } = useNotificationPreferences(serverId);
  const update = useUpdateNotificationPreferences(serverId);
  const subscribedQuery = useIsPushSubscribedOnThisDevice();
  const subscribe = useSubscribeToPush();
  const unsubscribe = useUnsubscribeFromPush();

  const supported = isPushSupported();
  const subscribed = subscribedQuery.data ?? false;

  function toggle(category: NotificationCategory, value: boolean) {
    if (!data) return;
    update.mutate({ ...stripDto(data.preference), [category]: value });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>Push notifications</CardTitle>
          <CardDescription>Notifications sent to this device only you control — set separately on every device you use.</CardDescription>
        </div>
        {supported && (
          <Button
            type="button"
            variant={subscribed ? "outline" : "default"}
            size="sm"
            className="shrink-0"
            disabled={subscribe.isPending || unsubscribe.isPending || subscribedQuery.isLoading}
            onClick={() => (subscribed ? unsubscribe.mutate() : subscribe.mutate())}
          >
            {subscribed ? (
              <>
                <BellOff /> Disable on this device
              </>
            ) : (
              <>
                <Bell /> Enable on this device
              </>
            )}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {!supported && <p className="text-sm text-muted-foreground">Push notifications aren't supported in this browser.</p>}

        {isLoading && (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        )}

        {isError && (
          <p className="text-sm text-destructive">{error instanceof ApiError ? error.message : "Failed to load push preferences."}</p>
        )}

        {data &&
          NOTIFICATION_CATEGORIES.map((category) => (
            <div key={category} className="flex items-center justify-between gap-4 py-1">
              <Label htmlFor={`push-${category}`} className="text-sm font-normal">
                {NOTIFICATION_CATEGORY_LABELS[category]}
              </Label>
              <Switch
                id={`push-${category}`}
                checked={data.preference[category]}
                disabled={update.isPending}
                onCheckedChange={(checked) => toggle(category, checked)}
              />
            </div>
          ))}
      </CardContent>
    </Card>
  );
}

function stripDto<T extends { serverId: string }>(dto: T): Omit<T, "serverId"> {
  const { serverId: _serverId, ...rest } = dto;
  return rest;
}
