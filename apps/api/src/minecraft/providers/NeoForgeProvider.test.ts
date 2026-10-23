import { describe, expect, it } from "vitest";
import { isBetterNeoForgeBuild, neoForgeVersionToMcVersion } from "./NeoForgeProvider.js";

describe("neoForgeVersionToMcVersion", () => {
  it("maps a plain X.Y.Z neoforge version to Minecraft 1.X.Y", () => {
    expect(neoForgeVersionToMcVersion("21.1.45")).toBe("1.21.1");
    expect(neoForgeVersionToMcVersion("21.11.45")).toBe("1.21.11");
  });

  it("drops the trailing .0 when the minecraft minor version is 0", () => {
    expect(neoForgeVersionToMcVersion("21.0.12")).toBe("1.21");
  });

  it("maps year-based versions (Minecraft 26.1+) to <year>.<drop>[.<hotfix>], not 1.x", () => {
    expect(neoForgeVersionToMcVersion("26.3.0.95")).toBe("26.3");
    expect(neoForgeVersionToMcVersion("26.1.2.122")).toBe("26.1.2");
    expect(neoForgeVersionToMcVersion("26.1.0.0-alpha.1+snapshot-1")).toBe("26.1");
  });

  it("handles prerelease suffixes on the 1.x scheme", () => {
    expect(neoForgeVersionToMcVersion("20.2.3-beta")).toBe("1.20.2");
  });

  it("returns null for garbage input and builds with no real Minecraft release behind them", () => {
    expect(neoForgeVersionToMcVersion("not-a-version")).toBeNull();
    expect(neoForgeVersionToMcVersion("0.25w14craftmine.3-beta")).toBeNull();
  });
});

describe("isBetterNeoForgeBuild", () => {
  const stable = (...patchParts: number[]) => ({ patchParts, isPrerelease: false });
  const pre = (...patchParts: number[]) => ({ patchParts, isPrerelease: true });

  it("accepts any candidate when there is no current build yet", () => {
    expect(isBetterNeoForgeBuild(stable(1), undefined)).toBe(true);
  });

  it("prefers a stable build over a prerelease, even with a lower patch number", () => {
    expect(isBetterNeoForgeBuild(stable(1), pre(99))).toBe(true);
    expect(isBetterNeoForgeBuild(pre(99), stable(1))).toBe(false);
  });

  it("prefers the higher patch number when stability is equal", () => {
    expect(isBetterNeoForgeBuild(stable(2), stable(1))).toBe(true);
    expect(isBetterNeoForgeBuild(stable(1), stable(2))).toBe(false);
  });

  it("compares multi-segment patch numbers positionally, not lexicographically", () => {
    expect(isBetterNeoForgeBuild(stable(1, 0), stable(0, 9))).toBe(true);
  });
});
