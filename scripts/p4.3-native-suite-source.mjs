import { createHash } from "node:crypto";
import { open, lstat, realpath } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { nativeCollectorBinding } from "./p4.3-native-capture-source.mjs";
import { parseCapturePublication } from "./p4.3-capture-contracts.mjs";
import { loadAcceptedCaptureOracle } from "./p4.3-capture-contracts.mjs";

export const NATIVE_SUITE_PATHS = Object.freeze([
  "docs/work-items/P4.3-native-capture-suite-integration.md",
  "experiments/windows-uia/managed-reference/CaptureSuite/CaptureSuite.csproj",
  "experiments/windows-uia/managed-reference/CaptureSuite/FixtureRecords.cs",
  "experiments/windows-uia/managed-reference/CaptureSuite/OwnedFiles.cs",
  "experiments/windows-uia/managed-reference/CaptureSuite/Program.cs",
  "experiments/windows-uia/managed-reference/CaptureSuite/SuiteFreeze.cs",
  "experiments/windows-uia/managed-reference/CaptureSuite/TrustedSetup.cs",
  "experiments/windows-uia/managed-reference/CaptureSuite/UnitCases.cs",
  "scripts/p4.3-native-suite-contracts.mjs", "scripts/p4.3-native-suite-source.mjs",
  "scripts/run-p4.3-capture-suite.ps1", "scripts/verify-p4.3-native-suite.mjs", "test/p4.3-native-suite.test.ts",
].sort());
const REVIEW_PATHS = Object.freeze(["docs/reviews/p4.3-native-suite-security-agent-review.md",
  "docs/reviews/p4.3-native-suite-accessibility-agent-review.md", "docs/reviews/p4.3-native-suite-package-agent-review.md"]);
const REVIEW_AGENTS = Object.freeze(["/root/p42_security_review", "/root/p42_accessibility_interop_review", "/root/p42_package_gate_review"]);
const APPROVAL_LABELS = Object.freeze(["Reviewer agent", "Disposition", "Reviewed source", "Unresolved Critical/High/Medium", "Native execution"]);
const ENTRY = "docs/reviews/p4.3-native-suite-execution-entry-2026-10-04.md";
const DLL = "experiments/windows-uia/managed-reference/CaptureSuite/bin/Release/net10.0-windows/DualSurface.UiaCaptureSuite.dll";
const FIXTURE = "fixtures/native/windows-app/Fixture/bin/Release/net10.0-windows/DualSurface.Fixture.dll";
const FIXTURE_DIGEST = "sha256:05491f5a44d01e9a25f5098d86a4919abb9bb8d6f4d44a4050dcf2560107161d";
const refuse = () => { throw new TypeError("native_suite_source_refused"); };
const digest = value => "sha256:" + createHash("sha256").update(value).digest("hex");
const text = bytes => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes).replaceAll("\r\n", "\n");
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
const blob = value => createHash("sha1").update("blob " + Buffer.byteLength(value, "utf8") + "\0").update(value, "utf8").digest("hex");

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
export async function nativeSuiteBinding(root) {
  const component = (await nativeCollectorBinding(root)).digest;
  if (component !== "sha256:af7a01ef530fcaaf1acbb08942670a7c37ba1e6339090a804fa1167d5461d605") refuse();
  const files = [];
  for (const path of NATIVE_SUITE_PATHS) files.push({ path, digest: digest(text(await fixedRead(root, path, 1048576))) });
  return { files, component, digest: digest(JSON.stringify({ files, component })) };
}
export async function admitNativeSuiteFreeze(root) {
  const freeze = parseCapturePublication(await fixedRead(root, "docs/evidence/p4.3-native-suite-freeze.json", 32768));
  if (!exact(freeze, ["schemaVersion", "kind", "status", "sourceDigest", "collectorBinaryDigest", "fixtureBinaryDigest", "reviewReports", "decision"]) ||
      freeze.schemaVersion !== "0.1" || freeze.kind !== "p4.3-native-capture-suite-freeze" || freeze.status !== "source-approved" ||
      freeze.fixtureBinaryDigest !== FIXTURE_DIGEST || (await nativeSuiteBinding(root)).digest !== freeze.sourceDigest ||
      digest(await fixedRead(root, DLL, 8388608)) !== freeze.collectorBinaryDigest ||
      digest(await fixedRead(root, FIXTURE, 8388608)) !== freeze.fixtureBinaryDigest ||
      !Array.isArray(freeze.reviewReports) || freeze.reviewReports.length !== 3) refuse();
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
    if (process.argv.length === 2) console.log(JSON.stringify(await nativeSuiteBinding(process.cwd())));
    else if (process.argv.length === 3 && process.argv[2] === "--admit") console.log(JSON.stringify(await admitNativeSuiteFreeze(process.cwd())));
    else refuse();
  } catch { console.error("p4.3_native_suite_source_refused"); process.exitCode = 1; }
}
