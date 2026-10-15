import { createHash } from "node:crypto";
import { open, lstat, realpath } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { nativeSuiteBinding, admitNativeSuiteFreeze } from "./p4.3-native-suite-source.mjs";
import { parseCapturePublication } from "./p4.3-capture-contracts.mjs";
import { loadAcceptedCaptureOracle } from "./p4.3-capture-contracts.mjs";

export const NATIVE_SUITE_CTX1_PATHS = Object.freeze([
  "docs/work-items/P4.3-native-capture-suite-integration.md",
  "docs/work-items/P4.3-window-handle-read-context-investigation.md",
  "docs/work-items/P4.3-admission-guard-diagnostics.md",
  "docs/work-items/P4.3-window-handle-read-context-ctx1-candidate.md",
  "experiments/windows-uia/managed-reference/global.json",
  "experiments/windows-uia/managed-reference/CaptureSuiteCtx1/CaptureSuiteCtx1.csproj",
  "experiments/windows-uia/managed-reference/CaptureSuiteCtx1/FailureDiagnostics.cs",
  "experiments/windows-uia/managed-reference/CaptureSuite/FixtureRecords.cs",
  "experiments/windows-uia/managed-reference/CaptureSuite/OwnedFiles.cs",
  "experiments/windows-uia/managed-reference/CaptureSuite/Program.cs",
  "experiments/windows-uia/managed-reference/CaptureSuiteCtx1/SuiteFreeze.cs",
  "experiments/windows-uia/managed-reference/CaptureSuiteCtx1/TrustedSetup.cs",
  "experiments/windows-uia/managed-reference/CaptureSuiteCtx1/UnitCases.cs",
  "scripts/p4.3-native-suite-contracts.mjs", "scripts/p4.3-native-suite-ctx1-source.mjs",
  "scripts/p4.3-native-suite-ctx1-failure-diagnostics.mjs", "test/p4.3-native-suite-ctx1-failure-diagnostics.test.ts",
  "scripts/run-p4.3-capture-suite-ctx1.ps1", "scripts/verify-p4.3-native-suite-ctx1.mjs", "test/p4.3-native-suite-ctx1.test.ts",
].sort());
const REVIEW_PATHS = Object.freeze(["docs/reviews/p4.3-native-suite-ctx1-security-agent-review.md",
  "docs/reviews/p4.3-native-suite-ctx1-accessibility-agent-review.md", "docs/reviews/p4.3-native-suite-ctx1-package-agent-review.md"]);
const REVIEW_AGENTS = Object.freeze(["/root/ctx1_source_security", "/root/ctx1_source_interop", "/root/ctx1_source_package"]);
const APPROVAL_LABELS = Object.freeze(["Reviewer agent", "Disposition", "Reviewed source", "Unresolved Critical/High/Medium", "Native execution"]);
const ENTRY = "docs/reviews/p4.3-native-suite-ctx1-execution-entry-2026-10-15.md";
const PROVENANCE = "docs/evidence/p4.3-native-suite-ctx1-build-provenance.json";
const DLL = "experiments/windows-uia/managed-reference/CaptureSuiteCtx1/bin/Release/net10.0-windows/DualSurface.UiaCaptureSuite.Ctx1.dll";
const FIXTURE = "fixtures/native/windows-app/Fixture/bin/Release/net10.0-windows/DualSurface.Fixture.dll";
export const BASELINE_R1_SOURCE_DIGEST = "sha256:0011376b411742d76078d0b67a65cc213236a38678d83869b6fc79f8578d3416";
const BASELINE_R1_FREEZE_BLOB = "c165cfcf4ff802eeb7f22d692c51066d0cf31b0f";
const FIXTURE_DIGEST = "sha256:05491f5a44d01e9a25f5098d86a4919abb9bb8d6f4d44a4050dcf2560107161d";
export const CTX1_EXECUTION_PATHS = Object.freeze([
  DLL.replace(/\.dll$/, ".deps.json"), DLL.replace(/\.dll$/, ".runtimeconfig.json"),
  FIXTURE.replace(/\.dll$/, ".deps.json"), FIXTURE.replace(/\.dll$/, ".runtimeconfig.json"),
]);
export const CTX1_BUILD_PATHS = Object.freeze([
  ...NATIVE_SUITE_CTX1_PATHS.filter(path => path.endsWith(".cs") || path.endsWith(".csproj") || path.endsWith("/global.json")),
  "experiments/windows-uia/managed-reference/CaptureHarness/CopiedObservation.cs",
  "experiments/windows-uia/managed-reference/CaptureHarness/FixtureSubjects.cs",
  "experiments/windows-uia/managed-reference/CaptureHarness/SemanticProjection.cs",
  "experiments/windows-uia/managed-reference/NativeCaptureHarness/OwnedWindowTopology.cs",
  "experiments/windows-uia/managed-reference/NativeCaptureHarness/OwnedWindowsAdmission.cs",
  "experiments/windows-uia/managed-reference/NativeCaptureHarness/ReadOnlyCollector.cs",
].sort());
const SDK_ARCHIVE = "24b670ad3d923bfcf47df6c3b034152398b42f6dbc388e10d783aee1cfb5e5817d399fc0ae2a12cfa822a55e61d34830ccb15c50ef6efee437ab874bb7c79430";
const BUILD_ARGUMENTS = Object.freeze(["build", "CaptureSuiteCtx1/CaptureSuiteCtx1.csproj", "-c", "Release", "-t:Rebuild", "--nologo"]);
const refuse = () => { throw new TypeError("native_suite_ctx1_source_refused"); };
const digest = value => "sha256:" + createHash("sha256").update(value).digest("hex");
const text = bytes => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes).replaceAll("\r\n", "\n");
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
const blob = value => createHash("sha1").update("blob " + Buffer.byteLength(value, "utf8") + "\0").update(value, "utf8").digest("hex");

