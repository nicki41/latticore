import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServerConfigService } from "./serverConfig.service.js";

vi.mock("../../config/env.js", () => ({
  env: {
    get DATA_PATH() {
      return globalThis.__TEST_DATA_PATH__;
    },
  },
}));

declare global {
   
  var __TEST_DATA_PATH__: string;
}

describe("ServerConfigService", () => {
  let tmpDataPath: string;
  let service: ServerConfigService;
  const server = { software: "PAPER" as const, dataDir: "servers/paper-1" };

  beforeEach(async () => {
    tmpDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "latticore-serverconfig-"));
    globalThis.__TEST_DATA_PATH__ = tmpDataPath;
    service = new ServerConfigService();
    await fs.mkdir(path.join(tmpDataPath, server.dataDir), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDataPath, { recursive: true, force: true });
  });

  it("rejects an unknown fileId", async () => {
    await expect(service.readValues(server, "not-a-real-file")).rejects.toThrow(/no config schema/i);
  });

  it("reports exists:false with null values when the file hasn't been generated yet", async () => {
    const result = await service.readValues(server, "paper-global");
    expect(result.exists).toBe(false);
    expect(result.values["misc.max-joins-per-tick"]).toBeNull();
  });

  it("reads real values out of an existing YAML file by dot-path", async () => {
    const configDir = path.join(tmpDataPath, server.dataDir, "config");
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, "paper-global.yml"),
      "_version: 30\nmisc:\n  max-joins-per-tick: 3\nspark:\n  enabled: false\n",
    );

    const result = await service.readValues(server, "paper-global");
    expect(result.exists).toBe(true);
    expect(result.values["misc.max-joins-per-tick"]).toBe(3);
    expect(result.values["spark.enabled"]).toBe(false);
  });

  it("writes only the submitted keys, preserving comments and unrelated keys", async () => {
    const configDir = path.join(tmpDataPath, server.dataDir, "config");
    await fs.mkdir(configDir, { recursive: true });
    const original = [
      "# top-level comment",
      "_version: 30",
      "misc:",
      "  max-joins-per-tick: 5 # inline comment",
      "  some-unmanaged-future-key: true",
      "spark:",
      "  enabled: false",
      "",
    ].join("\n");
    await fs.writeFile(path.join(configDir, "paper-global.yml"), original);

    await service.writeValues(server, "paper-global", { "misc.max-joins-per-tick": 9 });

    const written = await fs.readFile(path.join(configDir, "paper-global.yml"), "utf8");
    expect(written).toContain("# top-level comment");
    expect(written).toContain("# inline comment");
    expect(written).toContain("some-unmanaged-future-key: true");
    expect(written).toContain("max-joins-per-tick: 9");
    expect(written).toContain("enabled: false"); // spark.enabled untouched
  });

  it("creates the file from scratch if it doesn't exist yet", async () => {
    const result = await service.writeValues(server, "paper-global", { "misc.max-joins-per-tick": 2 });
    expect(result.exists).toBe(true);
    expect(result.values["misc.max-joins-per-tick"]).toBe(2);

    const written = await fs.readFile(path.join(tmpDataPath, server.dataDir, "config", "paper-global.yml"), "utf8");
    expect(written).toContain("max-joins-per-tick: 2");
  });

  it("rejects a value outside a field's numeric range", async () => {
    await expect(service.writeValues(server, "paper-global", { "misc.max-joins-per-tick": 999 })).rejects.toThrow(/<= 100/);
  });

  it("rejects a value outside an enum field's allowed options", async () => {
    await expect(
      service.writeValues(server, "paper-world-defaults", { "anticheat.anti-xray.engine-mode": "9" }),
    ).rejects.toThrow(/must be one of/i);
  });

  it("rejects a boolean field given a non-boolean value", async () => {
    await expect(service.writeValues(server, "paper-global", { "spark.enabled": "yes" })).rejects.toThrow(/must be a boolean/i);
  });

  it("rejects an unknown field key rather than writing arbitrary paths", async () => {
    await expect(service.writeValues(server, "paper-global", { "some.made.up.path": true })).rejects.toThrow(/unknown config field/i);
  });

  describe("server.properties (properties format)", () => {
    it("is available for every software, not just Paper", async () => {
      const vanillaServer = { software: "VANILLA" as const, dataDir: "servers/vanilla-1" };
      await fs.mkdir(path.join(tmpDataPath, vanillaServer.dataDir), { recursive: true });
      const result = await service.readValues(vanillaServer, "server-properties");
      expect(result.exists).toBe(false);
      expect(result.values.motd).toBeNull();
    });

    it("reads real values, coercing plain-text booleans/numbers to their real types", async () => {
      await fs.writeFile(
        path.join(tmpDataPath, server.dataDir, "server.properties"),
        ["#Minecraft server properties", "motd=Hello World", "max-players=42", "pvp=false", "difficulty=hard", ""].join("\n"),
      );

      const result = await service.readValues(server, "server-properties");
      expect(result.exists).toBe(true);
      expect(result.values.motd).toBe("Hello World");
      expect(result.values["max-players"]).toBe(42);
      expect(result.values.pvp).toBe(false);
      expect(result.values.difficulty).toBe("hard");
    });

    it("writes only the submitted keys, preserving comments, order, and unrelated keys", async () => {
      const original = ["#Minecraft server properties", "#Fri Aug 08 00:00:00 UTC 2026", "motd=Old MOTD", "some-unmanaged-key=42", "pvp=true", ""].join(
        "\n",
      );
      await fs.writeFile(path.join(tmpDataPath, server.dataDir, "server.properties"), original);

      await service.writeValues(server, "server-properties", { motd: "New MOTD" });

      const written = await fs.readFile(path.join(tmpDataPath, server.dataDir, "server.properties"), "utf8");
      expect(written).toContain("#Minecraft server properties");
      expect(written).toContain("some-unmanaged-key=42");
      expect(written).toContain("pvp=true");
      expect(written).toContain("motd=New MOTD");
      expect(written).not.toContain("Old MOTD");
    });

    it("appends a previously-absent key rather than dropping it", async () => {
      await fs.writeFile(path.join(tmpDataPath, server.dataDir, "server.properties"), "motd=Hi\n");
      await service.writeValues(server, "server-properties", { "max-players": 5 });
      const written = await fs.readFile(path.join(tmpDataPath, server.dataDir, "server.properties"), "utf8");
      expect(written).toContain("motd=Hi");
      expect(written).toContain("max-players=5");
    });

    it("rejects an out-of-range value using the field's real min/max", async () => {
      await expect(service.writeValues(server, "server-properties", { "view-distance": 999 })).rejects.toThrow(/<= 32/);
    });
  });

  describe("createWithDefaults", () => {
    it("seeds every field with its documented default when the file doesn't exist yet", async () => {
      await service.createWithDefaults(server, "server-properties");

      const written = await fs.readFile(path.join(tmpDataPath, server.dataDir, "server.properties"), "utf8");
      expect(written).toContain("motd=A Minecraft Server");
      expect(written).toContain("max-players=20");
      expect(written).toContain("difficulty=easy");
      expect(written).toContain("online-mode=true");

      const result = await service.readValues(server, "server-properties");
      expect(result.exists).toBe(true);
      expect(result.values.motd).toBe("A Minecraft Server");
      expect(result.values["max-players"]).toBe(20);
    });

    it("never overwrites an existing file", async () => {
      await fs.writeFile(path.join(tmpDataPath, server.dataDir, "server.properties"), "motd=Custom Already Here\n");
      await service.createWithDefaults(server, "server-properties");
      const written = await fs.readFile(path.join(tmpDataPath, server.dataDir, "server.properties"), "utf8");
      expect(written).toBe("motd=Custom Already Here\n");
    });
  });
});
