// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CONFORMANCE_CASE_IDS,
  CONFORMANCE_TARGETS,
  ConformanceScanCollector,
  captureAndValidateCapabilityMatrix,
  captureAndValidateConformanceScenario,
  captureAndValidateSentinelCorpus,
  captureAndValidateSuiteManifest,
  runConformanceCase,
  runConformanceTarget,
  writeConformanceTierFragment,
  type ConformanceExecutionPlan,
  type ConformanceFixtureHost,
  type ConformanceScenario,
  type ConformanceTarget,
} from "./conformance/index.js";
import { createDomConformanceBinding } from "./conformance/drivers/dom.js";
import { createMcpConformanceBinding } from "./conformance/drivers/mcp.js";
import { createWebMcpConformanceBinding } from "./conformance/drivers/webmcp.js";

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(process.cwd(), "fixtures", "conformance", path), "utf8"));
}

async function artifacts() {
  const matrix = await captureAndValidateCapabilityMatrix(await json("capability-matrix-0.1.json"));
  const corpus = await captureAndValidateSentinelCorpus(await json("sentinels-0.1.json"));
  const scenarios: ConformanceScenario[] = [];
  for (const caseId of CONFORMANCE_CASE_IDS) {
    scenarios.push(await captureAndValidateConformanceScenario(await json(`scenarios/${caseId}.json`)));
  }
  const frozenScenarios = Object.freeze(scenarios);
  const suite = await captureAndValidateSuiteManifest(await json("suite-0.1.json"), matrix, frozenScenarios);
  return { corpus, matrix, scenarios: frozenScenarios, suite };
}

const supportedTargets = CONFORMANCE_TARGETS.filter((target) =>
  target.targetId === "dom-jsdom" || target.targetId === "webmcp-compat" || target.targetId === "mcp-sdk",
);

const fixtureHost: ConformanceFixtureHost = Object.freeze({
  create(plan: Readonly<ConformanceExecutionPlan>, target: ConformanceTarget) {
    switch (target.targetId) {
      case "dom-jsdom": return createDomConformanceBinding(plan, target);
      case "webmcp-compat": return createWebMcpConformanceBinding(plan, target);
      case "mcp-sdk": return createMcpConformanceBinding(plan, target);
      default: throw new TypeError(`No in-process conformance driver for ${target.targetId}`);
    }
  },
});

function stableCases(value: Awaited<ReturnType<typeof runConformanceTarget>>) {
  const order = new Map(CONFORMANCE_CASE_IDS.map((id, index) => [id, index]));
  return [...value.cases].sort((left, right) => order.get(left.caseId)! - order.get(right.caseId)!);
}