// Private provenance parser. Token counting includes start/end containers and
// decoded keys, matching Utf8JsonReader; no change to frozen public parsers.
export function parseCtx1BuildProvenance(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > 32768 ||
      bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) refuse();
  let input; try { input = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { refuse(); }
  let at = 0, tokens = 0;
  const token = () => { if (++tokens > 2048) refuse(); };
  const space = () => { while (/[\x20\t\r\n]/.test(input[at] ?? "x")) at++; };
  const string = () => {
    token(); const start = at++;
    while (at < input.length) {
      const ch = input[at++]; if (ch === "\\") { at++; continue; }
      if (ch === '"') {
        let value; try { value = JSON.parse(input.slice(start, at)); } catch { refuse(); }
        if (!value.isWellFormed() || Buffer.byteLength(value, "utf8") > 512) refuse();
        return value;
      }
    }
    refuse();
  };
  const value = depth => {
    space(); const ch = input[at];
    if (ch === '"') return string();
    if (ch === "{" || ch === "[") {
      if (depth + 1 > 6) refuse(); token(); at++; space();
      const object = ch === "{", close = object ? "}" : "]", result = object ? Object.create(null) : [];
      const keys = new Set();
      if (input[at] === close) { at++; token(); return result; }
      while (true) {
        space(); if (object) {
          if (input[at] !== '"') refuse(); const key = string(); if (keys.has(key)) refuse(); keys.add(key);
          space(); if (input[at++] !== ":") refuse(); result[key] = value(depth + 1);
        } else result.push(value(depth + 1));
        space(); const delimiter = input[at++];
        if (delimiter === close) { token(); return result; } if (delimiter !== ",") refuse();
      }
    }
    token();
    for (const [literal, result] of [["true", true], ["false", false], ["null", null]])
      if (input.startsWith(literal, at)) { at += literal.length; return result; }
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(input.slice(at));
    if (!match || match[0].length > 512) refuse(); at += match[0].length; return Number(match[0]);
  };
  const result = value(0); space(); if (at !== input.length) refuse(); return result;
}
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function records(value, paths) {
  if (!Array.isArray(value) || value.length !== paths.length || value.some((item, i) =>
    !exact(item, ["path", "digest"]) || item.path !== paths[i] || typeof item.digest !== "string" ||
    item.digest.length !== 71 || !/^sha256:[a-f0-9]{64}$/.test(item.digest))) refuse();
  // Return canonical key order; input object property order is not authority.
  return value.map(item => ({ path: item.path, digest: item.digest }));
}
export function admitCtx1BuildProvenance(bytes, pins, executionFiles, buildFiles) {
  const v = parseCtx1BuildProvenance(bytes);
  const closure = records(executionFiles, CTX1_EXECUTION_PATHS), inputs = records(buildFiles, CTX1_BUILD_PATHS);
  if (!exact(v, ["schemaVersion", "kind", "sourceCommit", "sourceDigest", "buildInputs", "builds"]) ||
      v.schemaVersion !== "0.1" || v.kind !== "p4.3-native-suite-ctx1-build-provenance" ||
      typeof v.sourceCommit !== "string" || v.sourceCommit.length !== 40 || !/^[a-f0-9]{40}$/.test(v.sourceCommit) ||
      typeof v.sourceDigest !== "string" || v.sourceDigest.length !== 71 ||
      v.sourceDigest !== pins.sourceDigest || !/^sha256:[a-f0-9]{64}$/.test(v.sourceDigest)) refuse();
  const b = v.buildInputs;
  if (!exact(b, ["sdkVersion", "sdkArchiveDigest", "project", "configuration", "arguments", "files"]) ||
      b.sdkVersion !== "10.0.401" || b.sdkArchiveDigest !== SDK_ARCHIVE ||
      b.project !== "experiments/windows-uia/managed-reference/CaptureSuiteCtx1/CaptureSuiteCtx1.csproj" ||
      b.configuration !== "Release" || !equal(b.arguments, BUILD_ARGUMENTS) ||
      !equal(records(b.files, CTX1_BUILD_PATHS), inputs) || !Array.isArray(v.builds) || v.builds.length !== 2) refuse();
  for (let i = 0; i < 2; i++) {
    const run = v.builds[i];
    if (!exact(run, ["lane", "collectorBinaryDigest", "informationalRevision", "sourceLinkRevision", "executionFiles"]) ||
        run.lane !== ["first", "repeat"][i] || run.collectorBinaryDigest !== pins.collectorBinaryDigest ||
        typeof run.collectorBinaryDigest !== "string" || run.collectorBinaryDigest.length !== 71 ||
        !/^sha256:[a-f0-9]{64}$/.test(run.collectorBinaryDigest) || run.informationalRevision !== v.sourceCommit ||
        run.sourceLinkRevision !== v.sourceCommit || !equal(records(run.executionFiles, CTX1_EXECUTION_PATHS), closure)) refuse();
  }
  return v;
}
export function admitCtx1FreezeShape(freeze) {
  if (!exact(freeze, ["schemaVersion", "kind", "status", "sourceDigest", "collectorBinaryDigest", "fixtureBinaryDigest", "reviewReports", "decision", "executionFiles", "buildProvenance"]) ||
      freeze.schemaVersion !== "0.1" || freeze.kind !== "p4.3-native-capture-suite-ctx1-freeze" || freeze.status !== "source-approved" ||
      freeze.fixtureBinaryDigest !== FIXTURE_DIGEST || !Array.isArray(freeze.reviewReports) || freeze.reviewReports.length !== 3) refuse();
  for (const pin of [freeze.sourceDigest, freeze.collectorBinaryDigest])
    if (typeof pin !== "string" || pin.length !== 71 || !/^sha256:[a-f0-9]{64}$/.test(pin)) refuse();
  records(freeze.executionFiles, CTX1_EXECUTION_PATHS);
  for (const [item, path] of [...freeze.reviewReports.map((report, i) => [report, REVIEW_PATHS[i]]),
    [freeze.decision, ENTRY], [freeze.buildProvenance, PROVENANCE]])
    if (!exact(item, ["path", "blob"]) || item.path !== path || typeof item.blob !== "string" ||
        item.blob.length !== 40 || !/^[a-f0-9]{40}$/.test(item.blob)) refuse();
  return freeze;
}

