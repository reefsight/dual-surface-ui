import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CONFORMANCE_REVIEWED_ROOTS,
  assertConformanceSourceClean,
  digestConformanceSourceBytes,
  digestConformanceSourceManifest,
} from "./source-evidence.js";

const newlyReviewed = [
  "scripts/browser-fixture-server.mjs",
  "package.json",
  "playwright.config.ts",
  "playwright.native.config.ts",
  "tsconfig.json",
  "vitest.config.ts",
] as const;

describe("conformance source evidence", () => {
  it.each(newlyReviewed)("binds mutations of %s into the source-tree digest", async (path) => {
    expect(CONFORMANCE_REVIEWED_ROOTS).toContain(path);
    const bytes = await readFile(resolve(process.cwd(), path));
    const baseline = await digestConformanceSourceManifest([{ path, digest: digestConformanceSourceBytes(bytes) }]);
    const mutated = await digestConformanceSourceManifest([{ path, digest: digestConformanceSourceBytes(Buffer.concat([bytes, Buffer.from([0])])) }]);
    expect(mutated).not.toBe(baseline);
  });

  it.each(newlyReviewed)("rejects a dirty status entry for %s", (path) => {
    expect(() => assertConformanceSourceClean(` M ${path}\n`)).toThrow("conformance_source_is_dirty");
  });

  it("accepts an empty scoped porcelain result", () => {
    expect(() => assertConformanceSourceClean("\n")).not.toThrow();
  });
});
