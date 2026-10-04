import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Separate from the accepted S1 binding. Normalized checkout source, not a
// signed/reproducible binary or native-evidence provenance assertion.
export const CAPTURE_FOUNDATION_PATHS = Object.freeze([
  "docs/work-items/P4.3-capture-foundation-increment.md",
  "experiments/windows-uia/managed-reference/CaptureHarness/CaptureHarness.csproj",
  "experiments/windows-uia/managed-reference/CaptureHarness/CopiedObservation.cs",
  "experiments/windows-uia/managed-reference/CaptureHarness/FixtureSubjects.cs",
  "experiments/windows-uia/managed-reference/CaptureHarness/Program.cs",
  "experiments/windows-uia/managed-reference/CaptureHarness/SemanticProjection.cs",
  "experiments/windows-uia/managed-reference/CaptureHarness/UnitCases.cs",
  "scripts/p4.3-capture-contracts.mjs",
  "scripts/p4.3-capture-source.mjs",
  "scripts/run-p4.3-capture-unit.ps1",
  "scripts/verify-p4.3-capture-unit.mjs",
  "test/p4.3-capture.test.ts",
].sort());
const digest = text => "sha256:" + createHash("sha256").update(text, "utf8").digest("hex");
export async function captureFoundationBinding(root) {
  const files = [];
  for (const path of CAPTURE_FOUNDATION_PATHS) {
    const bytes = await readFile(join(root, path));
    const normalized = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replaceAll("\r\n", "\n");
    files.push({ path, digest: digest(normalized) });
  }
  return { files, digest: digest(JSON.stringify(files)) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const binding = await captureFoundationBinding(process.cwd());
  console.log(JSON.stringify({ files: binding.files.length, digest: binding.digest }));
}
