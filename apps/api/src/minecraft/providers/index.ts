import type { ServerSoftware } from "@latticore/shared";
import { env } from "../../config/env.js";
import { VanillaProvider } from "./VanillaProvider.js";
import { PaperProvider } from "./PaperProvider.js";
import { FabricProvider } from "./FabricProvider.js";
import { ForgeProvider } from "./ForgeProvider.js";
import { NeoForgeProvider } from "./NeoForgeProvider.js";
import { VelocityProvider } from "./VelocityProvider.js";
import { BungeeCordProvider } from "./BungeeCordProvider.js";
import type { MinecraftServerProvider } from "./types.js";

export type { MinecraftServerProvider, ProviderVersion } from "./types.js";

const userAgent = `${env.MODRINTH_USER_AGENT} (version-provider)`;

const providers: Record<ServerSoftware, MinecraftServerProvider> = {
  VANILLA: new VanillaProvider(userAgent),
  PAPER: new PaperProvider(userAgent),
  FABRIC: new FabricProvider(userAgent),
  FORGE: new ForgeProvider(userAgent),
  NEOFORGE: new NeoForgeProvider(userAgent),
  VELOCITY: new VelocityProvider(userAgent),
  BUNGEECORD: new BungeeCordProvider(userAgent),
};

export function getProvider(software: ServerSoftware): MinecraftServerProvider {
  return providers[software];
}
