import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import Fastify, { type FastifyBaseLogger } from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyCookie from "@fastify/cookie";
import fastifyCsrf from "@fastify/csrf-protection";
import fastifyHelmet from "@fastify/helmet";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import type { ApiErrorBody } from "@latticore/shared";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import prismaPlugin from "./plugins/prisma.js";
import errorHandlerPlugin from "./plugins/error-handler.js";
import auditPlugin from "./plugins/audit.js";
import authPlugin from "./plugins/auth.js";
import minecraftPlugin from "./plugins/minecraft.js";
import backupsPlugin from "./plugins/backups.js";
import networkPlugin from "./plugins/network.js";
import schedulerPlugin from "./plugins/scheduler.js";
import liveSessionsPlugin from "./plugins/liveSessions.js";
import metricsHistoryPlugin from "./plugins/metricsHistory.js";
import playerActivityPlugin from "./plugins/playerActivity.js";
import notificationsPlugin from "./plugins/notifications.js";
import { registerApiRoutes } from "./modules/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// apps/api/src (dev, via tsx) and apps/api/dist (prod, compiled) are both one
// level under apps/api/, so this resolves to apps/web/dist in both cases.
const WEB_DIST_DIR = path.resolve(__dirname, "../../web/dist");

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function buildApp() {
  const app = Fastify({
    // Cast to the base interface (pino's Logger structurally satisfies it)
    // so Fastify's Logger generic resolves to FastifyBaseLogger instead of
    // being inferred as pino's exact type — otherwise every unparameterized
    // `FastifyInstance` elsewhere in the app stops structurally matching.
    loggerInstance: logger as FastifyBaseLogger,
    trustProxy: env.TRUST_PROXY,
    bodyLimit: 10 * 1024 * 1024, // 10MB JSON bodies; file uploads use multipart with their own limit
  });

  await app.register(errorHandlerPlugin);
  await app.register(prismaPlugin);

  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // Radix/sonner inject <style> elements and the boot splash in
        // index.html uses a style attribute — both legitimate, both inline.
        styleSrc: ["'self'", "'unsafe-inline'"],
        // https: for Modrinth project icons (cdn.modrinth.com and whatever
        // CDN a project links); data:/blob: for the inline favicon and the
        // icon-crop preview.
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        workerSrc: ["'self'", "blob:"],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    // Only meaningful once served over HTTPS (COOKIE_SECURE is the existing
    // "this deployment is behind TLS" switch) — sent over plain HTTP it would
    // be ignored anyway, but there it would also be a lie.
    strictTransportSecurity: env.COOKIE_SECURE ? { maxAge: 15552000, includeSubDomains: false } : false,
    // The SPA loads cross-origin images (Modrinth icons) — the default
    // require-corp would block every one of them.
    crossOriginEmbedderPolicy: false,
  });

  await app.register(fastifyCors, {
    origin: env.NODE_ENV === "production" ? env.WEB_ORIGINS : true,
    credentials: true,
  });

  await app.register(fastifyCookie, { secret: env.SESSION_SECRET });

  await app.register(fastifyRateLimit, { global: false });

  await app.register(fastifyMultipart, {
    limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB ceiling for world/plugin uploads; per-route limits may be tighter
  });

  await app.register(fastifyWebsocket);

  await app.register(fastifyCsrf, {
    // A distinct cookie name (not the "_csrf" default): browsers that
    // already picked up a cookie under the old, unscoped default cookieOpts
    // (before "path" was set explicitly here) would otherwise keep sending
    // BOTH the stale and the corrected "_csrf" cookie on every request —
    // same name, different path, no way for the server to tell them apart
    // (the Cookie header carries no path info) — and whichever one the
    // parser resolves last "wins" unpredictably, reintroducing "Missing csrf
    // secret" for anyone who loaded the app before this fixed config
    // shipped. A rename sidesteps the collision entirely; the old cookie is
    // simply ignored from here on and expires on its own. Deliberately NOT
    // renamed with the project: the SPA fetches its token once per page
    // load, so a new name would fail every tab left open across an update.
    cookieKey: "mcpanel_csrf",
    // cookieOpts REPLACES the plugin's own default entirely (shallow
    // Object.assign, not a merge) — httpOnly must be repeated here or it's
    // silently lost.
    cookieOpts: { signed: true, httpOnly: true, sameSite: "lax", path: "/", secure: env.COOKIE_SECURE },
    sessionPlugin: "@fastify/cookie",
  });

  // CSRF protection on every state-changing /api request. Tied to a secret
  // cookie (not the user session), so it also covers login/setup before any
  // session exists. The frontend fetches a token from GET /api/auth/csrf on
  // boot and sends it back as the x-csrf-token header.
  app.addHook("onRequest", (request, reply, done) => {
    const url = request.raw.url ?? "";
    if (!url.startsWith("/api") || !MUTATING_METHODS.has(request.method)) return done();
    app.csrfProtection(request, reply, done);
  });

  await app.register(auditPlugin);
  await app.register(authPlugin);
  await app.register(minecraftPlugin);
  await app.register(backupsPlugin);
  await app.register(networkPlugin);
  await app.register(schedulerPlugin);
  await app.register(liveSessionsPlugin);
  await app.register(metricsHistoryPlugin);
  await app.register(playerActivityPlugin);
  await app.register(notificationsPlugin);

  await registerApiRoutes(app);

  const webDistExists = existsSync(WEB_DIST_DIR);
  if (webDistExists) {
    await app.register(fastifyStatic, { root: WEB_DIST_DIR, wildcard: false });
  } else {
    app.log.warn(`Web build not found at ${WEB_DIST_DIR} — API-only mode (expected during local dev with Vite).`);
  }

  app.setNotFoundHandler((request, reply) => {
    const url = request.raw.url ?? "";
    if (url.startsWith("/api") || url.startsWith("/ws")) {
      const body: ApiErrorBody = {
        error: { code: "NOT_FOUND", message: `Route not found: ${request.method} ${url}` },
      };
      return reply.status(404).send(body);
    }
    // SPA fallback for client-side routes only. A missing *file* (e.g. a JS
    // chunk an open tab still references after an update) gets a real 404 —
    // answering it with index.html makes the browser fail with a confusing
    // MIME-type error instead.
    const pathname = url.split("?")[0] ?? "";
    if (webDistExists && request.method === "GET" && !/\.[a-z0-9]+$/i.test(pathname)) {
      return reply.sendFile("index.html");
    }
    const body: ApiErrorBody = { error: { code: "NOT_FOUND", message: "Not found" } };
    return reply.status(404).send(body);
  });

  return app;
}
