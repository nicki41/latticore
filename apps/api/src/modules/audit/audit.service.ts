import type { PrismaClient } from "@prisma/client";

export interface AuditContext {
  userId?: string | null;
  serverId?: string | null;
  ipAddress?: string | null;
}

/** Dotted action keys written to AuditLog.action, grown one entry at a time as each module needs one. */
export const AuditAction = {
  AUTH_SETUP_ADMIN_CREATED: "auth.setup_admin_created",
  AUTH_LOGIN: "auth.login",
  AUTH_LOGIN_FAILED: "auth.login_failed",
  AUTH_LOGOUT: "auth.logout",
  AUTH_PASSWORD_CHANGED: "auth.password_changed",
  AUTH_2FA_ENABLED: "auth.2fa_enabled",
  AUTH_2FA_DISABLED: "auth.2fa_disabled",
  USER_CREATE: "user.create",
  USER_UPDATE: "user.update",
  USER_DELETE: "user.delete",
  ROLE_CREATE: "role.create",
  ROLE_UPDATE: "role.update",
  ROLE_DELETE: "role.delete",
  SERVER_CREATE: "server.create",
  SERVER_DELETE: "server.delete",
  SERVER_START: "server.start",
  SERVER_STOP: "server.stop",
  SERVER_RESTART: "server.restart",
  SERVER_REINSTALL: "server.reinstall",
  SERVER_SETTINGS_UPDATE: "server.settings_update",
  SERVER_CONFIG_UPDATE: "server.config_update",
  SERVER_ALLOCATION_CREATE: "server.allocation_create",
  SERVER_ALLOCATION_DELETE: "server.allocation_delete",
  CONSOLE_EXECUTE: "console.execute",
  FILE_CREATE: "file.create",
  FILE_EDIT: "file.edit",
  FILE_DELETE: "file.delete",
  FILE_MOVE: "file.move",
  FILE_COPY: "file.copy",
  FILE_UPLOAD: "file.upload",
  FILE_EXTRACT: "file.extract",
  FILE_DOWNLOAD_ZIP: "file.download_zip",
  PLUGIN_INSTALL: "plugin.install",
  PLUGIN_REMOVE: "plugin.remove",
  PLUGIN_PAUSE: "plugin.pause",
  PLUGIN_RESUME: "plugin.resume",
  PLAYER_OP: "player.op",
  PLAYER_DEOP: "player.deop",
  PLAYER_WHITELIST_ADD: "player.whitelist_add",
  PLAYER_WHITELIST_REMOVE: "player.whitelist_remove",
  PLAYER_KICK: "player.kick",
  PLAYER_BAN: "player.ban",
  PLAYER_UNBAN: "player.unban",
  PLAYER_MESSAGE: "player.message",
  PLAYER_TEMPBAN: "player.tempban",
  PLAYER_IP_BAN: "player.ip_ban",
  PLAYER_IP_UNBAN: "player.ip_unban",
  PLAYER_WIPE: "player.wipe",
  PLAYER_GAMEMODE_CHANGE: "player.gamemode_change",
  BACKUP_CREATE: "backup.create",
  BACKUP_RESTORE: "backup.restore",
  BACKUP_DELETE: "backup.delete",
  BACKUP_LOCK: "backup.lock",
  BACKUP_SETTINGS_UPDATE: "backup.settings_update",
  SCHEDULER_WORKFLOW_CREATE: "scheduler.workflow_create",
  SCHEDULER_WORKFLOW_UPDATE: "scheduler.workflow_update",
  SCHEDULER_WORKFLOW_DELETE: "scheduler.workflow_delete",
  SCHEDULER_RUN: "scheduler.run",
  NOTIFICATION_CHANNEL_CREATE: "notification.channel_create",
  NOTIFICATION_CHANNEL_UPDATE: "notification.channel_update",
  NOTIFICATION_CHANNEL_DELETE: "notification.channel_delete",
} as const;

export class AuditService {
  constructor(private readonly prisma: PrismaClient) {}

  async record(action: string, ctx: AuditContext = {}, details?: unknown): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        action,
        userId: ctx.userId ?? null,
        serverId: ctx.serverId ?? null,
        ipAddress: ctx.ipAddress ?? null,
        // SQLite has no native Json column; stored as a JSON string and
        // parsed back on read (see audit.routes.ts).
        details: details === undefined ? undefined : JSON.stringify(details),
      },
    });
  }
}
