# Features

A tour of everything Latticore does. For setup, see the [main README](../README.md); for the technical reasoning behind any of this, see [architecture.md](architecture.md).

## Table of contents

- [Dashboard](#dashboard)
- [Server creation wizard](#server-creation-wizard)
- [Live console](#live-console)
- [File manager](#file-manager)
- [Players](#players)
- [Plugins & mods (Modrinth)](#plugins--mods-modrinth)
- [Backups](#backups)
- [Scheduler](#scheduler)
- [Proxy networks](#proxy-networks)
- [Port allocations](#port-allocations)
- [Notifications](#notifications)
- [Users, roles & audit log](#users-roles--audit-log)
- [Account security](#account-security)
- [PWA & mobile](#pwa--mobile)

## Dashboard

Every server at a glance: status, uptime, online player count, ip:port, software/version, and a live load sparkline. Filter by online/offline or by Minecraft version, switch between a card grid and a dense table, and jump straight into a server from its card.

## Server creation wizard

A six-step wizard — name, software, version, resources, port, confirm — from a bare name to a running server. **Vanilla, Paper, Fabric, Forge and NeoForge** game servers and **Velocity and BungeeCord** proxies are all installed by the panel itself, live against each project's own metadata API (Mojang Piston-Meta, PaperMC, Fabric Meta, Forge/NeoForge Maven, SpigotMC Jenkins) rather than delegating to a third-party image: jars are downloaded and hash-verified directly, and Forge/NeoForge's installer program is SHA-256-verified and then run in a throwaway, locked-down container (see [architecture.md#server-creation-flow](architecture.md#server-creation-flow)).

RAM/CPU limits and an optional disk limit are set in the wizard (and editable later from Settings). The final step requires explicitly accepting Mojang's EULA — the panel refuses to boot a server otherwise, matching the real legal requirement, and never accepts it on your behalf.

An existing server can be **reinstalled or moved to another Minecraft version** later from **Settings → Danger zone** — worlds, configs and plugins/mods stay, only the server software is replaced.

## Live console

A real attached stdin/stdout console for panel-managed servers — not a third-party RCON wrapper. Commands typed here go straight to the Minecraft process; the same channel backs moderation actions and the live player list. See [architecture.md#console-attached-stdin-not-rcon](architecture.md#console-attached-stdin-not-rcon) for why this matters.

## File manager

A full file browser with a Monaco (VS Code) editor — the same editor, the same syntax highlighting, right in the browser. Create, rename, move, copy, zip/unzip, and edit anything in the server's data directory, including `server.properties` with inline validation.

## Players

Playtime, session history, last-seen, and last-known IP per player, tracked from live server log output — not just whatever `ops.json`/`whitelist.json`/`banned-players.json` currently say. Whitelist, op, kick, and ban actions are one click away.

## Plugins & mods (Modrinth)

Search and install plugins/mods straight from the panel, matched automatically to the server's actual loader (Paper/Fabric/Velocity/...) and Minecraft version — no manually hunting for a compatible build.

[UniversalAdmin](https://modrinth.com/collection/DrMT8zro) — a free all-in-one admin plugin for Paper and Velocity networks, with its official extensions — is recommended at the top of both the Modrinth page and a server's Plugins tab (only where the server can load it), installable in one click. The list is loaded live from the Modrinth collection, so new extensions show up without a panel update.

## Backups

A `tar` archive of the server's entire data directory, stored outside that directory so a restore can never overwrite the archive it's restoring from. Create, download, restore, lock, or delete from one list.

- **Safe while running** — autosave is paused and the world flushed to disk (`save-off` / `save-all flush`) for the duration of the archive, then resumed.
- **Retention** — optionally keep only the newest *N* backups; older ones are deleted after each new backup, manual or scheduled.
- **Locking** — a locked backup never counts toward retention and can't be deleted until unlocked.
- **Crash-safe restore** — the archive is extracted to a staging directory first and swapped in only once it fully succeeded; a corrupt archive leaves the current files untouched.

## Scheduler

Cron-driven workflows of ordered steps — console commands, start/stop/restart, or a backup — each with an optional delay before the next step runs. Point it at a nightly backup, a scheduled restart, or a `say` announcement before one. Schedules run in the panel's configured time zone (`TZ`), DST included — the editor shows the next runs in that zone.

## Proxy networks

Create a **Velocity** or **BungeeCord** server from the same wizard (the "Proxy" group), then open its **Network** tab and add servers to it. For every server you add, the panel does everything a proxy setup normally needs by hand:

- configures player forwarding on the backend — Velocity's signed *modern* forwarding with a generated shared secret, or BungeeCord's IP forwarding — and turns its own login check (`online-mode`) off, since the proxy authenticates players;
- takes the backend's port off the host, so nobody can connect to it around the proxy (it stays reachable for the proxy over the internal Docker network);
- writes the proxy's server list and join order (`velocity.toml` / `config.yml`) and reloads a running proxy live.

Reorder servers to choose where players land first, remove one to make it standalone again (online-mode and the published port come back). The **Networks** page lists every proxy with the servers behind it; a backend's own header shows which network it belongs to and that it's only reachable via the proxy. Automatic setup covers Paper backends (Velocity needs Paper 1.13+); other servers are listed with the reason they can't be added. See [operations.md#proxy-networks](operations.md#proxy-networks).

## Port allocations

Open extra ports per server — a Dynmap/BlueMap web view, a voice-chat plugin, Geyser for Bedrock cross-play — from one instance-wide page, with automatic no-duplicate enforcement across every server's primary port and every allocation. See [operations.md#port-allocations](operations.md#port-allocations).

## Notifications

Two independent delivery mechanisms sharing one fixed set of categories (server status, player activity, crashes, backups, high memory usage, new version available):

- **Web push**, per user per server — standard VAPID Web Push, works out of the box with zero configuration (the panel generates and persists its own keypair on first boot), including on iOS 16.4+ as an installed PWA.
- **External service channels**, per server — Discord, Telegram, Slack, or a generic webhook, for cases like a community Discord where everyone should see the message regardless of who's logged into the panel. Secrets are encrypted at rest and only visible to users with full (not view-only) access to that server.

## Users, roles & audit log

Two-layer RBAC — a fixed set of global permissions per role (`Owner`/`Admin`/`Manager`/`Moderator`/`Viewer`, or a custom role you define), plus a per-server access level (`Full` or `View only`) that narrows the server-scoped subset of those permissions down for one specific server. Every meaningful action across the panel lands in the audit log.

## Account security

Argon2id password hashing, and optional TOTP two-factor authentication with a standard authenticator app (Google Authenticator, Aegis, 1Password, ...) — set up per account under Settings.

## PWA & mobile

The panel is an installable Progressive Web App — add it to your home screen on iOS/Android or install it as a standalone window on desktop, complete with app icon, splash screen, and offline-tolerant shell. The whole UI is responsive down to phone width, with an off-canvas sidebar instead of a squeezed desktop layout.
