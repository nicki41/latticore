import fs from "node:fs/promises";
import path from "node:path";
import { parseDocument, Document } from "yaml";
import type { Server } from "@prisma/client";
import type { ConfigFieldDef, ConfigFileFormat, ServerConfigFileDef, ServerConfigFileValuesDto, ServerSoftware } from "@latticore/shared";
import { getServerConfigSchema, SERVER_PROPERTIES_FILE } from "@latticore/shared";
import { env } from "../../config/env.js";
import { safeResolve } from "../../lib/safePath.js";
import { PropertiesDocument } from "../../lib/propertiesCodec.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";

type ConfigValue = string | number | boolean | null;

interface DocAdapter {
  get(key: string): unknown;
  set(key: string, value: string | number | boolean): void;
  toString(): string;
}

function makeAdapter(format: ConfigFileFormat, raw: string | null): DocAdapter {
  if (format === "properties") {
    const doc = raw !== null ? PropertiesDocument.parse(raw) : PropertiesDocument.empty();
    return {
      get: (key) => doc.get(key),
      set: (key, value) => doc.set(key, String(value)),
      toString: () => doc.toString(),
    };
  }
  const doc = raw !== null ? parseDocument(raw) : new Document({});
  return {
    get: (key) => doc.getIn(key.split(".")),
    set: (key, value) => {
      doc.setIn(key.split("."), value);
    },
    toString: () => doc.toString(),
  };
}

function findFileDef(software: ServerSoftware, fileId: string): ServerConfigFileDef {
  if (fileId === SERVER_PROPERTIES_FILE.id) return SERVER_PROPERTIES_FILE;
  const schema = getServerConfigSchema(software);
  const file = schema?.files.find((f) => f.id === fileId);
  if (!file) throw new NotFoundError(`No config schema for "${fileId}" on ${software} servers.`);
  return file;
}

function allFields(file: ServerConfigFileDef): ConfigFieldDef[] {
  return file.sections.flatMap((s) => s.fields);
}

/** Reads a raw (possibly string-typed, for .properties files) doc value into the field's real JS type. */
function coerceReadValue(field: ConfigFieldDef, raw: unknown): ConfigValue {
  if (raw === undefined || raw === null) return null;
  switch (field.type) {
    case "boolean":
      return typeof raw === "boolean" ? raw : String(raw).trim().toLowerCase() === "true";
    case "number": {
      const num = typeof raw === "number" ? raw : Number(String(raw).trim());
      return Number.isFinite(num) ? num : null;
    }
    case "enum":
    case "string":
    default:
      return String(raw);
  }
}

/** Parses and range/enum-checks a raw submitted value against its field definition — never trusts the client's type. */
function coerceAndValidate(field: ConfigFieldDef, raw: unknown): ConfigValue {
  switch (field.type) {
    case "boolean":
      if (typeof raw !== "boolean") throw new BadRequestError(`${field.key} must be a boolean.`);
      return raw;
    case "number": {
      const num = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(num)) throw new BadRequestError(`${field.key} must be a number.`);
      if (field.min !== undefined && num < field.min) throw new BadRequestError(`${field.key} must be >= ${field.min}.`);
      if (field.max !== undefined && num > field.max) throw new BadRequestError(`${field.key} must be <= ${field.max}.`);
      return num;
    }
    case "enum": {
      if (typeof raw !== "string" || !field.options?.some((o) => o.value === raw)) {
        throw new BadRequestError(`${field.key} must be one of: ${field.options?.map((o) => o.value).join(", ")}.`);
      }
      return raw;
    }
    case "string":
      if (typeof raw !== "string") throw new BadRequestError(`${field.key} must be a string.`);
      return raw;
    default:
      throw new BadRequestError(`Unknown field type for ${field.key}.`);
  }
}

export class ServerConfigService {
  /** Resolves and asserts the given config file belongs to a known schema for this server's software. */
  getFileDef(software: ServerSoftware, fileId: string): ServerConfigFileDef {
    return findFileDef(software, fileId);
  }

  private async absolutePath(server: Pick<Server, "dataDir">, file: ServerConfigFileDef): Promise<string> {
    const root = path.join(env.DATA_PATH, server.dataDir);
    return safeResolve(root, file.relativePath);
  }

  private async readRaw(server: Pick<Server, "dataDir">, file: ServerConfigFileDef): Promise<string | null> {
    const absPath = await this.absolutePath(server, file);
    return fs.readFile(absPath, "utf8").catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return null;
      throw err;
    });
  }

  /**
   * Reads the current value of every schema field from the real config
   * file. If the file doesn't exist yet, returns exists:false with each
   * field's value as null rather than fabricating defaults.
   */
  async readValues(server: Pick<Server, "software" | "dataDir">, fileId: string): Promise<ServerConfigFileValuesDto> {
    const file = findFileDef(server.software as ServerSoftware, fileId);
    const raw = await this.readRaw(server, file);
    if (raw === null) {
      return { exists: false, values: Object.fromEntries(allFields(file).map((f) => [f.key, null])) };
    }

    const doc = makeAdapter(file.format, raw);
    const values: Record<string, ConfigValue> = {};
    for (const field of allFields(file)) {
      values[field.key] = coerceReadValue(field, doc.get(field.key));
    }
    return { exists: true, values };
  }

  /**
   * Writes only the submitted (schema-known) keys into the file, preserving
   * every other key, comment, and the surrounding structure. If the file
   * doesn't exist yet, starts a fresh document.
   */
  async writeValues(
    server: Pick<Server, "software" | "dataDir">,
    fileId: string,
    submitted: Record<string, unknown>,
  ): Promise<ServerConfigFileValuesDto> {
    const file = findFileDef(server.software as ServerSoftware, fileId);
    const fieldsByKey = new Map(allFields(file).map((f) => [f.key, f]));
    const absPath = await this.absolutePath(server, file);

    for (const key of Object.keys(submitted)) {
      if (!fieldsByKey.has(key)) throw new BadRequestError(`Unknown config field: ${key}`);
    }

    const raw = await this.readRaw(server, file);
    const doc = makeAdapter(file.format, raw);

    for (const [key, rawValue] of Object.entries(submitted)) {
      const field = fieldsByKey.get(key)!;
      const value = coerceAndValidate(field, rawValue);
      doc.set(key, value as string | number | boolean);
    }

    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, doc.toString(), "utf8");

    return this.readValues(server, fileId);
  }

  /**
   * Seeds a config file with every field's documented default — used at
   * server provisioning time for files the panel itself owns (currently
   * just server.properties; Paper's own config files are intentionally
   * left for Paper to generate on first boot, see paper.ts). Never
   * overwrites an existing file.
   */
  async createWithDefaults(server: Pick<Server, "software" | "dataDir">, fileId: string): Promise<void> {
    const file = findFileDef(server.software as ServerSoftware, fileId);
    const absPath = await this.absolutePath(server, file);
    if (await fs.stat(absPath).catch(() => null)) return;

    const doc = makeAdapter(file.format, null);
    for (const field of allFields(file)) {
      doc.set(field.key, field.default);
    }

    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, doc.toString(), "utf8");
  }
}
