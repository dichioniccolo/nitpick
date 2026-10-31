import { defineConfig } from "vitest/config";

// PGlite starts one in-memory Postgres per test file, which can pass vitest's
// 5 s default when every project runs at once.
export default defineConfig({
  test: { include: ["test/**/*.test.ts"], passWithNoTests: true, testTimeout: 30_000 },
});
