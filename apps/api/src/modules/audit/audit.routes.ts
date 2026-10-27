import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuditLogDto } from "@latticore/shared";

const querySchema = z.object({
  userId: z.string().optional(),
  serverId: z.string().optional(),
  action: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export async function auditRoutes(fastify: FastifyInstance) {
  fastify.get("/", { preHandler: fastify.requirePermission("audit.view") }, async (request, reply) => {
    const q = querySchema.parse(request.query);
    const where = {
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.serverId ? { serverId: q.serverId } : {}),
      ...(q.action ? { action: q.action } : {}),
    };

    const [logs, total] = await Promise.all([
      fastify.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: q.limit,
        skip: q.offset,
        include: {
          user: { select: { id: true, username: true } },
          server: { select: { id: true, name: true } },
        },
      }),
      fastify.prisma.auditLog.count({ where }),
    ]);

    const dtos: AuditLogDto[] = logs.map((log) => ({
      id: log.id,
      action: log.action,
      details: log.details ? safeJsonParse(log.details) : null,
      ipAddress: log.ipAddress,
      createdAt: log.createdAt.toISOString(),
      user: log.user,
      server: log.server,
    }));

    return reply.send({ logs: dtos, total });
  });

  fastify.get("/actions", { preHandler: fastify.requirePermission("audit.view") }, async (_request, reply) => {
    const rows = await fastify.prisma.auditLog.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } });
    return reply.send({ actions: rows.map((r) => r.action) });
  });
}
