import type { ServerDto } from "@latticore/shared";
import { PushNotificationsSection } from "./PushNotificationsSection";
import { ExternalChannelsSection } from "./ExternalChannelsSection";

export function NotificationsSettingsTab({ server, canEdit }: { server: ServerDto; canEdit: boolean }) {
  return (
    <div className="space-y-6">
      <PushNotificationsSection serverId={server.id} />
      <ExternalChannelsSection serverId={server.id} canEdit={canEdit} />
    </div>
  );
}
