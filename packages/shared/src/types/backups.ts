export interface BackupDto {
  id: string;
  fileName: string;
  sizeBytes: string;
  note: string | null;
  /** Locked backups are never deleted by retention, and can't be deleted by hand until unlocked. */
  locked: boolean;
  createdByUsername: string | null;
  createdAt: string;
}

export interface BackupSettingsDto {
  /** Keep only this many unlocked backups (oldest are deleted after each new one); null keeps everything. */
  retentionCount: number | null;
}
