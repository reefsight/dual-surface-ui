import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { evaluatePhase3AuthorityEvidence, loadPhase3AuthorityValidators, PHASE3_AUTHORITY_GATES } from "./phase3-evidence-gates.mjs";

const root = process.cwd();
const outputPath = resolve(root, ".phase3-preflight", "report.json");
const requiredReady = process.argv.includes("--require-ready");
const shaPattern = /^sha256:[a-f0-9]{64}$/;
const exists = async (path) => access(path).then(() => true, () => false);
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
const check = (id, status, evidence, detail) => ({ id, status, evidence, detail });
const authorityValidators = await loadPhase3AuthorityValidators(root);

const conformance = await readJson("docs/evidence/p3.6-conformance-report-2026-09-21.json");
const adversarial = await readJson("docs/evidence/p3.7-adversarial-report-2026-09-21.json");
const golden = await readJson("docs/evidence/p3.8-golden-task-suite-2026-09-21.json");
const structural = await readJson("docs/evidence/p3.9-structural-benchmark-2026-09-21.json");
const checks = [
  check("p3.6.conformance", conformance.kind === "agent-conformance-report" && conformance.source?.dirty === false && conformance.summary?.failed === 0 && shaPattern.test(conformance.reportDigest) ? "ready" : "failed", "docs/evidence/p3.6-conformance-report-2026-09-21.json", "cross-exporter report must be clean, digest-bound, and failure-free"),
  check("p3.7.automated", adversarial.kind === "phase3-adversarial-evidence" && adversarial.summary?.failed === 0 && adversarial.summary?.unauthorizedMutations === 0 && adversarial.summary?.unresolvedCriticalHigh === 0 && adversarial.summary?.sentinelMatches === 0 ? "ready" : "failed", "docs/evidence/p3.7-adversarial-report-2026-09-21.json", "automated adversarial controls must have zero failures, unauthorized mutations, unresolved critical/high findings, and leaks"),
  check("p3.8.fixture", golden.kind === "phase3-golden-task-evidence" && golden.taskCount === 12 && golden.dimensions?.length === 8 && shaPattern.test(golden.suiteDigest) ? "ready" : "failed", "docs/evidence/p3.8-golden-task-suite-2026-09-21.json", "golden suite must remain frozen and digest-bound"),
  check("p3.9.structural", structural.kind === "phase3-structural-benchmark-report" && structural.sourceDirty === false && structural.measurements?.length === 48 && structural.quality?.completion === null && shaPattern.test(structural.reportDigest) ? "ready" : "failed", "docs/evidence/p3.9-structural-benchmark-2026-09-21.json", "structural evidence must be clean and preserve unavailable model claims"),
];

for (const [type, gate] of Object.entries(PHASE3_AUTHORITY_GATES)) {
  if (!await exists(resolve(root, gate.canonicalPath))) checks.push(check(gate.id, "missing", gate.canonicalPath, "authority-bound evidence is absent"));
  else {
    try {
      const value = await readJson(gate.canonicalPath);
      const result = evaluatePhase3AuthorityEvidence(type, value, authorityValidators);
      checks.push(check(gate.id, result.gateReady ? "ready" : "failed", gate.canonicalPath, "authority-bound evidence must satisfy its strict contract and frozen gate"));
    }
    catch { checks.push(check(gate.id, "failed", gate.canonicalPath, "authority-bound evidence is not valid JSON")); }
  }
}

const ready = checks.every(({ status }) => status === "ready");
const reportBase = {
  schemaVersion: "0.1", kind: "phase3-readiness-preflight", status: ready ? "ready" : "not_ready",
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  sourceDirty: execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim().length > 0,
  readyForP310: ready, checks,
  summary: { ready: checks.filter(({ status }) => status === "ready").length, missing: checks.filter(({ status }) => status === "missing").length, failed: checks.filter(({ status }) => status === "failed").length },
};
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const report = { ...reportBase, reportDigest: `sha256:${createHash("sha256").update(`dual-surface-ui:phase3-readiness:0.1\0${JSON.stringify(canonical(reportBase))}`).digest("hex")}` };
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
const trackedPath = process.env.DSUI_PHASE3_PREFLIGHT_PATH;
if (trackedPath) {
  if (!isAbsolute(trackedPath)) throw new Error("DSUI_PHASE3_PREFLIGHT_PATH must be absolute");
  const rel = relative(root, trackedPath).replaceAll("\\", "/");
  if (rel.startsWith("../") || !rel.startsWith("docs/evidence/")) throw new Error("tracked preflight path must stay under docs/evidence");
  await mkdir(dirname(trackedPath), { recursive: true });
  await writeFile(trackedPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
console.log(JSON.stringify({ status: report.status, readyForP310: report.readyForP310, summary: report.summary, reportDigest: report.reportDigest }));
if (requiredReady && !ready) process.exitCode = 2;
