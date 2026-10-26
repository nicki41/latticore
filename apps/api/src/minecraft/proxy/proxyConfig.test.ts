import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import AdmZip from "adm-zip";
import { parse as parseYaml } from "yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config/env.js", () => ({ env: { MINECRAFT_NETWORK: "test_net", DOCKER_SOCKET_PATH: "/nonexistent.sock", TZ: "UTC" } }));

const { configureBackendForwarding, patchBungeeConfig, patchVelocityToml, readOrCreateVelocitySecret, writeProxyConfig } = await import("./proxyConfig.js");

/** Trimmed copy of Velocity 3.x's default-velocity.toml (structure and comments as shipped). */
const VELOCITY_DEFAULT = `# Config version. Do not change this
config-version = "2.7"

# What port should the proxy be bound to? By default, we'll bind to all addresses on port 25577.
bind = "0.0.0.0:25577"

# What should be the MOTD?
motd = "<#09add3>A Velocity Server"
online-mode = true
player-info-forwarding-mode = "NONE"
forwarding-secret-file = "forwarding.secret"

[servers]
# Configure your servers here.
lobby = "127.0.0.1:30066"
factions = "127.0.0.1:30067"
try = [
    "lobby"
]

[forced-hosts]
# Configure your forced hosts here.
"lobby.example.com" = [
    "lobby"
]

[advanced]
# How large a Minecraft packet has to be before we compress it.
compression-threshold = 256
`;

const BACKENDS = [
  { name: "lobby", address: "mcpanel-lobby-aaaa:25565" },
  { name: "survival", address: "mcpanel-survival-bbbb:25565" },
];

describe("patchVelocityToml", () => {
  it("rewrites only the managed keys and tables, keeping every other line and comment", () => {
    const out = patchVelocityToml(VELOCITY_DEFAULT, BACKENDS);

    expect(out).toContain('bind = "0.0.0.0:25565"');
    expect(out).toContain('player-info-forwarding-mode = "MODERN"');
    expect(out).toContain('lobby = "mcpanel-lobby-aaaa:25565"\nsurvival = "mcpanel-survival-bbbb:25565"\ntry = ["lobby", "survival"]');
    expect(out).not.toContain("factions");
    expect(out).not.toContain("lobby.example.com");
    // Untouched parts survive verbatim.
    expect(out).toContain('# What should be the MOTD?\nmotd = "<#09add3>A Velocity Server"');
    expect(out).toContain("[advanced]\n# How large a Minecraft packet has to be before we compress it.\ncompression-threshold = 256");
    expect(out.match(/^\[servers\]$/gm)).toHaveLength(1);
  });

  it("is stable when applied again", () => {
    const once = patchVelocityToml(VELOCITY_DEFAULT, BACKENDS);
    expect(patchVelocityToml(once, BACKENDS)).toBe(once);
  });

  it("adds what's missing to a minimal file, with an empty network", () => {
    const out = patchVelocityToml('config-version = "2.7"\n', []);
    expect(out).toContain('bind = "0.0.0.0:25565"');
    expect(out).toContain("[servers]");
    expect(out).toContain("try = []");
    expect(out).toContain("[forced-hosts]");
  });
});

describe("patchBungeeConfig", () => {
  it("creates a startable config for an empty network (BungeeCord refuses to start with no servers)", () => {
    const config = parseYaml(patchBungeeConfig(null, []));
    expect(config.ip_forward).toBe(true);
    expect(config.online_mode).toBe(true);
    expect(config.listeners[0].host).toBe("0.0.0.0:25565");
    expect(config.listeners[0].priorities).toEqual(["placeholder"]);
    expect(Object.keys(config.servers)).toEqual(["placeholder"]);
    expect(config.listeners[0].forced_hosts).toEqual({});
  });

  it("replaces servers and priorities but keeps the admin's other settings and comments", () => {
    const existing = `# my notes\nonline_mode: true\nplayer_limit: 50\nlisteners:\n- host: 0.0.0.0:25577\n  motd: '&aMy network'\n  priorities:\n  - old\n  forced_hosts:\n    pvp.example.com: old\nservers:\n  old:\n    address: localhost:25565\n`;
    const text = patchBungeeConfig(existing, BACKENDS);
    const config = parseYaml(text);
    expect(text).toContain("# my notes");
    expect(config.player_limit).toBe(50);
    expect(config.listeners[0].motd).toBe("&aMy network");
    expect(config.listeners[0].host).toBe("0.0.0.0:25565");
    expect(config.listeners[0].priorities).toEqual(["lobby", "survival"]);
    expect(config.servers).toEqual({
      lobby: { motd: "&1lobby", address: "mcpanel-lobby-aaaa:25565", restricted: false },
      survival: { motd: "&1survival", address: "mcpanel-survival-bbbb:25565", restricted: false },
    });
  });
});

