# Operations

Day-to-day running of the panel: first admin setup, backups, updates, and troubleshooting. For initial installation, see the [main README](../README.md).

## Table of contents

- [First admin account](#first-admin-account)
- [Port allocations](#port-allocations)
- [Backups](#backups)
- [Reinstalling or changing a server's version](#reinstalling-or-changing-a-servers-version)
- [Proxy networks](#proxy-networks)
- [Installing the panel as an app (PWA)](#installing-the-panel-as-an-app-pwa)
- [Updates](#updates)
- [Troubleshooting](#troubleshooting)

## First admin account

On the very first visit to `http://localhost:3000`, the panel detects that no user exists yet and shows a setup wizard for creating the first admin account (the `Owner` role, with every permission). The endpoint behind it, `POST /api/auth/setup`, only works server-side **while the database has zero users** — once the first account is created it's permanently locked, regardless of what the frontend shows. See the main README's [First-time setup](../README.md#first-time-setup) for a full walkthrough from this point through creating your first server.

Additional users are created afterwards under **Admin → Users** by an Owner/Admin, including role assignment and optional per-server access (full or view-only, per server).

**Lost the only admin account's password?** There's no self-service "forgot password" flow (a deliberate scope cut — see [security.md](security.md) for the rest of what is and isn't in place). Recovery means going straight to the database: stop the panel (`docker compose down`), open `data/db.sqlite` with any SQLite client (or run `docker compose run --rm api npx prisma studio` from the repo, pointed at that file), and either update the `User.passwordHash` column directly (needs an Argon2id hash, e.g. produced by a one-off Node script using this project's own `@node-rs/argon2` dependency) or, if you're comfortable losing that account's history, delete its row entirely — the setup wizard reopens the moment the `User` table is empty again. Either way, restart the panel afterward.

## Port allocations

Every server gets one **primary port** (the actual Minecraft protocol port, shown as `ip:port` on its card) — chosen automatically from `MC_PORT_RANGE_MIN`–`MC_PORT_RANGE_MAX` at creation time (see [configuration.md](configuration.md)), or set explicitly if you passed one in the creation request. That part hasn't changed.

**Allocations** are *additional* ports a server can publish — for a web-based map (Dynmap/BlueMap), a voice-chat plugin, Geyser (Bedrock cross-play), a query port, or anything else a plugin/mod wants to listen on. Manage them from **Allocations** in the main sidebar — a main-page view listing every server you can see, not something buried in that server's own settings, since picking ports is really an instance-wide concern (nothing can collide with anything else you're running).

- **Adding one**: pick the server's card, type a port, submit. The panel checks it isn't already in use — as another server's primary port, another server's allocation, or this server's own primary port — before accepting it. That check is enforced server-side (a `409 Conflict` if it collides), not just in the UI.
- **Removing one**: click the `×` on its chip. No confirmation dialog — it's a reversible, low-stakes action (you can always re-add the same port).
- **Applying it**: like a RAM/CPU change, a new or removed allocation is baked into the server's Docker container at (re)creation time — it takes effect the next time that specific server restarts, not instantly. The panel tells you this when you add/remove one.
- **Protocol**: each extra port is published for both TCP and UDP, host port equal to container port — the panel has no way to know which protocol a given plugin actually needs, so it opens both rather than guessing.

Removing a server's underlying container (delete, or any Docker-level container recreation) also removes its allocation rows via a cascading delete — there's nothing to clean up by hand.

## Backups

Every server has a **Backups** tab. A backup is a `tar` archive of the server's entire data directory, stored under `data/backups/<serverId>/` — deliberately **outside** the server's own data directory, so a restore can never overwrite the archive it's restoring from.

- **Create**: works any time, including while the server is running — the panel pauses autosave and flushes the world to disk (`save-off` + `save-all flush`) before archiving and re-enables autosave (`save-on`) afterwards, so the snapshot is consistent. Only one backup or restore runs per server at a time.
- **Retention**: turn on *Delete old backups automatically* to keep only the newest *N* unlocked backups; the oldest are deleted after each new one (manual or scheduled).
- **Lock**: a locked backup is exempt from retention and can't be deleted until unlocked — use it for "before the big update" snapshots.
- **Restore**: requires a stopped server; replaces the entire data directory with the backup's contents. The archive is extracted to a staging directory first and only swapped in once extraction succeeded, so a corrupt archive leaves the current files untouched.
- **Delete**: removes only the archive file, never the live data directory.

For offsite protection, periodically back up the whole `data/` folder externally as well (e.g. `rsync`/`restic` from the host) — the built-in backup feature is not a substitute for an external 3-2-1 backup strategy. Since the SQLite database (`data/db.sqlite`, plus its `-wal`/`-shm` companion files under WAL mode) also lives in this folder, an external `data/` backup automatically covers users, roles, the audit log, and server metadata too — ideally stop the api container briefly first so the SQLite files aren't being written to mid-copy.

## Reinstalling or changing a server's version

**Settings → Danger zone → Reinstall or change version** (needs the `servers.reinstall` permission and FULL access; the server must be stopped):

- **Same version** — re-runs the install and picks up the newest build/loader for it, e.g. after an *update available* notification (a newer Paper build, Forge/NeoForge loader). Also the way out of an install that failed or was interrupted.
- **Another version** — switches the Minecraft version for the same software. Upgrading is normal; **downgrading can corrupt worlds** that were already opened in the newer version, so take (and lock) a backup first.

Worlds, `server.properties`, configs and plugins/mods are kept — only the server jar/libraries and the launch script are replaced. Plugins/mods built for the old version may need updating on the **Plugins/Mods** tab afterwards.

## Proxy networks

1. **Create the proxy**: Create Server → *Proxy* → **Velocity** (recommended) or **BungeeCord** (for networks that include servers older than 1.13). 1 GB of RAM is plenty for a small network. The proxy's port is the address players join.
2. **Add servers**: open the proxy's **Network** tab → **Add server**, pick a Paper server and a name (players switch with `/server <name>`). The first server in the list is where players land.
3. **Restart what the panel tells you to**: a running backend needs one restart to pick up forwarding and to drop its public port; Velocity reloads its server list live, BungeeCord needs a restart after a server was *removed* (its reload can only add servers).

What the panel changes on a backend, so you know where to look:

| File | Velocity | BungeeCord |
|---|---|---|
| `server.properties` | `online-mode=false` | `online-mode=false` |
| `config/paper-global.yml` (1.19+) / `paper.yml` (older) | `proxies.velocity.enabled: true`, the proxy's `secret` | `proxies.velocity.enabled: false` |
| `spigot.yml` | `settings.bungeecord: false` | `settings.bungeecord: true` |

On the proxy it owns `bind`, the forwarding mode and the `[servers]`/`[forced-hosts]` tables of `velocity.toml` (or `listeners[0].host/priorities`, `servers` and `ip_forward` in BungeeCord's `config.yml`) — everything else in those files stays yours to edit in the file manager. Velocity's `forwarding.secret` is generated once and reused.

Removing a server from the network, or deleting the proxy, returns every affected backend to standalone (online-mode back on, port published again on its next start). Deleting a backend removes it from the proxy's list.

**Why the backend's port is hidden**: with `online-mode=false` a backend trusts whatever identity the proxy forwards. With BungeeCord's IP forwarding anyone who reaches the backend directly could claim to be any player — so backends in a network are only reachable from the proxy, over the Docker network (`mcpanel-<name>:25565` inside the proxy container).

## Installing the panel as an app (PWA)

The frontend ships a web app manifest and service worker (`apps/web/public/manifest.json` / `sw.js`), so any modern browser can install it as a standalone app instead of just bookmarking a tab — icon, splash screen, its own window, no browser chrome.

- **Android / desktop Chrome or Edge**: an install icon appears in the address bar, or use the browser menu → "Install Latticore".
- **iOS 16.4+ / iPadOS Safari**: Share → **Add to Home Screen**. Web push notifications only work from this installed instance on iOS, not from Safari itself — see [configuration.md#web-push-notifications](configuration.md#web-push-notifications).

The service worker caches static assets (JS/CSS/icons) cache-first for snappier repeat loads, but always goes straight to the network for `/api/*` and `/ws/*` and for the page navigation itself — there is no offline mode for actual panel data, only a faster shell load. A new deployment is picked up automatically on next launch (old caches are dropped on activate); no manual "clear cache" step is needed after an update.

## Updates

```bash
docker compose pull
docker compose up -d
```

That's it — no `git clone`/`git pull` needed for a normal deployment, since `docker-compose.yml` and `.env` are the only files a deployment actually needs, and `api` is pulled pre-built from GHCR. (Building from source instead, e.g. for local development? See [CONTRIBUTING.md](../CONTRIBUTING.md).)

Database migrations are applied automatically when the api container starts, via `prisma migrate deploy` (see [`docker/entrypoint.sh`](../docker/entrypoint.sh)) — no manual migration step needed. Running Minecraft server containers are unaffected by a panel update, since they're independent containers.

## Troubleshooting

**`EACCES` / permission denied writing to `data/`**
The api container runs with a fixed UID/GID `1000:1000`. If the host's `data/` folder has different ownership:
```bash
sudo chown -R 1000:1000 ./data
```

**Newly created servers get stuck in `INSTALLING`, or the container finds no data**
Usually a misconfigured `HOST_DATA_PATH` — see [configuration.md](configuration.md#host_data_path-the-sibling-container-problem). Check with `docker inspect <container>` and confirm the `Binds` entry points at a host path that actually exists.

**Server creation fails with "Provisioning failed unexpectedly", logs show `EACCES /var/run/docker.sock`**
The `node` user inside the container didn't have access to the host-mounted Docker socket, because the socket's group GID on the host didn't match the container's GID. The entrypoint script detects the socket's actual GID at startup and adds `node` to a matching group automatically (see `docker/entrypoint.sh`) — no manual action needed. If it still happens, pull the latest image (`docker compose pull api && docker compose up -d`) — an old image may predate this fix.

**Server creation fails with "Port already used" / "already allocated"**
The chosen port is already taken — as another server's primary port or as any server's extra [allocation](#port-allocations); both are checked instance-wide, for new servers and new allocations alike, and auto-assignment skips both. If auto-assignment itself fails, `MC_PORT_RANGE_MIN`/`MAX` is too narrow for the number of servers and allocations in that range.

**A server shows `Error` with "Failed to start the server: ... port is already allocated"**
Docker couldn't bind one of the server's ports on the host — usually something *outside* the panel (another container or a host service) already listens on it. Free the port or change the allocation, then start again. The status line always shows Docker's actual reason when a start/stop/restart fails.

**A Forge/NeoForge server ends in `Error` with "Installation failed: The installer exited with code ..."**
The message ends with the installer's own last output line. Most often it's a network problem while the installer downloads libraries from Maven/Mojang — the installer container needs outbound internet access. Fix the cause, then **Settings → Danger zone → Reinstall** to try again.

**Players can't join a backend through the proxy ("You must connect through a proxy" / "unable to connect")**
The backend still runs with its old settings — restart it once after adding it to the network. Check that it's running and that the proxy's Network tab lists it. For Velocity, a backend older than Paper 1.13 can't use modern forwarding; use BungeeCord for it.

**Scheduled workflows run at the wrong hour**
They run in the panel's `TZ` (default `UTC`). Set `TZ` in `.env` — e.g. `TZ=Europe/Berlin` — and recreate the container (`docker compose up -d`). The scheduler editor shows which zone it's using.

**Live console shows nothing / commands don't arrive**
The server must be fully up (status `Running`) — for panel-managed servers the console is a direct stdin/stdout attach to the container, which only exists once the Minecraft process is actually running; for legacy servers, commands go over RCON, which only responds once Minecraft has finished booting. See [architecture.md](architecture.md#console-attached-stdin-not-rcon). Reaching the panel under a different address than `WEB_ORIGIN` (e.g. its LAN IP) also blocks the console's WebSocket — list every address in `WEB_ORIGIN`, comma-separated.

**`database is locked` / `SQLITE_BUSY` in the logs**
Can happen under brief concurrent SQLite writes. The panel enables WAL mode and a 5-second `busy_timeout` on startup, which makes this practically a non-issue in normal use — if it still happens (e.g. under heavy parallel load), restart the api container. For serious multi-user load with lots of concurrent writes, SQLite simply isn't the right tool — see [architecture.md](architecture.md#design-decisions).
