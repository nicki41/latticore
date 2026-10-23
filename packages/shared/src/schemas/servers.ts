import { z } from "zod";
import { SERVER_SOFTWARE } from "../types/enums.js";

export const createServerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(64, "Name is too long"),
  description: z.string().trim().max(500).optional(),
  software: z.enum(SERVER_SOFTWARE),
  mcVersion: z.string().min(1, "Minecraft version is required"),
  memoryMb: z.coerce.number().int().min(1024, "At least 1024 MB").max(65536, "That exceeds any realistic host"),
  cpuCores: z.coerce.number().min(0.5, "At least 0.5 cores").max(64),
  diskLimitMb: z.coerce
    .number()
    .int()
    .min(512)
    .max(1024 * 1024)
    .optional(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  eulaAccepted: z.boolean().refine((v) => v === true, {
    message: "You must accept the Minecraft EULA to create a server.",
  }),
});
export type CreateServerInput = z.infer<typeof createServerSchema>;

export const updateServerSettingsSchema = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  memoryMb: z.coerce.number().int().min(1024).max(65536).optional(),
  cpuCores: z.coerce.number().min(0.5).max(64).optional(),
  diskLimitMb: z.coerce
    .number()
    .int()
    .min(512)
    .max(1024 * 1024)
    .nullable()
    .optional(),
});
export type UpdateServerSettingsInput = z.infer<typeof updateServerSettingsSchema>;

export const reinstallServerSchema = z.object({
  /** Omitted = keep the current Minecraft version and just pick up its newest build/loader. */
  mcVersion: z.string().trim().min(1).optional(),
});
export type ReinstallServerInput = z.infer<typeof reinstallServerSchema>;

export const executeCommandSchema = z.object({
  command: z.string().trim().min(1, "Command is required").max(1000),
});
export type ExecuteCommandInput = z.infer<typeof executeCommandSchema>;

export const createAllocationSchema = z.object({
  port: z.coerce.number().int().min(1).max(65535),
});
export type CreateAllocationInput = z.infer<typeof createAllocationSchema>;
