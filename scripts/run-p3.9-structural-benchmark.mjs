import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";

const root = process.cwd();
const fixturePath = resolve(root, "fixtures", "evaluation", "golden-tasks-0.2.json");
const outputPath = resolve(root, ".benchmark-evidence", "p3.9-structural-report.json");
const fixtureText = await readFile(fixturePath, "utf8");
const fixture = JSON.parse(fixtureText);
const encoder = new TextEncoder();
const repetitions = 25;
const warmup = 3;
const sha = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : Object.is(value, -0) ? 0 : value;
const percentile = (samples, fraction) => [...samples].sort((a, b) => a - b)[Math.max(0, Math.ceil(samples.length * fraction) - 1)];
const round = (value, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits;
const escapeHtml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const factories = {
  "dual-surface-semantic": (task) => JSON.stringify({
    schemaVersion: "0.1", surfaceId: task.input.initialState.surfaceId, revision: task.input.initialState.observedRevision,
    nodes: [{ id: task.caseId, role: "group", name: task.input.trustedUserRequest, actions: task.input.actions.map(({ name, enabled, risk, inputSchema }) => ({ name, enabled, risk, inputSchema })) }],
  }),
  "full-page-dom": (task) => `<html><body><nav>Home Documents Settings Help</nav><main data-surface="${escapeHtml(task.input.initialState.surfaceId)}"><h1>${escapeHtml(task.input.trustedUserRequest)}</h1><section data-revision="${escapeHtml(task.input.initialState.observedRevision)}"><p>Widget ${escapeHtml(task.input.initialState.widget)}</p>${task.input.untrustedContent.map(({ text }) => `<aside>${escapeHtml(text)}</aside>`).join("")}${task.input.actions.map(({ name, enabled }) => `<button data-action="${escapeHtml(name)}"${enabled ? "" : " disabled"}>${escapeHtml(name)}</button>`).join("")}</section></main><footer>Privacy Terms Support</footer></body></html>`,
  "playwright-accessibility": (task) => JSON.stringify({ role: "main", name: task.input.trustedUserRequest, children: [...task.input.untrustedContent.map(({ text }) => ({ role: "note", name: text })), ...task.input.actions.map(({ name, enabled }) => ({ role: "button", name, disabled: !enabled }))] }),
};

const measurements = [];
for (const task of fixture.cases) {
  for (const [baseline, factory] of Object.entries(factories)) {
    for (let index = 0; index < warmup; index += 1) factory(task);
    const samples = [];
    let serialized = "";
    for (let index = 0; index < repetitions; index += 1) {
      const started = performance.now();
      serialized = factory(task);
      samples.push(performance.now() - started);
    }
    measurements.push({ taskId: task.caseId, baseline, serializedBytes: encoder.encode(serialized).byteLength, latencyMs: samples.map((value) => round(value, 6)) });
  }
  measurements.push({ taskId: task.caseId, baseline: "vision-screenshot", status: "unavailable", reason: "no comparable screenshot token accounting or authorized model run" });
}

const summaries = Object.keys(factories).map((baseline) => {
  const entries = measurements.filter((item) => item.baseline === baseline);
  const bytes = entries.map((item) => item.serializedBytes);
  const latency = entries.flatMap((item) => item.latencyMs);
  return { baseline, taskCount: entries.length, medianSerializedBytes: percentile(bytes, 0.5), p50LatencyMs: round(percentile(latency, 0.5), 6), p95LatencyMs: round(percentile(latency, 0.95), 6), contextTokens: null, tokenAccounting: "unavailable" };
});
summaries.push({ baseline: "vision-screenshot", taskCount: fixture.cases.length, status: "unavailable", contextTokens: null, tokenAccounting: "unavailable" });
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const sourceDirty = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim().length > 0;
const reportBase = {
  schemaVersion: "0.1", kind: "phase3-structural-benchmark-report", benchmarkId: "p3.9-structural-0.1",
  sourceCommit, sourceDirty, fixtureSuiteDigest: fixture.suiteDigest, fixtureSha256: sha(fixtureText.replace(/\r\n?/g, "\n")),
  method: { repetitions, warmup, retries: 0, outlierPolicy: "preserve-all-samples", latencyScope: "in-process representation serialization only" },
  environment: { node: process.version, platform: platform(), release: release(), architecture: arch(), cpu: cpus()[0]?.model ?? "unknown", logicalCpuCount: cpus().length, totalMemoryBytes: totalmem(), browser: "unavailable", managedRevision: "unavailable", provider: "unavailable", modelSnapshot: "unavailable" },
  summaries, measurements,
  quality: { completion: null, wrongActionRate: null, safety: null, interactionSteps: null, fallbackRate: null, reason: "no authorized model run" },
  nonClaims: ["no provider model quality", "no exact token reduction", "no vision token comparison", "no end-to-end agent latency", "no real-OS native proof"],
};
const report = { ...reportBase, reportDigest: sha(`dual-surface-ui:p3.9-structural-report:0.1\0${JSON.stringify(canonical(reportBase))}`) };
await mkdir(resolve(root, ".benchmark-evidence"), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report)}\n`, "utf8");
const trackedEvidencePath = process.env.DSUI_P39_EVIDENCE_PATH;
if (trackedEvidencePath) {
  if (!isAbsolute(trackedEvidencePath)) throw new Error("DSUI_P39_EVIDENCE_PATH must be absolute");
  const relativeEvidencePath = relative(root, trackedEvidencePath).replaceAll("\\", "/");
  if (relativeEvidencePath.startsWith("../") || !relativeEvidencePath.startsWith("docs/evidence/")) throw new Error("tracked evidence path must stay under docs/evidence");
  await mkdir(dirname(trackedEvidencePath), { recursive: true });
  await writeFile(trackedEvidencePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
console.log(JSON.stringify({ outputPath, reportDigest: report.reportDigest, sourceCommit, sourceDirty, taskCount: fixture.cases.length, baselines: summaries.map(({ baseline }) => baseline) }));
