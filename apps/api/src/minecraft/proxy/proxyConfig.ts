import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import { Document, isMap, isSeq, parseDocument, type YAMLMap } from "yaml";
import { compareMcVersions, type ServerSoftware } from "@latticore/shared";
import { PropertiesDocument } from "../../lib/propertiesCodec.js";
import { safeResolve } from "../../lib/safePath.js";
import { CONTAINER_GAME_PORT } from "../runtime/DockerMinecraftRuntime.js";

/**
 * File-level handling of proxy networks: the proxy's own config (which
 * servers it knows and in which order to try them) and each backend's
 * forwarding settings. Everything here only reads/writes files in a data
 * directory — deciding *what* the network looks like is NetworkService's job.
 *
 * Inside every proxy/backend container the game port is CONTAINER_GAME_PORT
 * (25565): the proxy binds there, and reaches each backend at
 * `<containerName>:25565` over the shared Docker network.
 */

export interface ProxyBackendEntry {
  /** Name the proxy uses for the server (`/server <name>`). Already validated to `[a-z0-9_-]`. */
  name: string;
  /** host:port reachable from inside the proxy container. */
  address: string;
}

export function backendAddress(containerName: string): string {
  return `${containerName}:${CONTAINER_GAME_PORT}`;
}

const MANAGED_NOTE = "# Managed by the panel — add, remove and reorder servers in the server's Network tab.";

// ------------------------------------------------------------------
// Velocity (velocity.toml)
// ------------------------------------------------------------------

export const VELOCITY_CONFIG_FILE = "velocity.toml";
const VELOCITY_SECRET_FILE = "forwarding.secret";

/**
 * Rewrites only what the panel manages — `bind`, the forwarding mode and
 * secret file, and the whole `[servers]` and `[forced-hosts]` tables — and
 * leaves every other line (and comment) of the file exactly as it was.
 * Section-level replacement is safe here because Velocity's `[servers]`
 * table holds nothing but `name = "address"` lines and `try`.
 */
