import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { RawData } from "ws";
import { effectiveServerPermissions, type ServerWsClientMessage } from "@latticore/shared";
import { env } from "../../config/env.js";
import { AuditAction } from "../audit/audit.service.js";
import { ForbiddenError } from "../../lib/errors.js";

/**
 * WebSocket handshakes aren't covered by CORS preflight the way fetch/XHR
 * are, and SameSite=Lax cookies are still attached to cross-origin WS
 * upgrade requests in most browsers — so unlike the REST API, this needs
 * its own explicit Origin check to stop a malicious page from opening an
 * authenticated socket using the visitor's session cookie.
 */
async function requireSameOrigin(request: FastifyRequest, _reply: FastifyReply) {
  if (env.NODE_ENV !== "production") return;
  const origin = request.headers.origin;
  if (!origin || !env.WEB_ORIGINS.includes(origin)) {
    throw new ForbiddenError("Cross-origin WebSocket connections are not allowed.");
  }
}

export async function serversWsRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/:id",
    { websocket: true, preHandler: [requireSameOrigin, fastify.requireServerAccess("console.view")] },
    (socket, request) => {
      const server = request.mcServer!;
      const user = request.user!;
      const canExecute =
        user.isOwner ||
        effectiveServerPermissions([...user.permissions], request.serverAccessLevel ?? null).has("console.execute");

      const session = fastify.liveSessions.getOrCreate(server.id);
      session.addClient(socket);

      socket.on("error", (err: Error) => {
        fastify.log.debug({ err, serverId: server.id }, "Console websocket error");
      });

      socket.on("message", (raw: RawData) => {
        let message: ServerWsClientMessage;
        try {
          message = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (message.type !== "command") return;

        if (!canExecute) {
          socket.send(JSON.stringify({ type: "error", message: "You don't have permission to run commands." }));
          return;
        }

        const command = message.command?.trim();
        if (!command) return;

        session.injectSystemLine(`> [${user.username}] ${command}`);

        fastify.serverManager
          .sendCommand(server.id, command)
          .then((response) => {
            if (response.trim()) session.injectSystemLine(response.trim());
          })
          .catch((err) => {
            session.injectSystemLine(`Error: ${err instanceof Error ? err.message : "Command failed."}`);
          });

        fastify.audit
          .record(AuditAction.CONSOLE_EXECUTE, { userId: user.id, serverId: server.id, ipAddress: request.ip }, { command })
          .catch(() => {});
      });

      socket.on("close", () => {
        session.removeClient(socket);
      });
    },
  );
}
