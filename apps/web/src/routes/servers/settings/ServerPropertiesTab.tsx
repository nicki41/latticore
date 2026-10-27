import { SERVER_PROPERTIES_FILE, type ServerDto } from "@latticore/shared";
import { ConfigFileCard } from "./ServerTypeConfigTab";

/**
 * server.properties applies to every server software, so this tab is always shown (unlike
 * ServerTypeConfigTab, which is per-software). motd/max-players are excluded here — they have
 * their own dedicated editor on the General tab — but stay in the shared schema so this same
 * file/API keeps validating and persisting them.
 */
export function ServerPropertiesTab({ server, canEdit }: { server: ServerDto; canEdit: boolean }) {
  return <ConfigFileCard server={server} fileDef={SERVER_PROPERTIES_FILE} canEdit={canEdit} excludeKeys={["motd", "max-players"]} />;
}
