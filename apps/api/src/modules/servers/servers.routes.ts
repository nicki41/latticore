import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createServerSchema,
  effectiveServerPermissions,
  reinstallServerSchema,
  isProxySoftware,
  type ServerSoftware,
  updateServerSettingsSchema,
  SERVER_SOFTWARE,
  type AccessLevel,
  type ServerStatsDto,
} from "@latticore/shared";
import { AuditAction } from "../audit/audit.service.js";
import { serializeServer } from "./servers.serialize.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";
import { env } from "../../config/env.js";

const versionsQuerySchema = z.object({ software: z.enum(SERVER_SOFTWARE) });
// Not z.coerce.boolean(): that's Boolean(value), which turns the string
// "false" into true.
const deleteQuerySchema = z.object({
  keepFiles: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => v === "true" || v === "1"),
});
const historyQuerySchema = z.object({ range: z.enum(["5m", "15m", "1h", "6h", "24h"]).default("1h") });

const ICON_FILENAME = "server-icon.png";
const MAX_ICON_BYTES = 2 * 1024 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export async function serversRoutes(fastify: FastifyInstance) {
  fastify.get("/versions", { preHandler: fastify.requirePermission("servers.create") }, async (request, reply) => {
    const { software } = versionsQuerySchema.parse(request.query);
    const versions = await fastify.serverManager.listVersions(software);
    return reply.send({ versions });
  });

  fastify.get("/", { preHandler: fastify.requirePermission("servers.view") }, async (request, reply) => {
    const user = request.user!;
    const servers = await fastify.prisma.server.findMany({
      orderBy: { createdAt: "desc" },
      include: { allocations: true, networkMembership: { include: { proxy: { select: { name: true } } } } },
    });

    let levelFor: (serverId: string) => AccessLevel | null = () => "FULL";
    if (!user.isOwner) {
      const accessRows = await fastify.prisma.serverAccess.findMany({ where: { userId: user.id } });
      const accessByServerId = new Map(accessRows.map((a) => [a.serverId, a.level as AccessLevel]));
      levelFor = (serverId) => accessByServerId.get(serverId) ?? null;
    }
    const canView = (serverId: string) => user.isOwner || effectiveServerPermissions([...user.permissions], levelFor(serverId)).has("servers.view");

    const visible = servers
      .filter((server) => canView(server.id))
      .map((server) => {
        const member = server.networkMembership;
        const network = member
          ? { proxyId: member.proxyServerId, proxyName: canView(member.proxyServerId) ? member.proxy.name : null, name: member.name }
          : null;
        return serializeServer(server, levelFor(server.id)!, server.allocations, network);
      });

    return reply.send({ servers: visible });
  });

  fastify.post("/", { preHandler: fastify.requirePermission("servers.create") }, async (request, reply) => {
    const input = createServerSchema.parse(request.body);
    const server = await fastify.serverManager.createServer(input);

    await fastify.audit.record(AuditAction.SERVER_CREATE, {
      userId: request.user!.id,
      serverId: server.id,
      ipAddress: request.ip,
    }, { name: input.name, software: input.software, mcVersion: input.mcVersion });

    return reply.status(201).send({ server: serializeServer(server, "FULL") });
  });

  fastify.get("/:id", { preHandler: fastify.requireServerAccess("servers.view") }, async (request, reply) => {
    const server = request.mcServer!;
    const [allocations, network] = await Promise.all([
      fastify.prisma.serverAllocation.findMany({ where: { serverId: server.id } }),
      fastify.networkService.membershipFor(server.id, request.user!),
    ]);
    return reply.send({ server: serializeServer(server, request.serverAccessLevel ?? "FULL", allocations, network) });
  });

  fastify.get("/:id/stats", { preHandler: fastify.requireServerAccess("servers.view") }, async (request, reply) => {
    const serverId = request.mcServer!.id;
    const [stats, diskUsageBytes] = await Promise.all([
      fastify.serverManager.getStats(serverId),
      fastify.serverManager.getDiskUsageBytes(serverId),
    ]);
    const body: ServerStatsDto = {
      cpuPercent: stats?.cpuPercent ?? 0,
      memoryUsageBytes: stats?.memoryUsageBytes ?? 0,
      memoryLimitBytes: stats?.memoryLimitBytes ?? request.mcServer!.memoryMb * 1024 * 1024,
      diskUsageBytes,
      networkRxBytes: stats?.networkRxBytes ?? 0,
      networkTxBytes: stats?.networkTxBytes ?? 0,
      startedAt: stats?.startedAt ?? null,
    };
    return reply.send(body);
  });

  fastify.get("/:id/stats/history", { preHandler: fastify.requireServerAccess("servers.view") }, async (request, reply) => {
    const { range } = historyQuerySchema.parse(request.query);
    const samples = fastify.metricsHistory.getRange(request.mcServer!.id, range);
    return reply.send({ range, samples });
  });

  fastify.patch("/:id/settings", { preHandler: fastify.requireServerAccess("servers.settings.edit") }, async (request, reply) => {
    const input = updateServerSettingsSchema.parse(request.body);
    const server = await fastify.serverManager.updateSettings(request.mcServer!.id, input);

    await fastify.audit.record(AuditAction.SERVER_SETTINGS_UPDATE, {
      userId: request.user!.id,
      serverId: server.id,
      ipAddress: request.ip,
    }, input);

    const allocations = await fastify.prisma.serverAllocation.findMany({ where: { serverId: server.id } });
    return reply.send({ server: serializeServer(server, request.serverAccessLevel ?? "FULL", allocations) });
  });

  fastify.get("/:id/icon", { preHandler: fastify.requireServerAccess("servers.view") }, async (request, reply) => {
    const iconPath = path.join(env.DATA_PATH, request.mcServer!.dataDir, ICON_FILENAME);
    const stat = await fsp.stat(iconPath).catch(() => null);
    if (!stat || !stat.isFile()) throw new NotFoundError("No server icon is set.");

    reply.type("image/png");
    reply.header("Cache-Control", "no-store");
    return reply.send(fs.createReadStream(iconPath));
  });

  fastify.put("/:id/icon", { preHandler: fastify.requireServerAccess("servers.settings.edit") }, async (request, reply) => {
    const part = await request.file({ limits: { fileSize: MAX_ICON_BYTES } });
    if (!part) throw new BadRequestError("No icon file was uploaded.");

    const buffer = await part.toBuffer();
    if (buffer.length < PNG_MAGIC.length || !buffer.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
      throw new BadRequestError("The server icon must be a PNG image.");
    }

    const dataDir = path.join(env.DATA_PATH, request.mcServer!.dataDir);
    const iconPath = path.join(dataDir, ICON_FILENAME);
    const tmpPath = path.join(dataDir, `.${ICON_FILENAME}.tmp-${Date.now()}`);
    await fsp.writeFile(tmpPath, buffer);
    await fsp.rename(tmpPath, iconPath);

    await fastify.audit.record(AuditAction.SERVER_SETTINGS_UPDATE, {
      userId: request.user!.id,
      serverId: request.mcServer!.id,
      ipAddress: request.ip,
    }, { field: "server-icon" });

    return reply.status(204).send();
  });

  fastify.delete("/:id/icon", { preHandler: fastify.requireServerAccess("servers.settings.edit") }, async (request, reply) => {
    const iconPath = path.join(env.DATA_PATH, request.mcServer!.dataDir, ICON_FILENAME);
    await fsp.rm(iconPath, { force: true });

    await fastify.audit.record(AuditAction.SERVER_SETTINGS_UPDATE, {
      userId: request.user!.id,
      serverId: request.mcServer!.id,
      ipAddress: request.ip,
    }, { field: "server-icon", removed: true });

    return reply.status(204).send();
  });

  fastify.post("/:id/start", { preHandler: fastify.requireServerAccess("servers.start") }, async (request, reply) => {
    await fastify.serverManager.startServer(request.mcServer!.id);
    await fastify.audit.record(AuditAction.SERVER_START, { userId: request.user!.id, serverId: request.mcServer!.id, ipAddress: request.ip });
    return reply.status(204).send();
  });

  fastify.post("/:id/stop", { preHandler: fastify.requireServerAccess("servers.stop") }, async (request, reply) => {
    await fastify.serverManager.stopServer(request.mcServer!.id);
    await fastify.audit.record(AuditAction.SERVER_STOP, { userId: request.user!.id, serverId: request.mcServer!.id, ipAddress: request.ip });
    return reply.status(204).send();
  });

  fastify.post("/:id/restart", { preHandler: fastify.requireServerAccess("servers.restart") }, async (request, reply) => {
    await fastify.serverManager.restartServer(request.mcServer!.id);
    await fastify.audit.record(AuditAction.SERVER_RESTART, { userId: request.user!.id, serverId: request.mcServer!.id, ipAddress: request.ip });
    return reply.status(204).send();
  });

  fastify.post("/:id/reinstall", { preHandler: fastify.requireServerAccess("servers.reinstall") }, async (request, reply) => {
    const input = reinstallServerSchema.parse(request.body ?? {});
    const server = request.mcServer!;
    await fastify.serverManager.reinstallServer(server.id, input);
    await fastify.audit.record(
      AuditAction.SERVER_REINSTALL,
      { userId: request.user!.id, serverId: server.id, ipAddress: request.ip },
      { fromVersion: server.mcVersion, toVersion: input.mcVersion ?? server.mcVersion },
    );
    return reply.status(202).send();
  });

  fastify.delete("/:id", { preHandler: fastify.requireServerAccess("servers.delete") }, async (request, reply) => {
    const { keepFiles } = deleteQuerySchema.parse(request.query);
    const serverId = request.mcServer!.id;
    const name = request.mcServer!.name;

    // Networks first: a deleted proxy returns its backends to standalone,
    // a deleted backend disappears from its proxy's server list.
    if (isProxySoftware(request.mcServer!.software as ServerSoftware)) await fastify.networkService.dissolve(request.mcServer!);
    else await fastify.networkService.leaveNetwork(request.mcServer!);

    await fastify.serverManager.deleteServer(serverId, { keepFiles });
    await fastify.backupService.deleteAllForServer(serverId);
    fastify.metricsHistory.clear(serverId);

    await fastify.audit.record(AuditAction.SERVER_DELETE, {
      userId: request.user!.id,
      serverId: null, // the server row is gone; keep the log entry from dangling on a FK that no longer resolves
      ipAddress: request.ip,
    }, { serverId, name, keptFiles: keepFiles });

    return reply.status(204).send();
  });
}
