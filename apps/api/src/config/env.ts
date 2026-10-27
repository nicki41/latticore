import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import { EnvValidationError } from "./env-errors.js";

// Local dev convenience only: loads the repo-root .env (the same file
// docker-compose reads) so `npm run dev` works without exporting vars into
// the shell manually. In Docker, compose injects real environment
// variables directly and no .env file is present in the image, so this is
// a safe no-op there. This file lives at apps/api/src/config (dev) or
// apps/api/dist/config (prod build) — both four levels under the repo root.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(__dirname, "../../../../.env") });

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3000),
    // One origin, or several comma-separated (e.g. a LAN IP and a domain) —
    // the first is the canonical one used for links in notifications. Every
    // listed origin is accepted for CORS and the WebSocket Origin check.
    WEB_ORIGIN: z.string().default("http://localhost:3000"),

    // IANA zone ("Europe/Berlin") the scheduler evaluates cron expressions
    // in, and that's passed on to every Minecraft container so console
    // timestamps match. Unset means the process's own zone — the host's
    // in local dev, UTC inside a container that wasn't given TZ.
    TZ: z
      .string()
      .optional()
      .transform((v) => v?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone)
      .refine(isValidTimeZone, { message: 'TZ must be a valid IANA time zone, e.g. "Europe/Berlin" or "UTC"' }),

    // Which upstream proxies may set X-Forwarded-For (→ request.ip, used for
    // login rate limiting and the audit log). "true" trusts anyone — only
    // safe if the panel is unreachable except through your proxy. The
    // default trusts private-network addresses only (a reverse proxy on the
    // same host/Docker network/LAN), so a client connecting directly can't
    // spoof its IP. Also accepts a comma-separated list of IPs/CIDRs.
    TRUST_PROXY: z
      .string()
      .default("loopback,linklocal,uniquelocal")
      .transform((v): boolean | string => {
        const value = v.trim();
        if (value === "true") return true;
        if (value === "false" || value === "") return false;
        return value;
      }),

    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

    SESSION_SECRET: z.string().min(16, "SESSION_SECRET must be at least 16 characters (openssl rand -hex 32)"),
    COOKIE_SECURE: z
      .string()
      .default("true")
      .transform((v) => v !== "false"),

    DOCKER_SOCKET_PATH: z.string().default("/var/run/docker.sock"),
    // Optional on purpose: normally auto-detected at runtime by
    // resolveHostDataPath() (self-inspecting this container's own mounts
    // over the Docker socket) — see apps/api/src/config/hostDataPath.ts.
    // Only set this explicitly for setups where that detection can't work
    // (rootless Docker, Podman, a renamed hostname, ...).
    HOST_DATA_PATH: z
      .string()
      .min(1)
      .refine((p) => p !== "." && !p.startsWith("./") && !p.startsWith("../"), {
        message:
          "HOST_DATA_PATH must be an absolute path as seen by the Docker host, not a relative one — see docs/configuration.md",
      })
      .optional(),
    DATA_PATH: z.string().default("/data"),
    MINECRAFT_IMAGE: z.string().default("itzg/minecraft-server:latest"),
    MINECRAFT_NETWORK: z.string().default("latticore_mc_net"),

    MC_PORT_RANGE_MIN: z.coerce.number().int().min(1).max(65535).default(25565),
    MC_PORT_RANGE_MAX: z.coerce.number().int().min(1).max(65535).default(25664),

    MODRINTH_API_URL: z.string().url().default("https://api.modrinth.com/v2"),
    MODRINTH_USER_AGENT: z.string().default("latticore/0.1.0 (github.com/nicki41/latticore)"),

    // Optional on purpose: web push is a layered-on feature, not a hard
    // dependency — with these unset, webPushSender logs a warning once and
    // the dispatcher just skips push sends instead of failing to boot.
    // Generate a pair with `npx web-push generate-vapid-keys`.
    VAPID_PUBLIC_KEY: z.string().optional(),
    VAPID_PRIVATE_KEY: z.string().optional(),
    // mailto: address or https:// URL identifying the sender, per the Web
    // Push protocol's VAPID "sub" claim — push services (Chrome, etc.) use
    // this to contact you if this server's pushes need to be throttled/blocked.
    VAPID_SUBJECT: z.string().optional(),
  })
  .refine((e) => e.MC_PORT_RANGE_MIN <= e.MC_PORT_RANGE_MAX, {
    message: "MC_PORT_RANGE_MIN must be <= MC_PORT_RANGE_MAX",
    path: ["MC_PORT_RANGE_MIN"],
  })
  .transform((e) => {
    const origins = e.WEB_ORIGIN.split(",")
      .map((o) => o.trim().replace(/\/+$/, ""))
      .filter(Boolean);
    return { ...e, WEB_ORIGIN: origins[0] ?? "http://localhost:3000", WEB_ORIGINS: origins };
  });

export type Env = z.infer<typeof envSchema>;
export { EnvValidationError } from "./env-errors.js";

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) throw new EnvValidationError(result.error.issues);
  return result.data;
}

// Deliberately NOT a process.exit() here: this module is imported by plain
// unit tests too (e.g. session.test.ts), and an import-time process.exit
// would kill the whole test run instead of just failing one file. The one
// real entry point (server.ts) is what turns a failure into a clean exit.
export const env = loadEnv();
