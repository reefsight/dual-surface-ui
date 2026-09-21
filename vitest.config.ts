import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/conformance/aggregate.test.ts", "test/cross-exporter-conformance.test.ts"],
    setupFiles: ["test/setup.ts"],
    testTimeout: 30_000,
  },
});