export function patchVelocityToml(text: string, backends: ProxyBackendEntry[]): string {
  const lines = text.split(/\r?\n/);
  const isHeader = (line: string) => /^\s*\[/.test(line);
  const firstHeader = lines.findIndex(isHeader);
  const topEnd = firstHeader === -1 ? lines.length : firstHeader;

  const topLevel: Record<string, string> = {
    bind: `"0.0.0.0:${CONTAINER_GAME_PORT}"`,
    "player-info-forwarding-mode": `"MODERN"`,
    "forwarding-secret-file": `"${VELOCITY_SECRET_FILE}"`,
  };
  const missing: string[] = [];
  for (const [key, value] of Object.entries(topLevel)) {
    const index = lines.slice(0, topEnd).findIndex((l) => new RegExp(`^\\s*${key.replace(/-/g, "\\-")}\\s*=`).test(l));
    if (index === -1) missing.push(`${key} = ${value}`);
    else lines[index] = `${key} = ${value}`;
  }
  lines.splice(topEnd, 0, ...missing);

  const serversBlock = [
    "[servers]",
    MANAGED_NOTE,
    ...backends.map((b) => `${b.name} = "${b.address}"`),
    `try = [${backends.map((b) => `"${b.name}"`).join(", ")}]`,
    "",
  ];
  // Forced hosts would have to name servers that exist, and the defaults
  // ("lobby.example.com" → lobby, ...) make Velocity refuse to start as soon
  // as those servers aren't defined — keep the table, but empty.
  const forcedHostsBlock = ["[forced-hosts]", MANAGED_NOTE, ""];

  let result = replaceTomlTable(lines, "servers", serversBlock);
  result = replaceTomlTable(result, "forced-hosts", forcedHostsBlock);
  return result.join("\n");
}

function replaceTomlTable(lines: string[], table: string, block: string[]): string[] {
  const start = lines.findIndex((l) => l.trim() === `[${table}]`);
  if (start === -1) return [...lines, ...(lines.at(-1) === "" ? [] : [""]), ...block];
  let end = lines.findIndex((l, i) => i > start && /^\s*\[/.test(l));
  if (end === -1) end = lines.length;
  return [...lines.slice(0, start), ...block, ...lines.slice(end)];
}

/** Velocity's own default config, read out of the installed jar — so a fresh proxy keeps all of Velocity's documentation comments. */
async function defaultVelocityToml(root: string, jarFilename: string | null): Promise<string> {
  if (jarFilename) {
    try {
      const entry = new AdmZip(await safeResolve(root, jarFilename)).getEntry("default-velocity.toml");
      if (entry) return entry.getData().toString("utf8");
    } catch {
      // fall through to the minimal config below
    }
  }
  return `config-version = "2.7"\nonline-mode = true\n`;
}

/** The shared secret Velocity signs forwarded player data with; Paper backends must be given the same one. */
export async function readOrCreateVelocitySecret(root: string): Promise<string> {
  const secretPath = await safeResolve(root, VELOCITY_SECRET_FILE);
  const existing = (await fs.readFile(secretPath, "utf8").catch(() => "")).trim();
  if (existing) return existing;
  const secret = crypto.randomBytes(24).toString("base64url");
  await fs.writeFile(secretPath, `${secret}\n`, { mode: 0o600 });
  return secret;
}

// ------------------------------------------------------------------
// BungeeCord (config.yml)
// ------------------------------------------------------------------

export const BUNGEE_CONFIG_FILE = "config.yml";
/**
 * BungeeCord refuses to start with no servers configured ("No servers
 * defined"), and every priority must name a defined server — so an empty
 * network gets one unreachable placeholder until a real backend is added.
 */
const BUNGEE_PLACEHOLDER = { name: "placeholder", address: "127.0.0.1:1" };

export function patchBungeeConfig(text: string | null, backends: ProxyBackendEntry[]): string {
  const doc: Document = text?.trim() ? parseDocument(text) : parseDocument(`${MANAGED_NOTE}\nonline_mode: true\n`);
  doc.set("ip_forward", true);
  if (!doc.has("online_mode")) doc.set("online_mode", true);

  const entries = backends.length > 0 ? backends : [BUNGEE_PLACEHOLDER];

  let listeners = doc.get("listeners");
  if (!isSeq(listeners) || listeners.items.length === 0) {
    doc.set(
      "listeners",
      doc.createNode([{ motd: "&1A Minecraft network", max_players: 100, force_default_server: false, tab_list: "GLOBAL_PING", query_enabled: false, ping_passthrough: false }]),
    );
    listeners = doc.get("listeners");
  }
  const listener = (listeners as { items: unknown[] }).items[0];
  if (isMap(listener)) {
    const map = listener as YAMLMap;
    map.set("host", `0.0.0.0:${CONTAINER_GAME_PORT}`);
    map.set("priorities", doc.createNode(entries.map((e) => e.name)));
    // Same reasoning as Velocity's forced hosts: the defaults point at servers that don't exist.
    if (!map.has("forced_hosts")) map.set("forced_hosts", doc.createNode({}));
  }

  doc.set(
    "servers",
    doc.createNode(
      Object.fromEntries(
        entries.map((e) => [e.name, { motd: e === BUNGEE_PLACEHOLDER ? "&cAdd a server in the panel's Network tab" : `&1${e.name}`, address: e.address, restricted: false }]),
      ),
    ),
  );
  return doc.toString();
}

// ------------------------------------------------------------------
// Writing a proxy's config
// ------------------------------------------------------------------

/**
 * Writes (or rewrites) the proxy's server list. Called at install time with
 * no backends — so even a brand-new proxy binds the right port and uses the
 * right forwarding mode on its very first boot — and after every network
 * change.
 */
export async function writeProxyConfig(
  software: ServerSoftware,
  root: string,
  backends: ProxyBackendEntry[],
  jarFilename: string | null = null,
): Promise<void> {
  if (software === "VELOCITY") {
    const configPath = await safeResolve(root, VELOCITY_CONFIG_FILE);
    const current = await fs.readFile(configPath, "utf8").catch(() => null);
    await readOrCreateVelocitySecret(root);
    await fs.writeFile(configPath, patchVelocityToml(current ?? (await defaultVelocityToml(root, jarFilename)), backends));
    return;
  }
  if (software === "BUNGEECORD") {
    const configPath = await safeResolve(root, BUNGEE_CONFIG_FILE);
    const current = await fs.readFile(configPath, "utf8").catch(() => null);
    await fs.writeFile(configPath, patchBungeeConfig(current, backends));
    return;
  }
  throw new Error(`${software} is not a proxy.`);
}

// ------------------------------------------------------------------
// Backends (Paper)
// ------------------------------------------------------------------

export type BackendForwarding = { mode: "velocity"; secret: string } | { mode: "bungeecord" } | { mode: "none" };

async function editYaml(root: string, relativePath: string, edit: (doc: Document) => void): Promise<void> {
  const filePath = await safeResolve(root, relativePath);
  const current = await fs.readFile(filePath, "utf8").catch(() => null);
  // new Document({}) rather than parsing "{}": the latter is a *flow* map, and every key added to it would be written as { a: { b: c } }.
  const doc = current?.trim() ? parseDocument(current) : new Document({});
  edit(doc);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, doc.toString());
}

/**
 * Points a Paper server at a proxy (or back to standalone with mode
 * "none"). Paper fills every key it doesn't find with its default and keeps
 * what's set, so writing just these keys works even before the server has
 * generated its config files on first boot.
 *  - Velocity: modern forwarding with the proxy's secret
 *    (config/paper-global.yml on 1.19+, paper.yml before).
 *  - BungeeCord: legacy IP forwarding (spigot.yml `settings.bungeecord`).
 *  - Either way `online-mode=false` in server.properties: the proxy already
 *    authenticated the player. Safe because the backend's port is no longer
 *    published (see Server.exposePort) — only the proxy can reach it.
 */
export async function configureBackendForwarding(root: string, mcVersion: string, forwarding: BackendForwarding): Promise<void> {
  const velocity = forwarding.mode === "velocity";
  const bungee = forwarding.mode === "bungeecord";

  if (compareMcVersions(mcVersion, "1.19") >= 0) {
    await editYaml(root, "config/paper-global.yml", (doc) => {
      doc.setIn(["proxies", "velocity", "enabled"], velocity);
      doc.setIn(["proxies", "velocity", "online-mode"], true);
      if (velocity) doc.setIn(["proxies", "velocity", "secret"], forwarding.secret);
      doc.setIn(["proxies", "bungee-cord", "online-mode"], true);
    });
  } else {
    await editYaml(root, "paper.yml", (doc) => {
      doc.setIn(["settings", "velocity-support", "enabled"], velocity);
      doc.setIn(["settings", "velocity-support", "online-mode"], true);
      if (velocity) doc.setIn(["settings", "velocity-support", "secret"], forwarding.secret);
    });
  }
  await editYaml(root, "spigot.yml", (doc) => doc.setIn(["settings", "bungeecord"], bungee));

  const propertiesPath = await safeResolve(root, "server.properties");
  const properties = PropertiesDocument.parse(await fs.readFile(propertiesPath, "utf8").catch(() => ""));
  properties.set("online-mode", forwarding.mode === "none" ? "true" : "false");
  await fs.writeFile(propertiesPath, properties.toString());
}
