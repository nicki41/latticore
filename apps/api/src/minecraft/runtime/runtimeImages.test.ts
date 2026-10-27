import { describe, expect, it } from "vitest";
import { resolveRuntimeImageTag, runtimeImageFor } from "./runtimeImages.js";

describe("runtimeImageFor", () => {
  it("moves a tag stored before the rename to the configured base", () => {
    expect(runtimeImageFor("ghcr.io/nicki41/minecontroller-runtime:java21", "ghcr.io/nicki41/latticore-runtime")).toBe("ghcr.io/nicki41/latticore-runtime:java21");
  });

  it("keeps the old name while an install is still configured with it", () => {
    expect(runtimeImageFor("ghcr.io/nicki41/latticore-runtime:java25", "ghcr.io/nicki41/minecontroller-runtime")).toBe("ghcr.io/nicki41/minecontroller-runtime:java25");
  });

  it("leaves images from any other base alone", () => {
    expect(runtimeImageFor("latticore-runtime-local:java21", "ghcr.io/nicki41/latticore-runtime")).toBe("latticore-runtime-local:java21");
    expect(runtimeImageFor("ghcr.io/someone/fork-runtime:java17", "ghcr.io/nicki41/latticore-runtime")).toBe("ghcr.io/someone/fork-runtime:java17");
  });

  it("matches the official base exactly, not as a prefix of a longer name", () => {
    expect(runtimeImageFor("ghcr.io/nicki41/latticore-runtime-dev:java21", "x")).toBe("ghcr.io/nicki41/latticore-runtime-dev:java21");
  });

  it("defaults to the image names new servers get", () => {
    expect(runtimeImageFor("ghcr.io/nicki41/minecontroller-runtime:java8")).toBe(resolveRuntimeImageTag(8));
  });
});
