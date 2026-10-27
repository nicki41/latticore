import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../../config/env.js";

export const SESSION_COOKIE_NAME = "latticore_session";
/** The session cookie's name before the rename — still accepted, so an update doesn't sign everyone out. */
const LEGACY_SESSION_COOKIE_NAME = "mcpanel_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const REFRESH_THRESHOLD_MS = 15 * 24 * 60 * 60 * 1000; // extend once half-consumed

export const PENDING_2FA_COOKIE_NAME = "latticore_pending_2fa";
const PENDING_2FA_TTL_MS = 5 * 60 * 1000;

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function sessionExpiryFromNow(): Date {
  return new Date(Date.now() + SESSION_TTL_MS);
}

/** Sliding expiration: refresh once a session is more than halfway to expiring, instead of on every request. */
export function shouldRefreshSession(expiresAt: Date): boolean {
  return expiresAt.getTime() - Date.now() < REFRESH_THRESHOLD_MS;
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
    signed: true,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
  reply.clearCookie(LEGACY_SESSION_COOKIE_NAME, { path: "/" });
}

/** Returns the raw (unhashed) session token from the request's signed cookie, or null if absent/tampered. */
export function readSessionToken(request: FastifyRequest): string | null {
  const raw = request.cookies[SESSION_COOKIE_NAME] ?? request.cookies[LEGACY_SESSION_COOKIE_NAME];
  if (!raw) return null;
  const unsigned = request.unsignCookie(raw);
  return unsigned.valid && unsigned.value ? unsigned.value : null;
}

export function getClientIp(request: FastifyRequest): string | null {
  return request.ip ?? null;
}

/**
 * Identifies which user is mid-login after a correct password but before
 * their TOTP code — a separate, short-lived, signed cookie so a stolen or
 * lingering value can't be used to skip the second factor (it only carries
 * a userId, not an authenticated session).
 */
export function setPending2faCookie(reply: FastifyReply, userId: string): void {
  reply.setCookie(PENDING_2FA_COOKIE_NAME, userId, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    maxAge: PENDING_2FA_TTL_MS / 1000,
    signed: true,
  });
}

export function readPending2faUserId(request: FastifyRequest): string | null {
  const raw = request.cookies[PENDING_2FA_COOKIE_NAME];
  if (!raw) return null;
  const unsigned = request.unsignCookie(raw);
  return unsigned.valid && unsigned.value ? unsigned.value : null;
}

export function clearPending2faCookie(reply: FastifyReply): void {
  reply.clearCookie(PENDING_2FA_COOKIE_NAME, { path: "/" });
}
