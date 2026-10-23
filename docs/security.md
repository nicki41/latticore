# Security

## Threat model notice

This panel grants the api container access to the host's Docker socket — that is **functionally equivalent to root on the host** if the api process is ever compromised. Given that:

- Only run it in a trusted, **single-tenant** environment (one operator, one organization) — not as multi-tenant SaaS without additional isolation (e.g. a separate VM per customer).
- Put the panel behind a TLS-terminating reverse proxy (`COOKIE_SECURE=true`); don't expose it directly over plain HTTP.
- Treat `SESSION_SECRET` like a root password.

## Hardening in place

Checked against the OWASP Top 10-relevant categories:

| Area | Implementation |
|---|---|
| Authentication | Argon2id password hashing; constant-time login comparison (a dummy hash is checked for unknown usernames, preventing user enumeration via timing); signed, httpOnly session cookies with sliding expiration |
| Authorization / RBAC | Every route checks the required permission server-side, plus per-server access level where relevant; privilege-escalation guards stop non-Owners from granting the Owner role or permissions they don't hold themselves (see `roles.service.ts` / `users.service.ts` and their tests). Details: [architecture.md](architecture.md#access-control-rbac) |
| CSRF | `@fastify/csrf-protection`, token bound to a separate secret cookie (not the session), enforced on every mutating `/api` route |
| Path traversal | Every file access goes through `safeResolve()` — a syntactic check against `../`/absolute paths, plus a runtime check against symlink escapes via `fs.realpath` |
| ZIP uploads | Protected against zip-slip (every entry path is checked against the target directory) and decompression bombs (caps on entry count and total size) |
| Command injection | Player names and console commands are validated and stripped of newlines before being sent to the server process — over a raw stdin attach for panel-managed servers, or RCON (a binary protocol, not a shell invocation) for the legacy path |
| SSRF | File downloads from Modrinth are restricted server-side to `https://cdn.modrinth.com` (hostname allowlist), checked before any fetch is made; the panel's own install pipeline restricts downloads to a fixed allowlist of upstream hosts (`piston-data.mojang.com`, `fill-data.papermc.io`, `meta.fabricmc.net`, `maven.minecraftforge.net`, `maven.neoforged.net`), same pattern. Redirects are followed by hand and every hop is re-checked against the same allowlist — a trusted host can't bounce a download somewhere else |
| Supply chain (installers) | Forge/NeoForge installers are code the panel executes, so their published SHA-256 is mandatory (the install fails without one). They run in a throwaway container with the same lockdown as a server container — non-root, `CapDrop: ALL`, `no-new-privileges`, memory/PID limits — and are removed afterwards |
| HTTP security headers | `@fastify/helmet`: a strict Content-Security-Policy (`script-src 'self'`, no inline scripts, `frame-ancestors 'none'`, `object-src 'none'`), `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, COOP/CORP, and HSTS whenever `COOKIE_SECURE=true` |
| Client IP / proxies | `X-Forwarded-For` is only honored from `TRUST_PROXY` addresses (default: private networks only), so a client connecting directly can't spoof its IP to dodge login rate limiting or falsify the audit log |
| Dependencies | `npm audit` clean except build-time-only tooling; Dependabot opens weekly update PRs, and the published images are rebuilt weekly so base-image (Node, Debian, Temurin) security patches land without a code change |
| Docker API abuse | All Minecraft containers run with `no-new-privileges`, a fixed `PidsLimit`, and explicit memory/CPU limits. Panel-managed containers additionally run with `CapDrop: ALL` and a fixed non-root uid/gid (1000:1000) baked into the image — the panel creates and chowns the data dir itself, so there's no root-at-boot step needed at all. Legacy-path containers keep Docker's default (already-restricted) capability set instead, without an extra `CapDrop: ALL`, since `itzg/docker-minecraft-server` needs `CAP_CHOWN`/`CAP_SETUID`/`CAP_SETGID` etc. for its own root-to-minecraft-user switch in its entrypoint — chasing an exact capability list against that third-party image proved brittle; see the comment in `DockerMinecraftRuntime.ts`. Either way the Minecraft process itself ends up non-root. The frontend has no direct Docker API access — only the API layer does. |
| SQL injection | Exclusively through Prisma (parameterized queries); no raw SQL strings built from user input |
| Rate limiting | The login endpoint is rate-limited to slow down brute-force attempts |
| Secrets at rest | TOTP secrets and `NotificationChannel` config (Discord/Slack webhook URLs, Telegram bot tokens) are encrypted (AES-256-GCM, key derived from `SESSION_SECRET` via a labeled SHA-256 hash — `lib/totpCrypto.ts` / `lib/webhookCrypto.ts`), not stored in plaintext; GET responses for notification channels never include the decrypted config, only whether one is set. Managing these channels requires `servers.settings.edit` (FULL access), not just VIEW_ONLY — see [architecture.md#notifications](architecture.md#notifications) |

## Known, accepted residual risks

- **Docker socket access itself** (see above) — architecturally required for the panel's core function; not further reducible without Docker-in-Docker or a remote Docker API, which would trade "simple and maintainable" for a much larger attack surface and operational burden.
- **Monaco web workers are disabled** for build-compatibility reasons (see the comment in `CodeEditor.tsx`) — a pure feature loss (no extended IntelliSense), not a security issue.
