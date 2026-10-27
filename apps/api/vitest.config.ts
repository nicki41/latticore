import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    restoreMocks: true,
    // Dummy-but-valid values so importing config/env.ts in unit tests
    // (directly or transitively) doesn't throw EnvValidationError. Real
    // integration tests that need a live DB set their own DATABASE_URL.
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "file:./test-dummy.db",
      SESSION_SECRET: "test-session-secret-not-for-production-use-0000",
      HOST_DATA_PATH: "/tmp/latticore-test-data",
      COOKIE_SECURE: "false",
    },
  },
});
