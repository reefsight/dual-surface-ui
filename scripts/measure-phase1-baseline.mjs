import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

import { JSDOM } from "jsdom";
import { createAgentSurface } from "../dist/index.js";
import { defineDomainElement } from "../dist/domain/index.js";

import {
  createDocumentApprovalWorkflow,
  EXPECTED_AGENT_STEPS,
  installWindowGlobals,
} from "../examples/document-approval/workflow.mjs";
import {
  canonicalTextSha256,
  round,
  summarizeBaselineSamples,
} from "./phase1-baseline-lib.mjs";

const repetitions = 25;
const html = await readFile(
  resolve("examples/document-approval/index.html"),
  "utf8",
);
const latenciesMs = [];
const stepCounts = [];
const completions = [];
let confirmations = 0;
let secretLeaks = 0;
let wrongActions = 0;
let unauthorizedConsequentialActions = 0;
let fullDom = "";
let semanticSnapshot = "";

for (let iteration = 0; iteration < repetitions; iteration += 1) {
  const dom = new JSDOM(html, {
    url: "https://example.test/approvals/DOC-1042",
  });
  installWindowGlobals(dom.window);
  const workflow = createDocumentApprovalWorkflow({
    document: dom.window.document,
    createAgentSurface,
    defineDomainElement,
  });
  if (iteration === 0) fullDom = dom.serialize();

  const startedAt = performance.now();
  const outcome = await workflow.runAgentWorkflow();
  latenciesMs.push(performance.now() - startedAt);
  stepCounts.push(outcome.steps.length);
  confirmations += workflow.confirmationCount;

  const completed =
    outcome.result.status === "succeeded" &&
    workflow.status.textContent === "Approved" &&
    workflow.approvalCount === 1;
  completions.push(completed);
  const comparedStepCount = Math.max(
    outcome.steps.length,
    EXPECTED_AGENT_STEPS.length,
  );
  for (let index = 0; index < comparedStepCount; index += 1) {
    if (outcome.steps[index] !== EXPECTED_AGENT_STEPS[index]) wrongActions += 1;
  }
  if (workflow.approvalCount > 0 && workflow.confirmationCount !== 1) {
    unauthorizedConsequentialActions += 1;
  }

  const serialized = JSON.stringify({
    snapshot: outcome.initialSnapshot,
    result: outcome.result,
    auditEvents: workflow.auditEvents,
  });
  if (serialized.includes("SECRET_SENTINEL_DO_NOT_EXPOSE")) secretLeaks += 1;
  if (iteration === 0) semanticSnapshot = JSON.stringify(outcome.initialSnapshot);
  dom.window.close();
}

const metrics = summarizeBaselineSamples({
  fullDom,
  semanticSnapshot,
  latenciesMs,
  stepCounts,
  completions,
  confirmations,
  secretLeaks,
  wrongActions,
  unauthorizedConsequentialActions,
});

console.log(
  JSON.stringify(
    {
      schemaVersion: "1",
      benchmarkId: "phase1-document-approval-v1",
      mode: "deterministic-scripted-no-model",
      measuredAt: new Date().toISOString(),
      sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      fixture: "examples/document-approval/index.html",
      fixtureSha256: canonicalTextSha256(html),
      workflowPath:
        "observe -> toggle identity -> toggle terms -> approve_document",
      latencyScope:
        "snapshot plus two native toggles and one confirmed domain action; excludes DOM parse and setup",
      environment: {
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
      },
      ...metrics,
      samples: {
        latencyMs: latenciesMs.map((value) => round(value)),
        interactionSteps: stepCounts,
        completed: completions,
      },
    },
    null,
    2,
  ),
);
