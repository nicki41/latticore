import type { FastifyInstance } from "fastify";
import { healthRoutes } from "./health/health.routes.js";
import { systemRoutes } from "./system/system.routes.js";
import { authRoutes } from "./auth/auth.routes.js";
import { serversRoutes } from "./servers/servers.routes.js";
import { serversWsRoutes } from "./servers/servers.ws.js";
import { allocationsRoutes } from "./servers/allocations.routes.js";
import { networkRoutes } from "./network/network.routes.js";
import { filesRoutes } from "./files/files.routes.js";
import { serverConfigRoutes } from "./serverConfig/serverConfig.routes.js";
import { modrinthRoutes } from "./modrinth/modrinth.routes.js";
import { pluginsRoutes } from "./modrinth/plugins.routes.js";
import { playersRoutes } from "./players/players.routes.js";
import { mojangRoutes } from "./mojang/mojang.routes.js";
import { usersRoutes } from "./users/users.routes.js";
import { rolesRoutes } from "./roles/roles.routes.js";
import { auditRoutes } from "./audit/audit.routes.js";
import { backupsRoutes } from "./backups/backups.routes.js";
import { schedulerRoutes } from "./scheduler/scheduler.routes.js";
import { pushRoutes } from "./notifications/push.routes.js";
import { preferencesRoutes } from "./notifications/preferences.routes.js";
import { channelsRoutes } from "./notifications/channels.routes.js";

/**
 * Single place that wires every feature module's routes onto the app.
 * Grows one module per build phase; keeps app.ts itself free of per-feature
 * knowledge.
 */
export async function registerApiRoutes(app: FastifyInstance) {
  await app.register(healthRoutes, { prefix: "/api" });
  await app.register(systemRoutes, { prefix: "/api/system" });
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(serversRoutes, { prefix: "/api/servers" });
  await app.register(serversWsRoutes, { prefix: "/ws/servers" });
  await app.register(allocationsRoutes, { prefix: "/api/servers/:id/allocations" });
  await app.register(networkRoutes, { prefix: "/api/servers/:id/network" });
  await app.register(filesRoutes, { prefix: "/api/servers/:id/files" });
  await app.register(serverConfigRoutes, { prefix: "/api/servers/:id/config" });
  await app.register(modrinthRoutes, { prefix: "/api/modrinth" });
  await app.register(pluginsRoutes, { prefix: "/api/servers/:id/plugins" });
  await app.register(playersRoutes, { prefix: "/api/servers/:id/players" });
  await app.register(mojangRoutes, { prefix: "/api/players" });
  await app.register(usersRoutes, { prefix: "/api/users" });
  await app.register(rolesRoutes, { prefix: "/api/roles" });
  await app.register(auditRoutes, { prefix: "/api/audit-log" });
  await app.register(backupsRoutes, { prefix: "/api/servers/:id/backups" });
  await app.register(schedulerRoutes, { prefix: "/api/servers/:id/scheduler" });
  await app.register(pushRoutes, { prefix: "/api/users/me/push-subscriptions" });
  await app.register(preferencesRoutes, { prefix: "/api/servers/:id/notifications/preferences" });
  await app.register(channelsRoutes, { prefix: "/api/servers/:id/notifications/channels" });
}
