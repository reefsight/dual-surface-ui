import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { captureFoundationBinding } from "./p4.3-capture-source.mjs";

export const NATIVE_COLLECTOR_PATHS = Object.freeze([
  "docs/work-items/P4.3-native-collector-component.md",
  "experiments/windows-uia/managed-reference/NativeCaptureHarness/NativeCaptureHarness.csproj",
  "experiments/windows-uia/managed-reference/NativeCaptureHarness/OwnedWindowTopology.cs",
  "experiments/windows-uia/managed-reference/NativeCaptureHarness/OwnedWindowsAdmission.cs",
  "experiments/windows-uia/managed-reference/NativeCaptureHarness/Program.cs",
  "experiments/windows-uia/managed-reference/NativeCaptureHarness/ReadOnlyCollector.cs",
  "scripts/p4.3-native-capture-source.mjs",
  "scripts/run-p4.3-native-capture-unit.ps1",
  "scripts/verify-p4.3-native-capture-unit.mjs",
  "test/p4.3-native-capture.test.ts",
].sort());
const digest = value => "sha256:" + createHash("sha256").update(value, "utf8").digest("hex");
export async function nativeCollectorBinding(root) {
  const foundation = (await captureFoundationBinding(root)).digest;
  if (foundation !== "sha256:79d5777287b327e9c355263e915836577994e052c7e70282c8cf466fa4c27f67")
    throw new TypeError("collector_foundation_drift");
  const files = [];
  for (const path of NATIVE_COLLECTOR_PATHS) {
    const bytes = await readFile(join(root, path));
    const normalized = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replaceAll("\r\n", "\n");
    files.push({ path, digest: digest(normalized) });
  }
  return { files, foundation, digest: digest(JSON.stringify({ files, foundation })) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const binding = await nativeCollectorBinding(process.cwd());
  console.log(JSON.stringify({ files: binding.files.length, foundation: binding.foundation, digest: binding.digest }));
}
