import { afterEach, describe, expect, it, vi } from "vitest";
import { VelocityProvider } from "./VelocityProvider.js";
import { BungeeCordProvider } from "./BungeeCordProvider.js";

afterEach(() => vi.restoreAllMocks());

function mockFetch(routes: Record<string, unknown>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    const hit = Object.entries(routes).find(([suffix]) => url.endsWith(suffix) || url.includes(suffix));
    return hit ? new Response(JSON.stringify(hit[1])) : new Response("not found", { status: 404 });
  });
}

const build = (id: number, channel: string) => ({
  id,
  channel,
  downloads: { "server:default": { name: `velocity-${id}.jar`, url: `https://fill-data.papermc.io/v1/objects/x/velocity-${id}.jar`, checksums: { sha256: "a".repeat(64) } } },
});

describe("VelocityProvider", () => {
  it("lists proxy versions newest first, snapshots marked unstable", async () => {
    mockFetch({ "/projects/velocity": { versions: { "4.0.0": ["4.3.0", "4.2.1-SNAPSHOT", "4.2.0"], "3.0.0": ["3.5.1", "3.6.0-SNAPSHOT"] } } });
    expect(await new VelocityProvider("test").listVersions()).toEqual([
      { id: "4.3.0", stable: true },
      { id: "4.2.1-SNAPSHOT", stable: false },
      { id: "4.2.0", stable: true },
      { id: "3.6.0-SNAPSHOT", stable: false },
      { id: "3.5.1", stable: true },
    ]);
  });

  it("prefers a recommended/stable build and takes the Java requirement from Fill", async () => {
    mockFetch({
      "/versions/4.3.0/builds": [build(50, "BETA"), build(44, "STABLE"), build(40, "RECOMMENDED")],
      "/versions/4.3.0": { version: { java: { version: { minimum: 25 } } } },
      "/projects/velocity": { versions: { "4.0.0": ["4.3.0"] } },
    });
    expect(await new VelocityProvider("test").resolveInstallPlan("4.3.0")).toMatchObject({
      kind: "direct-download",
      filename: "velocity-40.jar",
      sha256: "a".repeat(64),
      javaMajor: 25,
      loaderVersion: "40",
    });
  });
});

describe("BungeeCordProvider", () => {
  it("offers successful Jenkins builds and downloads the bootstrap jar from SpigotMC", async () => {
    mockFetch({ "/job/BungeeCord/api/json": { builds: [{ number: 2108, result: "FAILURE" }, { number: 2107, result: "SUCCESS" }, { number: 2106, result: "SUCCESS" }] } });
    const provider = new BungeeCordProvider("test");
    expect(await provider.listVersions()).toEqual([{ id: "2107", stable: true }, { id: "2106", stable: true }]);
    expect(await provider.resolveInstallPlan("2107")).toMatchObject({
      url: "https://hub.spigotmc.org/jenkins/job/BungeeCord/2107/artifact/bootstrap/target/BungeeCord.jar",
      filename: "BungeeCord.jar",
      loaderVersion: "2107",
    });
    await expect(provider.resolveInstallPlan("2108")).rejects.toThrow(/unknown bungeecord build/i);
  });
});
