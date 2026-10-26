import type { ServerSoftware, ServerStatus } from "./enums.js";

/** How the proxy hands the player's real identity (UUID, IP, skin) to the servers behind it. */
export type NetworkForwardingMode = "modern" | "legacy";

export interface NetworkBackendServerDto {
  id: string;
  name: string;
  software: ServerSoftware;
  mcVersion: string;
  status: ServerStatus;
}

export interface NetworkBackendDto {
  memberId: string;
  /** What the proxy calls this server — `/server <name>` in game. */
  name: string;
  /** Join order, 0 first: new players land on the first reachable backend. */
  priority: number;
  /** Null when the viewer has no access to the backend server itself. */
  server: NetworkBackendServerDto | null;
}

export interface NetworkDto {
  proxyId: string;
  /** Velocity uses modern forwarding (secret-signed); BungeeCord the legacy IP-forwarding protocol. */
  forwardingMode: NetworkForwardingMode;
  backends: NetworkBackendDto[];
}

/** A server that could be added to this proxy's network, or why not. */
export interface NetworkCandidateDto {
  id: string;
  name: string;
  software: ServerSoftware;
  mcVersion: string;
  status: ServerStatus;
  /** Null when it can be added; otherwise a short reason shown next to it. */
  unsupportedReason: string | null;
}

/** What a network change needs to take effect. */
export interface NetworkChangeResultDto {
  network: NetworkDto;
  /** The proxy picked the change up live (`velocity reload` / `greload`). */
  proxyReloaded: boolean;
  /** The proxy must be restarted for the change to apply (it's running, and couldn't reload it live). */
  proxyRestartRequired: boolean;
  /** The changed backend is running and must be restarted (online-mode, forwarding and port publishing are read at boot). */
  backendRestartRequired: boolean;
}

/** Shown on a backend server: the network it belongs to. */
export interface NetworkMembershipDto {
  proxyId: string;
  proxyName: string | null;
  name: string;
}
