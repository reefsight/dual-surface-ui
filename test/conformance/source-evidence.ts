import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { digestConformanceValue } from "./canonical.js";
import { CONFORMANCE_DOMAINS } from "./validation.js";

export const CONFORMANCE_REVIEWED_ROOTS = Object.freeze([
  "fixtures/conformance",
  "test/conformance",
  "test/cross-exporter-conformance.test.ts",
  "e2e/browser/conformance.spec.ts",
  "e2e/native",
  "scripts/browser-fixture-server.mjs",
  "scripts/check-conformance-package.mjs",
  "scripts/run-conformance-aggregate.mjs",
  "package.json",
  "playwright.config.ts",
  "playwright.native.config.ts",
  "tsconfig.json",
  "vitest.config.ts",
] as const);

export interface ConformanceSourceManifestEntry {
  readonly path: string;
  readonly digest: `sha256:${string}`;
}

export const digestConformanceSourceBytes = (bytes: Uint8Array | string): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export async function digestConformanceSourceManifest(entries: readonly ConformanceSourceManifestEntry[]) {
  return digestConformanceValue(CONFORMANCE_DOMAINS.sourceTree, entries);
}

export function assertConformanceSourceClean(porcelain: string): void {
  if (porcelain.trim() !== "") throw new TypeError("conformance_source_is_dirty");
}

async function filesBelow(root: string, path: string): Promise<string[]> {
  const absolute = resolve(root, path);
  if ((await stat(absolute)).isFile()) return [path.replaceAll("\\", "/")];
  const result: string[] = [];
  for (const name of (await readdir(absolute)).sort()) result.push(...await filesBelow(root, `${path}/${name}`));
  return result;
}

export async function collectConformanceSourceEvidence(root: string) {
  const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=all", "--", ...CONFORMANCE_REVIEWED_ROOTS], { cwd: root, encoding: "utf8" });
  assertConformanceSourceClean(dirty);
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const paths = (await Promise.all(CONFORMANCE_REVIEWED_ROOTS.map((path) => filesBelow(root, path)))).flat().sort();
  const manifest: ConformanceSourceManifestEntry[] = [];
  for (const path of paths) manifest.push({ path, digest: digestConformanceSourceBytes(await readFile(resolve(root, path))) });
  return Object.freeze({
    commit,
    treeDigest: await digestConformanceSourceManifest(manifest),
    dirty: false as const,
  });
}
