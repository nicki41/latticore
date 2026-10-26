import type { ServerSoftware } from "@minecraftpanel/shared";

export const SOFTWARE_META: Record<ServerSoftware, { label: string; description: string; /** What the version list holds — proxies aren't versioned by Minecraft version. */ versionLabel: string }> = {
  VANILLA: { label: "Vanilla", description: "Official Mojang server. No plugin or mod support.", versionLabel: "Minecraft version" },
  PAPER: { label: "Paper", description: "High-performance server with plugin support (Bukkit/Spigot compatible).", versionLabel: "Minecraft version" },
  FABRIC: { label: "Fabric", description: "Lightweight, performance-focused modding platform.", versionLabel: "Minecraft version" },
  FORGE: { label: "Forge", description: "The original modding platform with the largest mod ecosystem.", versionLabel: "Minecraft version" },
  NEOFORGE: { label: "NeoForge", description: "Actively maintained modern fork of Forge.", versionLabel: "Minecraft version" },
  VELOCITY: {
    label: "Velocity",
    description: "Modern, secure proxy — links several servers into one network with /server switching.",
    versionLabel: "Velocity version",
  },
  BUNGEECORD: { label: "BungeeCord", description: "The classic proxy, for networks that also include older servers.", versionLabel: "BungeeCord build" },
};

export const GAME_SOFTWARE_ORDER: ServerSoftware[] = ["VANILLA", "PAPER", "FABRIC", "FORGE", "NEOFORGE"];
export const PROXY_SOFTWARE_ORDER: ServerSoftware[] = ["VELOCITY", "BUNGEECORD"];
export const SOFTWARE_ORDER: ServerSoftware[] = [...GAME_SOFTWARE_ORDER, ...PROXY_SOFTWARE_ORDER];

/** "Paper 1.21.11", "Velocity 3.5.1", "BungeeCord build 2107". */
export function softwareVersionLabel(software: ServerSoftware, version: string): string {
  return software === "BUNGEECORD" ? `BungeeCord build ${version}` : `${SOFTWARE_META[software].label} ${version}`;
}
