export const SERVER_SOFTWARE = ["VANILLA", "PAPER", "FABRIC", "FORGE", "NEOFORGE", "VELOCITY", "BUNGEECORD"] as const;
export type ServerSoftware = (typeof SERVER_SOFTWARE)[number];

/**
 * Proxies sit in front of other servers instead of hosting a world: no
 * server.properties, no world/players of their own, their "version" is the
 * proxy's own version (not a Minecraft version), and they get a Network tab
 * to manage the servers behind them.
 */
export const PROXY_SOFTWARE: readonly ServerSoftware[] = ["VELOCITY", "BUNGEECORD"];

export function isProxySoftware(software: ServerSoftware): boolean {
  return PROXY_SOFTWARE.includes(software);
}

/** Backend software the panel can fully configure for a proxy network (forwarding, online-mode). */
export const NETWORK_BACKEND_SOFTWARE: readonly ServerSoftware[] = ["PAPER"];

/** Software families that support installing plugins/mods at all. Vanilla does not. */
export const MODDABLE_SOFTWARE: readonly ServerSoftware[] = ["PAPER", "FABRIC", "FORGE", "NEOFORGE", "VELOCITY", "BUNGEECORD"];

/** Maps server software to the Modrinth loader facet used when searching/filtering. */
export const SOFTWARE_TO_MODRINTH_LOADER: Partial<Record<ServerSoftware, string>> = {
  PAPER: "paper",
  FABRIC: "fabric",
  FORGE: "forge",
  NEOFORGE: "neoforge",
  VELOCITY: "velocity",
  BUNGEECORD: "bungeecord",
};

/** Whether a software family installs "plugins" (Bukkit-style, or proxy plugins) or "mods". */
export function pluginTerminologyFor(software: ServerSoftware): "plugin" | "mod" | "none" {
  if (software === "PAPER" || software === "VELOCITY" || software === "BUNGEECORD") return "plugin";
  if (software === "FABRIC" || software === "FORGE" || software === "NEOFORGE") return "mod";
  return "none";
}

/**
 * LEGACY: itzg/docker-minecraft-server image, RCON console, panel-agnostic
 * install (env-var driven). Frozen forever — existing servers keep running
 * this way permanently, this code path is never touched by new work.
 * PANEL_MANAGED: minimal JRE-only image, panel-owned install (direct jar
 * download or a short-lived installer container), direct stdin/stdout
 * attach for console. What every server created from now on uses.
 */
export const SERVER_RUNTIME = ["LEGACY", "PANEL_MANAGED"] as const;
export type ServerRuntime = (typeof SERVER_RUNTIME)[number];

export const SERVER_STATUS = [
  "CREATING",
  "INSTALLING",
  "STOPPED",
  "STARTING",
  "RUNNING",
  "STOPPING",
  "ERROR",
  "DELETING",
] as const;
export type ServerStatus = (typeof SERVER_STATUS)[number];

/** Statuses during which the underlying container is expected to be absent or transient. */
export const TRANSIENT_STATUSES: readonly ServerStatus[] = ["CREATING", "INSTALLING", "STARTING", "STOPPING", "DELETING"];

export const ACCESS_LEVEL = ["FULL", "VIEW_ONLY"] as const;
export type AccessLevel = (typeof ACCESS_LEVEL)[number];

// Modrinth's actual project_type values (verified against the live API) —
// note there is no separate "plugin" type: a Bukkit/Paper plugin like
// LuckPerms is project_type "mod" too, distinguished only by its `loaders`
// array containing "paper"/"spigot"/"bukkit" instead of "fabric"/"forge".
// The plugin-vs-mod wording shown to users is purely ours, computed by
// pluginTerminologyFor() based on the target server's software.
export const MODRINTH_PROJECT_TYPE = ["mod", "modpack", "resourcepack", "shader"] as const;
export type ModrinthProjectType = (typeof MODRINTH_PROJECT_TYPE)[number];
