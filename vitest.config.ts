import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/setup.ts"],
    // Embedded-Postgres (PGlite) tests: WASM cold-start per worker is heavy,
    // so cap concurrency and give init-bearing hooks room to breathe.
    hookTimeout: 30_000,
    testTimeout: 30_000,
    maxWorkers: 4,
  },
});
