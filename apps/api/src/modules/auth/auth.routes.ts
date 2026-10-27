import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  changePasswordSchema,
  disableTotpSchema,
  enableTotpSchema,
  loginSchema,
  setupAdminSchema,
  verifyTotpLoginSchema,
} from "@latticore/shared";
import { AuditAction } from "../audit/audit.service.js";
import { toAuthenticatedUser, type AuthenticatedUser } from "./auth.service.js";
import {
  clearPending2faCookie,
  clearSessionCookie,
  readPending2faUserId,
  readSessionToken,
  setPending2faCookie,
  setSessionCookie,
} from "./session.js";
import { UnauthenticatedError } from "../../lib/errors.js";

function serializeUser(user: AuthenticatedUser) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    isOwner: user.isOwner,
    totpEnabled: user.totpEnabled,
    roles: user.roles,
    permissions: [...user.permissions],
  };
}

function sessionContextOf(request: FastifyRequest) {
  return { ipAddress: request.ip ?? null, userAgent: request.headers["user-agent"] ?? null };
}

export async function authRoutes(fastify: FastifyInstance) {
  fastify.get("/csrf", async (_request, reply) => {
    // Never let a proxy/CDN cache this — a cached response would hand out
    // the same secret-derived token to every visitor behind that cache.
    reply.header("Cache-Control", "no-store");
    return reply.send({ csrfToken: await reply.generateCsrf() });
  });

  fastify.get("/me", async (request, reply) => {
    if (request.user) {
      return reply.send({ user: serializeUser(request.user), setupRequired: false });
    }
    const setupRequired = !(await fastify.authService.hasAnyUser());
    return reply.send({ user: null, setupRequired });
  });

  fastify.post(
    "/setup",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const input = setupAdminSchema.parse(request.body);
      const { user, token } = await fastify.authService.createFirstAdmin(input, sessionContextOf(request));

      setSessionCookie(reply, token);
      await fastify.audit.record(AuditAction.AUTH_SETUP_ADMIN_CREATED, {
        userId: user.id,
        ipAddress: request.ip,
      });

      return reply.status(201).send({ user: serializeUser(toAuthenticatedUser(user)) });
    },
  );

  fastify.post(
    "/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const input = loginSchema.parse(request.body);

      try {
        const result = await fastify.authService.login(input, sessionContextOf(request));

        if (result.requiresTotp) {
          setPending2faCookie(reply, result.userId);
          return reply.send({ requiresTotp: true });
        }

        setSessionCookie(reply, result.token);
        await fastify.audit.record(AuditAction.AUTH_LOGIN, { userId: result.user.id, ipAddress: request.ip });
        return reply.send({ requiresTotp: false, user: serializeUser(toAuthenticatedUser(result.user)) });
      } catch (err) {
        await fastify.audit.record(AuditAction.AUTH_LOGIN_FAILED, {
          ipAddress: request.ip,
        }, { attemptedUsernameOrEmail: input.usernameOrEmail });
        throw err;
      }
    },
  );

  fastify.post(
    "/login/verify-totp",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { code } = verifyTotpLoginSchema.parse(request.body);
      const userId = readPending2faUserId(request);
      if (!userId) throw new UnauthenticatedError("Your two-factor session has expired — please log in again.");

      try {
        const { user, token } = await fastify.authService.verifyTotpLogin(userId, code, sessionContextOf(request));
        clearPending2faCookie(reply);
        setSessionCookie(reply, token);
        await fastify.audit.record(AuditAction.AUTH_LOGIN, { userId: user.id, ipAddress: request.ip });
        return reply.send({ user: serializeUser(toAuthenticatedUser(user)) });
      } catch (err) {
        await fastify.audit.record(AuditAction.AUTH_LOGIN_FAILED, { userId, ipAddress: request.ip }, { reason: "bad_totp_code" });
        throw err;
      }
    },
  );

  fastify.post("/logout", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const token = readSessionToken(request);
    if (token) await fastify.authService.logout(token);
    clearSessionCookie(reply);
    await fastify.audit.record(AuditAction.AUTH_LOGOUT, { userId: request.user!.id, ipAddress: request.ip });
    return reply.status(204).send();
  });

  fastify.post("/change-password", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const input = changePasswordSchema.parse(request.body);
    const token = readSessionToken(request)!;
    await fastify.authService.changePassword(request.user!.id, input, token);
    await fastify.audit.record(AuditAction.AUTH_PASSWORD_CHANGED, {
      userId: request.user!.id,
      ipAddress: request.ip,
    });
    return reply.status(204).send();
  });

  fastify.get("/sessions", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const sessions = await fastify.authService.listSessions(request.user!.id, readSessionToken(request));
    return reply.send({ sessions });
  });

  fastify.post("/totp/setup", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const result = await fastify.authService.setupTotp(request.user!.id);
    return reply.send(result);
  });

  fastify.post("/totp/enable", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const { code } = enableTotpSchema.parse(request.body);
    const result = await fastify.authService.enableTotp(request.user!.id, code);
    await fastify.audit.record(AuditAction.AUTH_2FA_ENABLED, { userId: request.user!.id, ipAddress: request.ip });
    return reply.send(result);
  });

  fastify.post("/totp/disable", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const { password } = disableTotpSchema.parse(request.body);
    await fastify.authService.disableTotp(request.user!.id, password);
    await fastify.audit.record(AuditAction.AUTH_2FA_DISABLED, { userId: request.user!.id, ipAddress: request.ip });
    return reply.status(204).send();
  });

  fastify.delete("/sessions/:id", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await fastify.authService.revokeSession(request.user!.id, id);
    return reply.status(204).send();
  });
}