describe("cross-exporter conformance", () => {
  it("runs the exact 26-case matrix through DOM, WebMCP, and MCP", async () => {
    const { corpus, matrix, scenarios, suite } = await artifacts();
    const direction = process.env.CONFORMANCE_DIRECTION === "reverse" ? "reverse" : "forward";
    const filter = process.env.CONFORMANCE_TARGET_FILTER;
    const selectedTargets = filter ? supportedTargets.filter(({ targetId }) => targetId === filter) : supportedTargets;
    if (filter && selectedTargets.length !== 1) throw new TypeError("invalid_conformance_target_filter");
    const orderedTargets = direction === "reverse" ? [...selectedTargets].reverse() : selectedTargets;
    const orderedScenarios = direction === "reverse" ? [...scenarios].reverse() : scenarios;
    for (const target of orderedTargets) {
      const forwardScan = new ConformanceScanCollector(corpus);
      const result = await runConformanceTarget({
        target,
        scenarios: orderedScenarios,
        matrix,
        fixtureHost,
        sentinelCorpus: corpus,
        scan: forwardScan,
      });
      expect(stableCases(result).map((item) => item.caseId)).toEqual(CONFORMANCE_CASE_IDS);
      expect(result.cases.filter((item) => item.status === "failed"), target.targetId).toEqual([]);
      expect(result.summary.failed, target.targetId).toBe(0);
      expect(result.summary.unsupported, target.targetId).toBe(target.targetId === "dom-jsdom" ? 4 : 0);
      expect(result.summary.passed, target.targetId).toBe(target.targetId === "dom-jsdom" ? 22 : 26);
      await writeConformanceTierFragment({
        suiteDigest: suite.suiteDigest,
        targetId: target.targetId,
        environmentKey: "node",
        direction,
        run: Object.freeze({ ...result, cases: Object.freeze(stableCases(result)) }),
        scan: forwardScan.partialEvidence(),
      });
    }
  }, 60_000);

  it("is byte-stable across repeats and reversed adapter/scenario order", async () => {
    if (process.env.CONFORMANCE_EVIDENCE_ONLY === "1") return;
    const { corpus, matrix, scenarios } = await artifacts();
    const execute = async (targets: readonly ConformanceTarget[], cases: readonly ConformanceScenario[]) => {
      const records: Array<{ targetId: string; cases: unknown }> = [];
      for (const target of targets) {
        const result = await runConformanceTarget({
          target,
          scenarios: cases,
          matrix,
          fixtureHost,
          sentinelCorpus: corpus,
          scan: new ConformanceScanCollector(corpus),
        });
        records.push({ targetId: target.targetId, cases: stableCases(result) });
      }
      records.sort((left, right) => left.targetId.localeCompare(right.targetId, "en"));
      return JSON.stringify(records);
    };
    const forward = await execute(supportedTargets, scenarios);
    const repeat = await execute(supportedTargets, scenarios);
    const reversed = await execute([...supportedTargets].reverse(), [...scenarios].reverse());
    expect(repeat).toBe(forward);
    expect(reversed).toBe(forward);
  }, 120_000);

  it("rejects a driver that fabricates a passing transcript without changing authoritative state", async () => {
    if (process.env.CONFORMANCE_EVIDENCE_ONLY === "1") return;
    const { corpus, matrix, scenarios } = await artifacts();
    const scenario = scenarios.find((item) => item.scenarioId === "SUCCESS-01")!;
    const target = CONFORMANCE_TARGETS[0];
    const result = await runConformanceCase({
      scenario,
      target,
      matrix,
      sentinelCorpus: corpus,
      scan: new ConformanceScanCollector(corpus),
      fixtureHost: Object.freeze({
        create(plan: Readonly<ConformanceExecutionPlan>) {
          return Object.freeze({
            driver: Object.freeze({
              targetId: "dom-jsdom" as const,
              family: "dom" as const,
              tier: "in-process" as const,
              async run() {
                return {
                  discovery: [{
                    actionRef: "approve",
                    risk: "consequential",
                    requiresConfirmation: false,
                    idempotency: "none",
                    inputSchema: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        decision: { type: "string", enum: ["approve", "reject"] },
                        note: { type: "string" },
                      },
                      required: ["decision"],
                    },
                  }],
                  outcomes: [{
                    operation: 1, status: "succeeded", previousRevision: "0",
                    revision: "1", actionRef: "approve", targetPresent: true,
                  }],
                  lifecycle: [
                    { operation: 1, event: "action_requested", outcome: "requested", sequence: 1, revision: "0", actionRef: "approve" },
                    { operation: 1, event: "policy_decided", outcome: "allow", sequence: 2, revision: "0", actionRef: "approve" },
                    { operation: 1, event: "action_started", outcome: "started", sequence: 3, revision: "0", actionRef: "approve" },
                    { operation: 1, event: "action_verified", outcome: "succeeded", sequence: 4, revision: "1", actionRef: "approve" },
                  ],
                };
              },
            }),
            execution: Object.freeze({
              scenarioId: plan.scenarioId,
              driverInput: { scenarioId: plan.scenarioId },
              readAuthoritativeState: () => ({ decision: "pending", mutations: 0 }),
              dispose() {},
            }),
          });
        },
      }),
    });
    expect(result).toMatchObject({
      status: "failed",
      failureClass: "final_state_mismatch",
      differences: [{ path: "final_state" }],
    });
  });

  it.each(["ORIGIN-01", "PRINCIPAL-01"] as const)(
    "rejects broken %s authority reuse that collapses the second context",
    async (caseId) => {
      const { corpus, matrix, scenarios } = await artifacts();
      const scenario = scenarios.find((item) => item.scenarioId === caseId)!;
      const target = CONFORMANCE_TARGETS[0];
      const result = await runConformanceCase({
        scenario,
        target,
        matrix,
        sentinelCorpus: corpus,
        scan: new ConformanceScanCollector(corpus),
        fixtureHost: Object.freeze({
          create(plan: Readonly<ConformanceExecutionPlan>) {
            const requests = structuredClone(plan.requests) as Array<Record<string, unknown>>;
            const firstControls = structuredClone(requests[0]!.controls);
            requests[1] = { ...requests[1], controls: firstControls };
            return createDomConformanceBinding(Object.freeze({
              ...plan,
              requests: Object.freeze(requests),
            }), target);
          },
        }),
      });
      expect(result).toMatchObject({
        caseId,
        status: "failed",
        failureClass: "outcome_mismatch",
      });
    },
  );
});
