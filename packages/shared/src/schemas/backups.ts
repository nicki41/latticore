import { z } from "zod";

export const createBackupSchema = z.object({
  note: z.string().trim().max(200).optional(),
});
export type CreateBackupInput = z.infer<typeof createBackupSchema>;

export const updateBackupSchema = z.object({
  locked: z.boolean(),
});
export type UpdateBackupInput = z.infer<typeof updateBackupSchema>;

export const backupSettingsSchema = z.object({
  retentionCount: z.number().int().min(1, "Keep at least 1 backup").max(1000).nullable(),
});
export type BackupSettingsInput = z.infer<typeof backupSettingsSchema>;
