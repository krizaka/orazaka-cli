import { defineConfig } from "vitest/config";

/**
 * Vitest configuration for CLI E2E sandbox tests [ADR-033].
 * Isolated from the main Jest unit test suite.
 */
export default defineConfig({
  test: {
    include: ["e2e/**/*.e2e.test.ts"],
    testTimeout: 30_000,
    pool: "forks",
  },
});
