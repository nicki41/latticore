import type { FastifyInstance } from "fastify";
import {
  banPlayerSchema,
  messagePlayerSchema,
  tempBanPlayerSchema,
  ipBanPlayerSchema,
  ipUnbanPlayerSchema,
  gamemodeSchema,
} from "@latticore/shared";
import type { PlayerNameHistoryEntryDto, PlayerIpHistoryEntryDto, PlayerSessionsRange } from "@latticore/shared";
import { PlayerService } from "./players.service.js";
import { PlayerBanService } from "./playerBans.service.js";
import { PlayerDataService } from "./playerData.service.js";
import { PlayerSessionService } from "./playerSessions.service.js";
import { AuditAction } from "../audit/audit.service.js";

const SESSION_RANGES: readonly PlayerSessionsRange[] = ["today", "7d", "30d", "all"];

export async function playersRoutes(fastify: FastifyInstance) {
  const playerService = new PlayerService(fastify.serverManager, fastify.prisma);
  const banService = new PlayerBanService(fastify.serverManager, fastify.prisma);
  const dataService = new PlayerDataService(fastify.prisma);
  const sessionService = new PlayerSessionService(fastify.prisma);

  fastify.get("/", { preHandler: fastify.requireServerAccess("players.view") }, async (request, reply) => {
    const players = await playerService.list(request.mcServer!);
    return reply.send({ players });
  });

  fastify.post("/:username/op", { preHandler: fastify.requireServerAccess("players.op") }, async (request, reply) => {
    const { username } = request.params as { username: string };
    await playerService.op(request.mcServer!, username);
    await fastify.audit.record(AuditAction.PLAYER_OP, { userId: request.user!.id, serverId: request.mcServer!.id, ipAddress: request.ip }, { username });
    return reply.status(204).send();
  });

  fastify.post("/:username/deop", { preHandler: fastify.requireServerAccess("players.op") }, async (request, reply) => {
    const { username } = request.params as { username: string };
    await playerService.deop(request.mcServer!, username);
    await fastify.audit.record(AuditAction.PLAYER_DEOP, { userId: request.user!.id, serverId: request.mcServer!.id, ipAddress: request.ip }, { username });
    return reply.status(204).send();
  });

  fastify.post(
    "/:username/whitelist",
    { preHandler: fastify.requireServerAccess("players.whitelist") },
    async (request, reply) => {
      const { username } = request.params as { username: string };
      await playerService.whitelistAdd(request.mcServer!, username);
      await fastify.audit.record(
        AuditAction.PLAYER_WHITELIST_ADD,
        { userId: request.user!.id, serverId: request.mcServer!.id, ipAddress: request.ip },
        { username },
      );
      return reply.status(204).send();
    },
  );

  fastify.delete(
    "/:username/whitelist",
    { preHandler: fastify.requireServerAccess("players.whitelist") },
    async (request, reply) => {
      const { username } = request.params as { username: string };
      await playerService.whitelistRemove(request.mcServer!, username);
      await fastify.audit.record(
        AuditAction.PLAYER_WHITELIST_REMOVE,
        { userId: request.user!.id, serverId: request.mcServer!.id, ipAddress: request.ip },
        { username },
      );
      return reply.status(204).send();
    },
  );

  fastify.post("/:username/kick", { preHandler: fastify.requireServerAccess("players.kick") }, async (request, reply) => {
    const { username } = request.params as { username: string };
    const { reason } = banPlayerSchema.parse(request.body ?? {});
    await playerService.kick(request.mcServer!, username, reason);
    await fastify.audit.record(
      AuditAction.PLAYER_KICK,
      { userId: request.user!.id, serverId: request.mcServer!.id, ipAddress: request.ip },
      { username, reason },
    );
    return reply.status(204).send();
  });

  fastify.post("/:username/ban", { preHandler: fastify.requireServerAccess("players.ban") }, async (request, reply) => {
    const { username } = request.params as { username: string };
    const { reason } = banPlayerSchema.parse(request.body ?? {});
    await playerService.ban(request.mcServer!, username, reason);
    await fastify.audit.record(
      AuditAction.PLAYER_BAN,
      { userId: request.user!.id, serverId: request.mcServer!.id, ipAddress: request.ip },
      { username, reason },
    );
    return reply.status(204).send();
  });

  fastify.post("/:username/unban", { preHandler: fastify.requireServerAccess("players.ban") }, async (request, reply) => {
    const { username } = request.params as { username: string };
    await playerService.unban(request.mcServer!, username);
    await banService.revokeNameBans(request.mcServer!.id, username, request.user!.id);
    await fastify.audit.record(
      AuditAction.PLAYER_UNBAN,
      { userId: request.user!.id, serverId: request.mcServer!.id, ipAddress: request.ip },
      { username },
    );
    return reply.status(204).send();
  });

  fastify.post(
    "/:username/message",
    { preHandler: fastify.requireServerAccess("players.message") },
    async (request, reply) => {
      const { username } = request.params as { username: string };
      const { message } = messagePlayerSchema.parse(request.body);
      await playerService.message(request.mcServer!, username, message);
      await fastify.audit.record(
        AuditAction.PLAYER_MESSAGE,
        { userId: request.user!.id, serverId: request.mcServer!.id, ipAddress: request.ip },
        { username },
      );
      return reply.status(204).send();
    },
  );

  fastify.post("/:username/tempban", { preHandler: fastify.requireServerAccess("players.ban") }, async (request, reply) => {
    const { username } = request.params as { username: string };
    const { reason, durationMinutes } = tempBanPlayerSchema.parse(request.body);
    await banService.tempBan(request.mcServer!, username, durationMinutes, request.user!.id, reason);
    await fastify.audit.record(
      AuditAction.PLAYER_TEMPBAN,
      { userId: request.user!.id, serverId: request.mcServer!.id, ipAddress: request.ip },
      { username, reason, durationMinutes },
    );
    return reply.status(204).send();
  });

  fastify.post("/:username/ip-ban", { preHandler: fastify.requireServerAccess("players.ban") }, async (request, reply) => {
    const { username } = request.params as { username: string };
    const { ip, reason } = ipBanPlayerSchema.parse(request.body);
    await banService.banIp(request.mcServer!, username, ip, request.user!.id, reason);
    await fastify.audit.record(
      AuditAction.PLAYER_IP_BAN,
      { userId: request.user!.id, serverId: request.mcServer!.id, ipAddress: request.ip },
      { username, ip, reason },
    );
    return reply.status(204).send();
  });

  fastify.post("/:username/ip-unban", { preHandler: fastify.requireServerAccess("players.ban") }, async (request, reply) => {
    const { ip } = ipUnbanPlayerSchema.parse(request.body);
    await banService.unbanIp(request.mcServer!, ip, request.user!.id);
    await fastify.audit.record(
      AuditAction.PLAYER_IP_UNBAN,
      { userId: request.user!.id, serverId: request.mcServer!.id, ipAddress: request.ip },
      { ip },
    );
    return reply.status(204).send();
  });

  fastify.get("/:username/bans", { preHandler: fastify.requireServerAccess("players.ban") }, async (request, reply) => {
    const { username } = request.params as { username: string };
    const bans = await banService.listBans(request.mcServer!.id, username);
    return reply.send({ bans });
  });

  fastify.post("/:username/wipe", { preHandler: fastify.requireServerAccess("players.wipe") }, async (request, reply) => {
    const { username } = request.params as { username: string };
    await playerService.wipe(request.mcServer!, username);
    await fastify.audit.record(
      AuditAction.PLAYER_WIPE,
      { userId: request.user!.id, serverId: request.mcServer!.id, ipAddress: request.ip },
      { username },
    );
    return reply.status(204).send();
  });

  fastify.get("/:username/gamemode", { preHandler: fastify.requireServerAccess("players.view") }, async (request, reply) => {
    const { username } = request.params as { username: string };
    const uuid = await dataService.resolveUuid(request.mcServer!, username);
    if (!uuid) return reply.send({ gamemode: null });
    const result = await dataService.readGamemode(request.mcServer!, uuid);
    return reply.send(result);
  });

  fastify.post("/:username/gamemode", { preHandler: fastify.requireServerAccess("players.op") }, async (request, reply) => {
    const { username } = request.params as { username: string };
    const { mode } = gamemodeSchema.parse(request.body);
    await playerService.setGamemode(request.mcServer!, username, mode);
    await fastify.audit.record(
      AuditAction.PLAYER_GAMEMODE_CHANGE,
      { userId: request.user!.id, serverId: request.mcServer!.id, ipAddress: request.ip },
      { username, mode },
    );
    return reply.status(204).send();
  });

  fastify.get("/:username/stats", { preHandler: fastify.requireServerAccess("players.view") }, async (request, reply) => {
    const { username } = request.params as { username: string };
    const uuid = await dataService.resolveUuid(request.mcServer!, username);
    if (!uuid) return reply.send({ stats: null });
    const stats = await dataService.readStats(request.mcServer!, uuid);
    return reply.send({ stats });
  });

  fastify.get("/:username/sessions", { preHandler: fastify.requireServerAccess("players.view") }, async (request, reply) => {
    const { username } = request.params as { username: string };
    const { range } = request.query as { range?: string };
    const resolvedRange: PlayerSessionsRange = SESSION_RANGES.includes(range as PlayerSessionsRange) ? (range as PlayerSessionsRange) : "all";
    const summary = await sessionService.summarize(request.mcServer!.id, username.toLowerCase(), resolvedRange);
    return reply.send(summary);
  });

  fastify.get("/:username/name-history", { preHandler: fastify.requireServerAccess("players.view") }, async (request, reply) => {
    const { username } = request.params as { username: string };
    const uuid = await dataService.resolveUuid(request.mcServer!, username);
    if (!uuid) return reply.send({ history: [] as PlayerNameHistoryEntryDto[] });
    const rows = await fastify.prisma.playerNameHistory.findMany({
      where: { serverId: request.mcServer!.id, uuid },
      orderBy: { changedAt: "desc" },
    });
    const history: PlayerNameHistoryEntryDto[] = rows.map((r) => ({ username: r.username, changedAt: r.changedAt.toISOString() }));
    return reply.send({ history });
  });

  fastify.get("/:username/ip-history", { preHandler: fastify.requireServerAccess("players.view") }, async (request, reply) => {
    const { username } = request.params as { username: string };
    const rows = await fastify.prisma.playerIpHistory.findMany({
      where: { serverId: request.mcServer!.id, usernameLower: username.toLowerCase() },
      orderBy: { seenAt: "desc" },
    });
    const history: PlayerIpHistoryEntryDto[] = rows.map((r) => ({ ip: r.ip, seenAt: r.seenAt.toISOString() }));
    return reply.send({ history });
  });
}
