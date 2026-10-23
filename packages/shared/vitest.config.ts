import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only the sources — never the compiled copies under dist/.
    include: ["src/**/*.test.ts"],
  },
});