describe("files on disk", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "mcpanel-proxy-"));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("starts a Velocity config from the default shipped in the jar, and creates the forwarding secret", async () => {
    const zip = new AdmZip();
    zip.addFile("default-velocity.toml", Buffer.from(VELOCITY_DEFAULT));
    zip.writeZip(path.join(root, "velocity-3.5.1-615.jar"));

    await writeProxyConfig("VELOCITY", root, [], "velocity-3.5.1-615.jar");

    const toml = await fs.readFile(path.join(root, "velocity.toml"), "utf8");
    expect(toml).toContain("# Config version. Do not change this");
    expect(toml).toContain('bind = "0.0.0.0:25565"');
    const secret = await readOrCreateVelocitySecret(root);
    expect(secret.length).toBeGreaterThanOrEqual(24);
    // Stable across calls — backends were given this exact value.
    expect(await readOrCreateVelocitySecret(root)).toBe(secret);
  });

  it("points a modern Paper backend at Velocity, keeping the rest of its configs", async () => {
    await fs.writeFile(path.join(root, "server.properties"), "motd=Hello\nonline-mode=true\nmax-players=20\n");
    await fs.mkdir(path.join(root, "config"));
    await fs.writeFile(path.join(root, "config/paper-global.yml"), "# Paper docs\nchunk-loading-basic:\n  autoconfig-send-distance: true\n");

    await configureBackendForwarding(root, "1.21.11", { mode: "velocity", secret: "s3cret" });

    const paperGlobal = parseYaml(await fs.readFile(path.join(root, "config/paper-global.yml"), "utf8"));
    expect(paperGlobal.proxies.velocity).toEqual({ enabled: true, "online-mode": true, secret: "s3cret" });
    expect(paperGlobal["chunk-loading-basic"]).toEqual({ "autoconfig-send-distance": true });
    expect(parseYaml(await fs.readFile(path.join(root, "spigot.yml"), "utf8")).settings.bungeecord).toBe(false);
    expect(await fs.readFile(path.join(root, "server.properties"), "utf8")).toBe("motd=Hello\nonline-mode=false\nmax-players=20\n");
  });

  it("uses legacy BungeeCord forwarding via spigot.yml, and pre-1.19 Paper's paper.yml for Velocity", async () => {
    await configureBackendForwarding(root, "1.21.11", { mode: "bungeecord" });
    expect(parseYaml(await fs.readFile(path.join(root, "spigot.yml"), "utf8")).settings.bungeecord).toBe(true);
    expect(parseYaml(await fs.readFile(path.join(root, "config/paper-global.yml"), "utf8")).proxies.velocity.enabled).toBe(false);

    await configureBackendForwarding(root, "1.16.5", { mode: "velocity", secret: "old" });
    expect(parseYaml(await fs.readFile(path.join(root, "paper.yml"), "utf8")).settings["velocity-support"]).toEqual({ enabled: true, "online-mode": true, secret: "old" });
  });

  it("returns a backend to standalone", async () => {
    await configureBackendForwarding(root, "1.21.11", { mode: "velocity", secret: "s3cret" });
    await configureBackendForwarding(root, "1.21.11", { mode: "none" });
    expect(parseYaml(await fs.readFile(path.join(root, "config/paper-global.yml"), "utf8")).proxies.velocity.enabled).toBe(false);
    expect(await fs.readFile(path.join(root, "server.properties"), "utf8")).toContain("online-mode=true");
  });
});
