import type { FastifyReply, FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";
import {
  clearSessionCookie,
  generateSessionToken,
  hashSessionToken,
  readSessionToken,
  SESSION_COOKIE_NAME,
  sessionExpiryFromNow,
  shouldRefreshSession,
} from "./session.js";

describe("generateSessionToken", () => {
  it("produces a long, high-entropy, url-safe token", () => {
    const token = generateSessionToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/); // 32 random bytes, hex-encoded
  });

  it("never repeats across calls", () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateSessionToken()));
    expect(tokens.size).toBe(1000);
  });
});

describe("hashSessionToken", () => {
  it("is deterministic for the same input", () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
  });

  it("produces different hashes for different tokens", () => {
    expect(hashSessionToken(generateSessionToken())).not.toBe(hashSessionToken(generateSessionToken()));
  });

  it("never returns the raw token itself (the whole point of hashing it before storage)", () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token)).not.toBe(token);
  });
});

describe("sessionExpiryFromNow / shouldRefreshSession", () => {
  it("creates an expiry roughly 30 days in the future", () => {
    const expiry = sessionExpiryFromNow();
    const days = (expiry.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });

  it("does not refresh a freshly created session", () => {
    expect(shouldRefreshSession(sessionExpiryFromNow())).toBe(false);
  });

  it("refreshes a session that is more than halfway to expiring", () => {
    const almostExpired = new Date(Date.now() + 24 * 60 * 60 * 1000); // 1 day left
    expect(shouldRefreshSession(almostExpired)).toBe(true);
  });

  it("refreshes an already-expired session too", () => {
    const expired = new Date(Date.now() - 1000);
    expect(shouldRefreshSession(expired)).toBe(true);
  });
});

/** Just the slice of FastifyRequest readSessionToken uses; "signed" values are prefixed with "ok:". */
function requestWith(cookies: Record<string, string>): FastifyRequest {
  return {
    cookies,
    unsignCookie: (raw: string) => (raw.startsWith("ok:") ? { valid: true, renew: false, value: raw.slice(3) } : { valid: false, renew: false, value: null }),
  } as unknown as FastifyRequest;
}

describe("readSessionToken / clearSessionCookie", () => {
  it("reads the current cookie", () => {
    expect(SESSION_COOKIE_NAME).toBe("latticore_session");
    expect(readSessionToken(requestWith({ latticore_session: "ok:new-token" }))).toBe("new-token");
  });

  it("still accepts the cookie from before the rename, so an update doesn't sign anyone out", () => {
    expect(readSessionToken(requestWith({ mcpanel_session: "ok:old-token" }))).toBe("old-token");
  });

  it("prefers the current cookie when both are present", () => {
    expect(readSessionToken(requestWith({ latticore_session: "ok:new-token", mcpanel_session: "ok:old-token" }))).toBe("new-token");
  });

  it("rejects a tampered cookie under either name", () => {
    expect(readSessionToken(requestWith({ latticore_session: "forged" }))).toBeNull();
    expect(readSessionToken(requestWith({ mcpanel_session: "forged" }))).toBeNull();
    expect(readSessionToken(requestWith({}))).toBeNull();
  });

  it("signing out clears both names", () => {
    const reply = { clearCookie: vi.fn() } as unknown as FastifyReply;
    clearSessionCookie(reply);
    expect(vi.mocked(reply.clearCookie).mock.calls.map(([name]) => name)).toEqual(["latticore_session", "mcpanel_session"]);
  });
});
