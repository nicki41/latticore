import { getServerConfigSchema, isProxySoftware } from "@latticore/shared";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth";
import { useServerOutletContext } from "./useServerOutletContext";
import { GeneralSettingsTab } from "./settings/GeneralSettingsTab";
import { ServerPropertiesTab } from "./settings/ServerPropertiesTab";
import { ResourcesSettingsTab } from "./settings/ResourcesSettingsTab";
import { ServerTypeConfigTab } from "./settings/ServerTypeConfigTab";
import { DangerZoneCard } from "./settings/DangerZoneCard";
import { NotificationsSettingsTab } from "./settings/NotificationsSettingsTab";

export default function ServerSettingsPage() {
  const { server } = useServerOutletContext();
  const { hasPermission } = useAuth();
  const canEdit = server.myAccessLevel === "FULL" && hasPermission("servers.settings.edit");
  const typeConfigSchema = getServerConfigSchema(server.software);
  // A proxy has no server.properties; its own config lives in velocity.toml / config.yml (Files).
  const hasProperties = !isProxySoftware(server.software);

  return (
    <Tabs defaultValue="general">
      <TabsList>
        <TabsTrigger value="general">General</TabsTrigger>
        {hasProperties && <TabsTrigger value="properties">Server Properties</TabsTrigger>}
        {typeConfigSchema && <TabsTrigger value="type-config">{typeConfigSchema.tabLabel}</TabsTrigger>}
        <TabsTrigger value="resources">Resources</TabsTrigger>
        <TabsTrigger value="notifications">Notifications</TabsTrigger>
      </TabsList>

      <TabsContent value="general" className="space-y-6">
        <GeneralSettingsTab server={server} canEdit={canEdit} />
        <DangerZoneCard server={server} />
      </TabsContent>
      {hasProperties && (
        <TabsContent value="properties">
          <ServerPropertiesTab server={server} canEdit={canEdit} />
        </TabsContent>
      )}
      {typeConfigSchema && (
        <TabsContent value="type-config">
          <ServerTypeConfigTab server={server} canEdit={canEdit} />
        </TabsContent>
      )}
      <TabsContent value="resources">
        <ResourcesSettingsTab server={server} canEdit={canEdit} />
      </TabsContent>
      <TabsContent value="notifications">
        <NotificationsSettingsTab server={server} canEdit={canEdit} />
      </TabsContent>
    </Tabs>
  );
}
