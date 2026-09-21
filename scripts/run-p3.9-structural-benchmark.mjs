import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

const root = process.cwd();
const fixturePath = resolve(root, "fixtures", "evaluation", "golden-tasks-0.1.json");
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
    schemaVersion: "0.1", surfaceId: task.initialState.surfaceId, revision: task.initialState.revision,
    nodes: [{ id: task.caseId, role: "button", name: task.userRequest, actions: task.permittedActions.map((name) => ({ name, risk: "consequential" })) }],
  }),
  "full-page-dom": (task) => `<html><body><main data-surface="${escapeHtml(task.initialState.surfaceId)}"><h1>${escapeHtml(task.userRequest)}</h1><section data-revision="${escapeHtml(task.initialState.revision)}"><p>Widget ${escapeHtml(task.initialState.widget)}</p>${[...task.permittedActions, ...task.forbiddenActions].map((action) => `<button data-action="${escapeHtml(action)}">${escapeHtml(action)}</button>`).join("")}</section></main></body></html>`,
  "playwright-accessibility": (task) => JSON.stringify({ role: "main", name: task.userRequest, children: [...task.permittedActions, ...task.forbiddenActions].map((name) => ({ role: "button", name })) }),
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
console.log(JSON.stringify({ outputPath, reportDigest: report.reportDigest, sourceCommit, sourceDirty, taskCount: fixture.cases.length, baselines: summaries.map(({ baseline }) => baseline) }));
