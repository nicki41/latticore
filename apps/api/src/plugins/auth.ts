import fp from "fastify-plugin";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Server } from "@prisma/client";
import { effectiveServerPermissions, type AccessLevel, type Permission } from "@minecraftpanel/shared";
import { AuthService, type AuthenticatedUser } from "../modules/auth/auth.service.js";
import { readSessionToken } from "../modules/auth/session.js";
import { ForbiddenError, NotFoundError, UnauthenticatedError } from "../lib/errors.js";

declare module "fastify" {
  interface FastifyInstance {
    authService: AuthService;
    /** Throws UnauthenticatedError unless the request has a valid session. */
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Throws unless the user holds `permission` globally (or is Owner). */
    requirePermission: (permission: Permission) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /**
     * Throws unless the user holds `permission` on the :id server route param,
     * after combining their role permissions with their ServerAccess level.
     * Attaches request.mcServer and request.serverAccessLevel for handlers.
     */
    requireServerAccess: (permission: Permission) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    user: AuthenticatedUser | null;
    // Named mcServer (not `server`) because Fastify already exposes the
    // owning FastifyInstance as `request.server` — reusing that name would
    // silently shadow a core property instead of erroring.
    mcServer?: Server;
    serverAccessLevel?: "FULL" | "VIEW_ONLY" | null;
  }
}

export default fp(async (fastify: FastifyInstance) => {
  fastify.decorate("authService", new AuthService(fastify.prisma));
  fastify.decorateRequest("user", null);
  fastify.decorateRequest("mcServer", undefined);
  fastify.decorateRequest("serverAccessLevel", undefined);

  fastify.addHook("onRequest", async (request) => {
    const url = request.raw.url ?? "";
    // /ws too: the live console/stats socket reuses requireServerAccess,
    // which needs request.user resolved the same way REST routes get it.
    if (!url.startsWith("/api") && !url.startsWith("/ws")) return;

    const token = readSessionToken(request);
    request.user = token ? await fastify.authService.getUserFromToken(token) : null;
  });

  // Expired sessions are already rejected on use; this only keeps the table
  // from growing forever with rows nobody can use anymore.
  const pruneExpiredSessions = () =>
    fastify.prisma.session
      .deleteMany({ where: { expiresAt: { lt: new Date() } } })
      .catch((err) => fastify.log.warn({ err }, "Failed to prune expired sessions"));
  const pruneTimer = setInterval(pruneExpiredSessions, 60 * 60 * 1000);
  pruneTimer.unref?.();
  fastify.addHook("onReady", async () => {
    await pruneExpiredSessions();
  });
  fastify.addHook("onClose", async () => clearInterval(pruneTimer));

  fastify.decorate("requireAuth", async (request: FastifyRequest) => {
    if (!request.user) throw new UnauthenticatedError();
  });

  fastify.decorate("requirePermission", (permission: Permission) => {
    return async (request: FastifyRequest) => {
      if (!request.user) throw new UnauthenticatedError();
      if (!request.user.isOwner && !request.user.permissions.has(permission)) {
        throw new ForbiddenError();
      }
    };
  });

  fastify.decorate("requireServerAccess", (permission: Permission) => {
    return async (request: FastifyRequest) => {
      if (!request.user) throw new UnauthenticatedError();

      const serverId = (request.params as Record<string, string | undefined>).id;
      if (!serverId) throw new NotFoundError("Server not found.");

      const server = await fastify.prisma.server.findUnique({ where: { id: serverId } });
      if (!server) throw new NotFoundError("Server not found.");

      if (request.user.isOwner) {
        request.mcServer = server;
        request.serverAccessLevel = "FULL";
        return;
      }

      const access = await fastify.prisma.serverAccess.findUnique({
        where: { userId_serverId: { userId: request.user.id, serverId } },
      });
      // SQLite stores ServerAccess.level as a plain string (no native enum);
      // it's only ever written through setServerAccessSchema, so this is safe.
      const level = (access?.level as AccessLevel | undefined) ?? null;

      const effective = effectiveServerPermissions([...request.user.permissions], level);
      if (!effective.has(permission)) {
        // Same 404 whether the server doesn't exist or the user just can't see it,
        // so unauthorized users can't probe for which server IDs are real.
        throw new NotFoundError("Server not found.");
      }

      request.mcServer = server;
      request.serverAccessLevel = level;
    };
  });
});
