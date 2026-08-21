import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      // Required by app.ts; a fixed value keeps signed cookies stable in tests.
      SESSION_SECRET: process.env.SESSION_SECRET ?? "test-session-secret",
      NODE_ENV: "test",
    },
    // API/service integration tests share a single DB; run serially to keep
    // invariant assertions deterministic.
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