// A pinned repository report is governance evidence, NOT a cryptographic
// signature proving who authored it. Admit current top-level canonical fields;
// quoted/fenced/history markers must never grant execution through substrings.
function requireApprovalMetadata(content, sourceDigest, reviewerAgent) {
  if (typeof content !== "string" || !content.length || content.length > 1048576 || !content.isWellFormed() ||
      Buffer.byteLength(content, "utf8") > 1048576 || content.startsWith("\ufeff") || content.includes("\0") ||
      typeof sourceDigest !== "string" || sourceDigest.length !== 71 || !/^sha256:[a-f0-9]{64}$/.test(sourceDigest) ||
      reviewerAgent !== null && !REVIEW_AGENTS.includes(reviewerAgent)) refuse();
  content = content.replaceAll("\r\n", "\n");
  if (content.includes("\r")) refuse();
  const fields = reviewerAgent === null ? new Map([
    ["Native execution", "authorized for the frozen fixed suite only"], ["Reviewed source", sourceDigest],
  ]) : new Map([
    ["Reviewer agent", reviewerAgent], ["Disposition", "source-approved"], ["Reviewed source", sourceDigest],
    ["Unresolved Critical/High/Medium", "0"],
  ]);
  // A fixed plaintext prefix prevents Markdown raw HTML, declarations,
  // processing instructions or an earlier hidden wrapper from enclosing fields.
  // The document body is not authority; current metadata cannot occur there.
  const prefix = content.split("\n");
  if (!/^# [A-Za-z0-9 .():/_-]{1,240}$/.test(prefix[0]) || prefix[1] !== "" ||
      prefix[2 + fields.size] !== "" ||
      [...fields].some(([label, value], index) => prefix[2 + index] !== label + ": " + value)) refuse();
  // Count literal reserved-label occurrences anywhere, including examples,
  // blockquotes and fenced history. An extra contradictory or stale field is
  // ambiguity even when one acceptable-looking line also exists.
  for (const label of APPROVAL_LABELS) {
    const token = label + ":";
    let count = 0, start = 0, found;
    while ((found = content.indexOf(token, start)) !== -1) { count++; start = found + token.length; }
    if (count !== (fields.has(label) ? 1 : 0)) refuse();
  }
  const observed = new Set();
  let fence = null, quote = false, comment = false;
  for (const line of content.split("\n")) {
    const fenceLine = /^[ \t]{0,3}(`{3,}|~{3,})([\s\S]*)$/.exec(line);
    if (fence !== null) {
      if (fenceLine && fenceLine[1][0] === fence.character && fenceLine[1].length >= fence.length && /^[ \t]*$/.test(fenceLine[2])) fence = null;
      continue;
    }
    const hidden = comment || line.includes("<!--");
    for (const marker of line.matchAll(/<!--|-->/g)) {
      if (marker[0] === "<!--") { if (comment) refuse(); comment = true; }
      else { if (!comment) refuse(); comment = false; }
    }
    if (/^[ \t]*$/.test(line)) quote = false;
    else if (/^[ \t]{0,3}>/.test(line)) quote = true;
    if (fenceLine && !hidden && !quote) {
      if (fenceLine[1][0] === "`" && fenceLine[2].includes("`")) refuse();
      fence = { character: fenceLine[1][0], length: fenceLine[1].length }; continue;
    }
    if (hidden || quote) continue;
    for (const [label, value] of fields) if (line === label + ": " + value) observed.add(label);
  }
  if (fence !== null || comment || observed.size !== fields.size) refuse();
}
export function admitSuiteReviewMetadata(content, reviewerAgent, sourceDigest) {
  if (!REVIEW_AGENTS.includes(reviewerAgent)) refuse();
  requireApprovalMetadata(content, sourceDigest, reviewerAgent);
}
export function admitSuiteDecisionMetadata(content, sourceDigest) {
  requireApprovalMetadata(content, sourceDigest, null);
}

async function fixedRead(root, path, cap) {
  const expected = resolve(root, path);
  for (let parent = expected; ; parent = dirname(parent)) {
    const info = await lstat(parent);
    if (info.isSymbolicLink()) refuse();
    if (parent === dirname(parent)) break;
  }
  if ((await realpath(expected)).toLowerCase() !== expected.toLowerCase()) refuse();
  const before = await lstat(expected);
  if (!before.isFile() || before.nlink !== 1 || before.size > cap) refuse();
  const file = await open(expected, "r");
  try {
    const opened = await file.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.size > cap || opened.dev !== before.dev || opened.ino !== before.ino) refuse();
    const bytes = Buffer.alloc(cap + 1); let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await file.read(bytes, length, bytes.length - length, length);
      if (!bytesRead) break;
      length += bytesRead; if (length > cap) refuse();
    }
    const after = await file.stat(), current = await lstat(expected);
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== length || after.nlink !== 1 ||
        current.dev !== opened.dev || current.ino !== opened.ino || current.isSymbolicLink() || current.nlink !== 1) refuse();
    return bytes.subarray(0, length);
  } finally { await file.close(); }
}
export async function requireNoCtx1DevConfigurations(root) {
  for (const path of [DLL, FIXTURE].map(path => path.replace(/\.dll$/, ".runtimeconfig.dev.json"))) {
    try { await lstat(resolve(root, path)); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
    refuse();
  }
}
// Original authority is checked for preservation only. Its consumed native entry
// is not renewed by reading the packet or executing separately admitted pure tests.
export async function admitBaselineR1Packet(root) {
  const baseline = await admitNativeSuiteFreeze(root);
  const bytes = await fixedRead(root, "docs/evidence/p4.3-native-suite-r1-freeze.json", 32768);
  if (blob(text(bytes)) !== BASELINE_R1_FREEZE_BLOB || baseline.sourceDigest !== BASELINE_R1_SOURCE_DIGEST) refuse();
  return baseline;
}
export async function nativeSuiteCtx1Binding(root) {
  const baselineR1 = (await nativeSuiteBinding(root)).digest;
  if (baselineR1 !== BASELINE_R1_SOURCE_DIGEST) refuse();
  const files = [];
  for (const path of NATIVE_SUITE_CTX1_PATHS) files.push({ path, digest: digest(text(await fixedRead(root, path, 1048576))) });
  return { files, baselineR1, digest: digest(JSON.stringify({ files, baselineR1 })) };
}
export async function admitNativeSuiteCtx1Freeze(root) {
  await admitBaselineR1Packet(root); // preservation only, never R1 launch authority
  const freeze = parseCapturePublication(await fixedRead(root, "docs/evidence/p4.3-native-suite-ctx1-freeze.json", 32768));
  admitCtx1FreezeShape(freeze);
  if ((await nativeSuiteCtx1Binding(root)).digest !== freeze.sourceDigest ||
      digest(await fixedRead(root, DLL, 8388608)) !== freeze.collectorBinaryDigest ||
      digest(await fixedRead(root, FIXTURE, 8388608)) !== freeze.fixtureBinaryDigest ||
      freeze.fixtureBinaryDigest !== FIXTURE_DIGEST) refuse();
  const closure = records(freeze.executionFiles, CTX1_EXECUTION_PATHS);
  for (const file of closure) if (digest(await fixedRead(root, file.path, 32768)) !== file.digest) refuse();
  // Fixed absence policy, including directories/broken symlinks. ENOENT alone
  // is absence; no enumeration or caller-selected companion is permitted.
  await requireNoCtx1DevConfigurations(root);
  if (!exact(freeze.buildProvenance, ["path", "blob"]) || freeze.buildProvenance.path !== PROVENANCE) refuse();
  const provenance = await fixedRead(root, PROVENANCE, 32768);
  if (blob(text(provenance)) !== freeze.buildProvenance.blob) refuse();
  const buildFiles = [];
  for (const path of CTX1_BUILD_PATHS) buildFiles.push({ path, digest: digest(text(await fixedRead(root, path, 1048576))) });
  admitCtx1BuildProvenance(provenance, freeze, closure, buildFiles);
  for (let i = 0; i < REVIEW_PATHS.length; i++) {
    const report = freeze.reviewReports[i];
    if (!exact(report, ["path", "blob"]) || report.path !== REVIEW_PATHS[i]) refuse();
    const content = text(await fixedRead(root, report.path, 1048576));
    if (blob(content) !== report.blob) refuse();
    admitSuiteReviewMetadata(content, REVIEW_AGENTS[i], freeze.sourceDigest);
  }
  if (!exact(freeze.decision, ["path", "blob"]) || freeze.decision.path !== ENTRY) refuse();
  const entry = text(await fixedRead(root, ENTRY, 1048576));
  if (blob(entry) !== freeze.decision.blob) refuse();
  admitSuiteDecisionMetadata(entry, freeze.sourceDigest);
  await loadAcceptedCaptureOracle(root); // accepted source/golden remains separately pinned
  return { sourceDigest: freeze.sourceDigest, collectorBinaryDigest: freeze.collectorBinaryDigest, fixtureBinaryDigest: freeze.fixtureBinaryDigest };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length === 3 && process.argv[2] === "--admit-baseline") console.log(JSON.stringify(await admitBaselineR1Packet(process.cwd())));
    else if (process.argv.length === 2) console.log(JSON.stringify(await nativeSuiteCtx1Binding(process.cwd())));
    else if (process.argv.length === 3 && process.argv[2] === "--admit") console.log(JSON.stringify(await admitNativeSuiteCtx1Freeze(process.cwd())));
    else refuse();
  } catch { console.error("p4.3_native_suite_ctx1_source_refused"); process.exitCode = 1; }
}
