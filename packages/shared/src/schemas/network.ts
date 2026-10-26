import { z } from "zod";

/** Proxy-side server names end up as TOML/YAML keys and in `/server <name>` — keep them simple. */
export const networkBackendNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9_-]{0,31}$/, "Use 1–32 lowercase letters, digits, - or _ (starting with a letter or digit)");

export const addNetworkBackendSchema = z.object({
  serverId: z.string().min(1),
  /** Defaults to a slug of the backend's name. */
  name: networkBackendNameSchema.optional(),
});
export type AddNetworkBackendInput = z.infer<typeof addNetworkBackendSchema>;

export const reorderNetworkSchema = z.object({
  /** Every member id of the network, in the new join order. */
  memberIds: z.array(z.string().min(1)).min(1),
});
export type ReorderNetworkInput = z.infer<typeof reorderNetworkSchema>;
