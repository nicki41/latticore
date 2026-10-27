import fp from "fastify-plugin";
import type { FastifyInstance, FastifyError } from "fastify";
import { ZodError } from "zod";
import type { ApiErrorBody } from "@latticore/shared";
import { AppError } from "../lib/errors.js";

/**
 * Central error handling: every thrown error is normalized into
 * ApiErrorBody, logged appropriately, and NEVER leaks a stack trace or
 * internal message to the client for unexpected (5xx) failures.
 */
export default fp(async (fastify: FastifyInstance) => {
  fastify.setErrorHandler<FastifyError | AppError | ZodError>((error, request, reply) => {
    if (error instanceof AppError) {
      if (error.statusCode >= 500) request.log.error({ err: error }, "request failed");
      else request.log.warn({ err: error, code: error.code }, "request rejected");

      const body: ApiErrorBody = { error: { code: error.code, message: error.message, details: error.details } };
      return reply.status(error.statusCode).send(body);
    }

    if (error instanceof ZodError) {
      const body: ApiErrorBody = {
        error: { code: "VALIDATION_ERROR", message: "Validation failed", details: error.flatten() },
      };
      return reply.status(400).send(body);
    }

    // Fastify's built-in schema validation errors
    if (Array.isArray(error.validation) && error.validation.length > 0) {
      const body: ApiErrorBody = {
        error: { code: "VALIDATION_ERROR", message: error.message, details: error.validation },
      };
      return reply.status(400).send(body);
    }

    if (error.statusCode === 429) {
      const body: ApiErrorBody = { error: { code: "RATE_LIMITED", message: "Too many requests, slow down." } };
      return reply.status(429).send(body);
    }

    // Any other Fastify-internal 4xx (e.g. FST_CSRF_INVALID_TOKEN, bad
    // content-type, payload too large) — these are expected client-facing
    // errors with a safe, non-sensitive message, so forward the real status
    // and message instead of falling through to a misleading generic 500
    // below. Fastify's own error codes (e.g. "FST_CSRF_INVALID_TOKEN") aren't
    // part of the app's closed ApiErrorCode union, so map to "BAD_REQUEST".
    if (typeof error.statusCode === "number" && error.statusCode >= 400 && error.statusCode < 500) {
      request.log.warn({ err: error, code: error.code }, "request rejected");
      const body: ApiErrorBody = { error: { code: "BAD_REQUEST", message: error.message } };
      return reply.status(error.statusCode).send(body);
    }

    request.log.error({ err: error }, "unhandled error");
    const body: ApiErrorBody = { error: { code: "INTERNAL_ERROR", message: "Internal server error" } };
    return reply.status(500).send(body);
  });
});
