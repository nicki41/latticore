import type { AccessLevel } from "./types/enums.js";

export const PERMISSIONS = [
  "servers.view",
  "servers.create",
  "servers.delete",
  "servers.start",
  "servers.stop",
  "servers.restart",
  "servers.settings.edit",
  "servers.reinstall",

  "console.view",
  "console.execute",

  "files.view",
  "files.create",
  "files.edit",
  "files.delete",
  "files.upload",

  "players.view",
  "players.kick",
  "players.ban",
  "players.op",
  "players.whitelist",
  "players.message",
  "players.wipe",

  "plugins.view",
  "plugins.install",
  "plugins.remove",

  "backups.view",
  "backups.create",
  "backups.restore",
  "backups.delete",

  "scheduler.view",
  "scheduler.manage",

  "users.view",
  "users.create",
  "users.edit",
  "users.delete",

  "roles.view",
  "roles.manage",

  "audit.view",

  "settings.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

export const SYSTEM_ROLES = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MANAGER: "Manager",
  MODERATOR: "Moderator",
  VIEWER: "Viewer",
} as const;

export type SystemRoleName = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];

/**
 * Permission sets granted to built-in roles at seed time. Owner is not
 * listed here — it always receives every entry in `PERMISSIONS` (see
 * seedRolesAndPermissions in the API), so newly introduced permissions
 * automatically apply to Owner without a code change here.
 */
export const SYSTEM_ROLE_PERMISSIONS: Record<Exclude<SystemRoleName, "Owner">, Permission[]> = {
  // Everything except instance-wide settings, which stay Owner-only.
  Admin: PERMISSIONS.filter((p) => p !== "settings.manage") as Permission[],
  // Full server management, no user/role administration.
  Manager: [
    "servers.view",
    "servers.create",
    "servers.delete",
    "servers.start",
    "servers.stop",
    "servers.restart",
    "servers.settings.edit",
    "servers.reinstall",
    "console.view",
    "console.execute",
    "files.view",
    "files.create",
    "files.edit",
    "files.delete",
    "files.upload",
    "players.view",
    "players.kick",
    "players.ban",
    "players.op",
    "players.whitelist",
    "players.message",
    "plugins.view",
    "plugins.install",
    "plugins.remove",
    "backups.view",
    "backups.create",
    "backups.restore",
    "backups.delete",
    "scheduler.view",
    "scheduler.manage",
  ],
  // Player management and console access only.
  Moderator: [
    "servers.view",
    "console.view",
    "console.execute",
    "players.view",
    "players.kick",
    "players.ban",
    "players.op",
    "players.whitelist",
    "players.message",
  ],
  // Read-only across the board.
  Viewer: [
    "servers.view",
    "console.view",
    "files.view",
    "players.view",
    "plugins.view",
    "backups.view",
    "scheduler.view",
  ],
};

const SERVER_SCOPED_PREFIXES = [
  "servers.",
  "console.",
  "files.",
  "players.",
  "plugins.",
  "backups.",
  "scheduler.",
] as const;

/** Permissions that apply to a specific server rather than the instance globally. */
export function isServerScopedPermission(permission: Permission): boolean {
  return SERVER_SCOPED_PREFIXES.some((prefix) => permission.startsWith(prefix));
}

const VIEW_ONLY_SURVIVORS: ReadonlySet<Permission> = new Set([
  "servers.view",
  "console.view",
  "files.view",
  "players.view",
  "plugins.view",
  "backups.view",
  "scheduler.view",
]);

/**
 * A user's permissions on ONE server = their role-derived permissions,
 * narrowed by their ServerAccess row for that server:
 *  - no row              -> every server-scoped permission is stripped
 *  - VIEW_ONLY            -> only *.view permissions survive
 *  - FULL                 -> role permissions pass through unchanged
 * Non-server-scoped permissions (users.*, roles.*, audit.view,
 * settings.manage) are never affected by server access.
 *
 * This must be re-derived and enforced server-side on every request; the
 * frontend only uses it to decide what to render.
 */
export function effectiveServerPermissions(
  rolePermissions: readonly Permission[],
  accessLevel: AccessLevel | null | undefined,
): Set<Permission> {
  const result = new Set<Permission>();
  for (const permission of rolePermissions) {
    if (!isServerScopedPermission(permission)) {
      result.add(permission);
      continue;
    }
    if (accessLevel === "FULL") {
      result.add(permission);
    } else if (accessLevel === "VIEW_ONLY" && VIEW_ONLY_SURVIVORS.has(permission)) {
      result.add(permission);
    }
  }
  return result;
}
