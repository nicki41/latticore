import type { Server, ServerAllocation } from "@prisma/client";
import type { AccessLevel, ServerDto, ServerRuntime, ServerSoftware, ServerStatus } from "@minecraftpanel/shared";

// SQLite has no native enum type, so Server.software/status are plain
// strings at the Prisma layer; validity is enforced at write time via Zod
// (createServerSchema et al.), so casting back to the narrow union here —
// at the one place every Server row becomes a ServerDto — is safe.
export function serializeServer(server: Server, myAccessLevel: AccessLevel, allocations: ServerAllocation[] = []): ServerDto {
  return {
    id: server.id,
    name: server.name,
    description: server.description,
    software: server.software as ServerSoftware,
    mcVersion: server.mcVersion,
    buildVersion: server.buildVersion,
    runtime: server.runtime as ServerRuntime,
    status: server.status as ServerStatus,
    statusDetail: server.statusDetail,
    port: server.port,
    allocations: allocations.map((a) => ({ id: a.id, port: a.port, createdAt: a.createdAt.toISOString() })),
    memoryMb: server.memoryMb,
    cpuCores: server.cpuCores,
    diskLimitMb: server.diskLimitMb,
    eulaAccepted: server.eulaAccepted,
    createdAt: server.createdAt.toISOString(),
    updatedAt: server.updatedAt.toISOString(),
    myAccessLevel,
  };
}
