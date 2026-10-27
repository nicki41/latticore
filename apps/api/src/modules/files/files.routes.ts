import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import mime from "mime-types";
import { z } from "zod";
import { createFileEntrySchema, moveFileSchema, copyFileSchema, writeFileContentSchema, extractZipSchema } from "@latticore/shared";
import type { FastifyInstance } from "fastify";
import { FileService } from "./files.service.js";
import { safeResolve, isRootPath } from "../../lib/safePath.js";
import { AuditAction } from "../audit/audit.service.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";

/** Strips characters that would break (or inject headers into) a Content-Disposition filename. */
function safeDownloadName(name: string): string {
  const cleaned = name.replace(/["\r\n]/g, "").trim();
  return cleaned || "download";
}

const fileService = new FileService();

const pathQuerySchema = z.object({ path: z.string().default("") });
const searchQuerySchema = z.object({ path: z.string().default(""), query: z.string().min(1) });

export async function filesRoutes(fastify: FastifyInstance) {
  fastify.get("/", { preHandler: fastify.requireServerAccess("files.view") }, async (request, reply) => {
    const { path: relPath } = pathQuerySchema.parse(request.query);
    const entries = await fileService.list(request.mcServer!.dataDir, relPath);
    return reply.send({ path: relPath, entries });
  });

  fastify.get("/content", { preHandler: fastify.requireServerAccess("files.view") }, async (request, reply) => {
    const { path: relPath } = pathQuerySchema.parse(request.query);
    const content = await fileService.readContent(request.mcServer!.dataDir, relPath);
    return reply.send(content);
  });

  fastify.put("/content", { preHandler: fastify.requireServerAccess("files.edit") }, async (request, reply) => {
    const { path: relPath } = pathQuerySchema.parse(request.query);
    const { content } = writeFileContentSchema.parse(request.body);
    const result = await fileService.writeContent(request.mcServer!.dataDir, relPath, content);

    await fastify.audit.record(
      AuditAction.FILE_EDIT,
      { userId: request.user!.id, serverId: request.mcServer!.id, ipAddress: request.ip },
      { path: relPath },
    );
    return reply.send(result);
  });

  fastify.post("/create", { preHandler: fastify.requireServerAccess("files.create") }, async (request, reply) => {
    const input = createFileEntrySchema.parse(request.body);
    await fileService.create(request.mcServer!.dataDir, input.path, input.type);

    await fastify.audit.record(
      AuditAction.FILE_CREATE,
      { userId: request.user!.id, serverId: request.mcServer!.id, ipAddress: request.ip },
      input,
    );
    return reply.status(201).send();
  });

  fastify.delete("/", { preHandler: fastify.requireServerAccess("files.delete") }, async (request, reply) => {
    const { path: relPath } = pathQuerySchema.parse(request.query);
    await fileService.remove(request.mcServer!.dataDir, relPath);

    await fastify.audit.record(
      AuditAction.FILE_DELETE,
      { userId: request.user!.id, serverId: request.mcServer!.id, ipAddress: request.ip },
      { path: relPath },
    );
    return reply.status(204).send();
  });

  fastify.post("/move", { preHandler: fastify.requireServerAccess("files.edit") }, async (request, reply) => {
    const input = moveFileSchema.parse(request.body);
    await fileService.move(request.mcServer!.dataDir, input.from, input.to);

    await fastify.audit.record(
      AuditAction.FILE_MOVE,
      { userId: request.user!.id, serverId: request.mcServer!.id, ipAddress: request.ip },
      input,
    );
    return reply.status(204).send();
  });

  fastify.post("/copy", { preHandler: fastify.requireServerAccess("files.create") }, async (request, reply) => {
    const input = copyFileSchema.parse(request.body);
    await fileService.copy(request.mcServer!.dataDir, input.from, input.to);

    await fastify.audit.record(
      AuditAction.FILE_COPY,
      { userId: request.user!.id, serverId: request.mcServer!.id, ipAddress: request.ip },
      input,
    );
    return reply.status(204).send();
  });

  fastify.get("/search", { preHandler: fastify.requireServerAccess("files.view") }, async (request, reply) => {
    const { path: relPath, query } = searchQuerySchema.parse(request.query);
    const entries = await fileService.search(request.mcServer!.dataDir, relPath, query);
    return reply.send({ entries });
  });

  fastify.post("/extract", { preHandler: fastify.requireServerAccess("files.create") }, async (request, reply) => {
    const input = extractZipSchema.parse(request.body);
    const destination = input.destination ?? path.posix.dirname(input.path.replace(/\\/g, "/"));
    await fileService.extractZip(request.mcServer!.dataDir, input.path, destination);

    await fastify.audit.record(
      AuditAction.FILE_EXTRACT,
      { userId: request.user!.id, serverId: request.mcServer!.id, ipAddress: request.ip },
      { path: input.path, destination },
    );
    return reply.status(204).send();
  });

  fastify.get("/download", { preHandler: fastify.requireServerAccess("files.view") }, async (request, reply) => {
    const { path: relPath } = pathQuerySchema.parse(request.query);
    const root = fileService.rootFor(request.mcServer!.dataDir);
    const filePath = await safeResolve(root, relPath);

    const stat = await fsp.stat(filePath).catch(() => null);
    if (!stat) throw new NotFoundError("File or folder not found.");

    if (stat.isDirectory()) {
      const archive = await fileService.createDirectoryZip(request.mcServer!.dataDir, relPath);
      const zipName = safeDownloadName(isRootPath(relPath) ? request.mcServer!.name : path.basename(filePath));

      await fastify.audit.record(
        AuditAction.FILE_DOWNLOAD_ZIP,
        { userId: request.user!.id, serverId: request.mcServer!.id, ipAddress: request.ip },
        { path: relPath },
      );

      reply.header("Content-Disposition", `attachment; filename="${zipName}.zip"`);
      reply.type("application/zip");
      return reply.send(archive);
    }

    const filename = safeDownloadName(path.basename(filePath));
    reply.header("Content-Disposition", `attachment; filename="${filename}"`);
    reply.type(mime.lookup(filename) || "application/octet-stream");
    return reply.send(fs.createReadStream(filePath));
  });

  fastify.post("/upload", { preHandler: fastify.requireServerAccess("files.upload") }, async (request, reply) => {
    const { path: destDir } = pathQuerySchema.parse(request.query);
    const root = fileService.rootFor(request.mcServer!.dataDir);

    let uploaded = 0;
    for await (const part of request.files()) {
      const destPath = await safeResolve(root, `${destDir}/${part.filename}`.replace(/^\/+/, ""));
      await fsp.mkdir(path.dirname(destPath), { recursive: true });
      await pipeline(part.file, fs.createWriteStream(destPath));
      uploaded++;
    }
    if (uploaded === 0) throw new BadRequestError("No files were uploaded.");

    await fastify.audit.record(
      AuditAction.FILE_UPLOAD,
      { userId: request.user!.id, serverId: request.mcServer!.id, ipAddress: request.ip },
      { path: destDir, count: uploaded },
    );
    return reply.status(201).send({ uploaded });
  });
}
