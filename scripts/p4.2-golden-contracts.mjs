import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { canonical, sha256, verifyCapture } from "./p4.2-fixture-contracts.mjs";

export const FIXTURE_SOURCE_PATHS = Object.freeze([
  "fixtures/native/windows-app/Fixture/Fixture.csproj", "fixtures/native/windows-app/Fixture/Program.cs",
  "fixtures/native/windows-app/Capture/Capture.csproj", "fixtures/native/windows-app/Capture/Program.cs",
  "fixtures/native/windows-app/global.json", "fixtures/native/windows-app/NuGet.Config",
  "fixtures/native/windows-app/manifest-0.1.json", "fixtures/native/windows-app/manifest-0.1.schema.json",
  "scripts/setup-p4.2-dotnet.ps1", "scripts/run-p4.2-fixture.ps1", "scripts/p4.2-fixture-contracts.mjs",
  "scripts/p4.2-golden-contracts.mjs", "scripts/freeze-p4.2-goldens.mjs", "scripts/verify-p4.2-fixture.mjs",
  "scripts/verify-p4.2-goldens.mjs", "scripts/check-native-fixture-package.mjs", "test/p4.2-fixture.test.ts",
]);

export function sourceBinding(root, sourceCommit) {
  if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error("fixture_source_commit_invalid");
  const files = FIXTURE_SOURCE_PATHS.map(path => ({ path,
    blob: execFileSync("git", ["rev-parse", `${sourceCommit}:${path}`], { cwd: root, encoding: "utf8" }).trim() }));
  return { files, digest: sha256(files) };
}
export function requireCommittedFixture(root) {
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=all", "--", ...FIXTURE_SOURCE_PATHS], { cwd: root, encoding: "utf8" });
  if (dirty.trim()) throw new Error("fixture_source_not_committed");
  return { sourceCommit, sourceBinding: sourceBinding(root, sourceCommit) };
}
export function verifyRepeatedCaptures(inputs, manifest, validators) {
  if (inputs.length !== 2) throw new Error("fixture_two_runs_required");
  const results = inputs.map(input => verifyCapture(input, manifest, validators));
  if (results[0].semanticsDigest !== results[1].semanticsDigest || inputs[0].fixtureBinaryDigest !== inputs[1].fixtureBinaryDigest)
    throw new Error("fixture_repeatability_mismatch");
  if (inputs[0].cases[0].raw.processRef === inputs[1].cases[0].raw.processRef || inputs[0].cases[0].raw.windowRef === inputs[1].cases[0].raw.windowRef)
    throw new Error("fixture_repeat_run_not_independent");
  return results;
}
export function verifyGolden(golden, manifest, validators) {
  const keys = ["schemaVersion", "kind", "status", "evidenceDate", "sourceCommit", "sourceBinding", "captureBinaryDigest",
    "manifestDigest", "semanticsDigest", "captureDigests", "captures", "normalizedCases"];
  if (canonical(Object.keys(golden).sort()) !== canonical(keys.sort()) || golden.schemaVersion !== "0.1" ||
    golden.kind !== "p4.2-proposed-golden" || golden.status !== "proposed" || golden.evidenceDate !== "2026-10-03" ||
    !/^[a-f0-9]{40}$/.test(golden.sourceCommit) || !/^sha256:[a-f0-9]{64}$/.test(golden.captureBinaryDigest))
    throw new Error("fixture_golden_envelope_invalid");
  const binding = golden.sourceBinding;
  if (!binding || canonical(Object.keys(binding).sort()) !== canonical(["digest", "files"]) || !Array.isArray(binding.files) ||
    canonical(binding.files.map(file => file.path)) !== canonical(FIXTURE_SOURCE_PATHS) ||
    binding.files.some(file => canonical(Object.keys(file).sort()) !== canonical(["blob", "path"]) || !/^[a-f0-9]{40}$/.test(file.blob)) ||
    binding.digest !== sha256(binding.files)) throw new Error("fixture_golden_source_binding_invalid");
  const results = verifyRepeatedCaptures(golden.captures, manifest, validators);
  if (golden.manifestDigest !== results[0].manifestDigest || golden.semanticsDigest !== results[0].semanticsDigest ||
    canonical(golden.captureDigests) !== canonical(golden.captures.map(sha256)) ||
    canonical(golden.normalizedCases) !== canonical(results[0].cases)) throw new Error("fixture_golden_drift");
  return { status: "proposed_golden_verified", cases: results[0].cases.length, sourceCommit: golden.sourceCommit,
    manifestDigest: golden.manifestDigest, semanticsDigest: golden.semanticsDigest };
}
export async function verifyGoldenSource(root, golden) {
  const expected = sourceBinding(root, golden.sourceCommit);
  if (canonical(golden.sourceBinding) !== canonical(expected)) throw new Error("fixture_golden_source_binding_mismatch");
  // Compare normalized source text, not checkout-specific LF/CRLF bytes.
  for (const path of FIXTURE_SOURCE_PATHS) {
    const frozen = execFileSync("git", ["show", `${golden.sourceCommit}:${path}`], { cwd: root, encoding: "utf8" });
    const current = await readFile(join(root, path), "utf8");
    if (current.replaceAll("\r\n", "\n") !== frozen.replaceAll("\r\n", "\n")) throw new Error("fixture_source_drift");
  }
}
