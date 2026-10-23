import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../runtime/runtimeImages.js", () => ({ resolveJavaMajor: vi.fn(async (mc: string) => (mc.startsWith("26.") ? 25 : 17)) }));

const { ForgeProvider, resolveForgeArtifactVersion } = await import("./ForgeProvider.js");

const PROMOTIONS = {
  promos: {
    "1.5.2-latest": "7.8.1.738",
    "1.7.10_pre4-latest": "10.12.2.1149",
    "1.7.10-latest": "10.13.4.1614",
    "1.20.1-latest": "47.4.28",
    "1.20.1-recommended": "47.4.0",
    "26.3-latest": "66.1.0",
  },
};
const METADATA = `<metadata><versioning><versions>
  <version>26.3-66.1.0</version>
  <version>1.20.1-47.4.28</version>
  <version>1.20.1-47.4.0</version>
  <version>1.7.10-10.13.4.1614-1.7.10</version>
  <version>1.5.2-7.8.1.738</version>
</versions></versioning></metadata>`;

function mockForgeEndpoints() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("promotions_slim.json")) return new Response(JSON.stringify(PROMOTIONS));
    if (url.endsWith("maven-metadata.xml")) return new Response(METADATA);
    if (url.endsWith(".sha256")) return new Response(`${"b".repeat(64)}\n`);
    return new Response("not found", { status: 404 });
  });
}

afterEach(() => vi.restoreAllMocks());

describe("resolveForgeArtifactVersion", () => {
  it("finds the plain <mc>-<build> artifact", () => {
    expect(resolveForgeArtifactVersion("1.20.1", "47.4.0", ["1.20.1-47.4.0"])).toBe("1.20.1-47.4.0");
  });

  it("finds the suffixed artifact old Forge versions use", () => {
    expect(resolveForgeArtifactVersion("1.7.10", "10.13.4.1614", ["1.7.10-10.13.4.1614-1.7.10"])).toBe("1.7.10-10.13.4.1614-1.7.10");
  });

  it("returns null when Maven doesn't have it", () => {
    expect(resolveForgeArtifactVersion("1.20.1", "1.0.0", ["1.20.1-47.4.0"])).toBeNull();
  });
});

describe("ForgeProvider", () => {
  it("lists supported versions newest first, preferring recommended builds and skipping pre-1.7.10 and odd keys", async () => {
    mockForgeEndpoints();
    const versions = await new ForgeProvider("test").listVersions();
    expect(versions.map((v) => v.id)).toEqual(["26.3", "1.20.1", "1.7.10"]);
  });

  it("builds an installer plan with the Maven checksum and the Minecraft version's Java", async () => {
    mockForgeEndpoints();
    const provider = new ForgeProvider("test");

    await expect(provider.resolveInstallPlan("1.20.1")).resolves.toEqual({
      kind: "installer-jar",
      installerUrl: "https://maven.minecraftforge.net/net/minecraftforge/forge/1.20.1-47.4.0/forge-1.20.1-47.4.0-installer.jar",
      installerFilename: "forge-1.20.1-47.4.0-installer.jar",
      installerSha256: "b".repeat(64),
      installerArgs: ["--installServer"],
      javaMajor: 17,
      loaderVersion: "47.4.0",
    });
    const legacy = await provider.resolveInstallPlan("1.7.10");
    expect(legacy.kind === "installer-jar" && legacy.installerFilename).toBe("forge-1.7.10-10.13.4.1614-1.7.10-installer.jar");
  });

  it("rejects an unsupported version", async () => {
    mockForgeEndpoints();
    await expect(new ForgeProvider("test").resolveInstallPlan("1.5.2")).rejects.toThrow(/unknown forge-supported/i);
  });
});
