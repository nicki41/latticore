import type { PlayerGamemode } from "@latticore/shared";

/** Shared action-handler contract passed down from ServerPlayersPage into PlayerCard and PlayerDetailModal, so permission/access gating and toast/error handling live in exactly one place. */
export interface PlayerActionHandlers {
  canKick: boolean;
  canBan: boolean;
  canWhitelist: boolean;
  canOp: boolean;
  canMessage: boolean;
  /** Separate from canBan — irreversible data deletion gets its own gate. */
  canWipe: boolean;
  onKick: (username: string, reason?: string) => void;
  onBan: (username: string, reason?: string) => void;
  onUnban: (username: string) => void;
  onWhitelistAdd: (username: string) => void;
  onWhitelistRemove: (username: string) => void;
  onOp: (username: string) => void;
  onDeop: (username: string) => void;
  onOpenDetail: (username: string) => void;
  onOpenMessage: (username: string) => void;
  /** Reuses canBan. */
  onTempBan: (username: string, durationMinutes: number, reason?: string) => void;
  onIpBan: (username: string, ip: string, reason?: string) => void;
  onIpUnban: (username: string, ip: string) => void;
  onWipe: (username: string) => void;
  /** Reuses canOp. */
  onSetGamemode: (username: string, mode: PlayerGamemode) => void;
}
