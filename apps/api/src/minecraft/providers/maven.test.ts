import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchMavenSha256, parseMavenMetadataVersions } from "./maven.js";

afterEach(() => vi.restoreAllMocks());

describe("fetchMavenSha256", () => {
  it("reads the hash from <artifact>.sha256, tolerating a trailing filename", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(`${"C".repeat(64)}  installer.jar\n`));
    await expect(fetchMavenSha256("https://maven.example/a.jar", "test")).resolves.toBe("c".repeat(64));
    expect(String(fetchSpy.mock.calls[0]![0])).toBe("https://maven.example/a.jar.sha256");
  });

  it("refuses anything that isn't a SHA-256 hex digest", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>not found</html>"));
    await expect(fetchMavenSha256("https://maven.example/a.jar", "test")).rejects.toThrow(/checksum/);
  });
});

describe("parseMavenMetadataVersions", () => {
  it("returns every <version> in file order", () => {
    expect(parseMavenMetadataVersions("<versions><version>1</version>\n<version> 2 </version></versions>")).toEqual(["1", "2"]);
  });
});
