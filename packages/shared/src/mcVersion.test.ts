import { describe, expect, it } from "vitest";
import { compareMcVersions } from "./mcVersion.js";

describe("compareMcVersions", () => {
  it("orders 1.x and year-based versions numerically", () => {
    const sorted = ["1.21.11", "26.1", "1.7.10", "1.21", "26.1.2", "1.20.1"].sort(compareMcVersions);
    expect(sorted).toEqual(["1.7.10", "1.20.1", "1.21", "1.21.11", "26.1", "26.1.2"]);
  });

  it("treats a missing trailing segment as 0", () => {
    expect(compareMcVersions("1.21", "1.21.0")).toBe(0);
  });
});
