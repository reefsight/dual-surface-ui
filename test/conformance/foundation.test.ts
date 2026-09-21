import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { captureConformanceJson, ConformanceValidationError, digestConformanceValue } from "./canonical.js";
import { captureExecutionPlan, materializeExecutionPlan } from "./fixture-host.js";
import { runConformanceCase } from "./harness.js";
import { expectedObservation } from "./normalization.js";
import { captureAndValidateSentinelCorpus } from "./scanning.js";
import { ConformanceScanCollector } from "./scanning.js";
import { buildConformanceReport } from "./report.js";
import { CONFORMANCE_CASE_IDS, CONFORMANCE_SCAN_CHANNELS, CONFORMANCE_TARGETS, type ConformanceSuiteManifest } from "./types.js";
import {
  captureAndValidateCapabilityMatrix,
  captureAndValidateConformanceReport,
  captureAndValidateConformanceScenario,
  captureAndValidateSuiteManifest,
  CONFORMANCE_DOMAINS,
} from "./validation.js";

const load = async (url: URL) => JSON.parse(await readFile(url, "utf8")) as unknown;

describe("private conformance foundation", () => {
  it("rejects accessors without invoking them", () => {
    let invoked = false;
    const hostile = Object.defineProperty({}, "secret", {
      enumerable: true,
      get() { invoked = true; return "no"; },
    });
    expect(() => captureConformanceJson(hostile)).toThrow(ConformanceValidationError);
    expect(invoked).toBe(false);
  });

  it("validates the exact matrix, sentinel corpus, and 26 scenario artifacts", async () => {
    const root = new URL("../../fixtures/conformance/", import.meta.url);
    const matrix = await captureAndValidateCapabilityMatrix(await load(new URL("capability-matrix-0.1.json", root)));
    const corpus = await captureAndValidateSentinelCorpus(await load(new URL("sentinels-0.1.json", root)));
    const directory = new URL("scenarios/", root);
    const files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();
    expect(files).toHaveLength(26);
    const byId = new Map();
    for (const file of files) {
      const scenario = await captureAndValidateConformanceScenario(await load(new URL(file, directory)));
      byId.set(scenario.scenarioId, scenario);
    }
    const scenarios = CONFORMANCE_CASE_IDS.map((caseId) => byId.get(caseId)!);
    expect(matrix.cases).toHaveLength(26);
    for (const scenario of scenarios) {
      await expect(expectedObservation(scenario, "dom-jsdom")).resolves.toBeDefined();
      const plan = captureExecutionPlan(scenario);
      const materialized = materializeExecutionPlan(plan, corpus.sentinels, scenario.sentinelInjections);
      expect(JSON.stringify(plan)).not.toContain("DSUI_TEST_SECRET_");
      if (scenario.sentinelInjections.length > 0) expect(JSON.stringify(materialized)).toContain("DSUI_TEST_SECRET_");
    }
    const suite = await captureAndValidateSuiteManifest(await load(new URL("suite-0.1.json", root)), matrix, scenarios);
    await expect(captureAndValidateSuiteManifest({ ...suite, suiteDigest: "sha256:" + "0".repeat(64) }, matrix, scenarios)).rejects.toMatchObject({ reason: "digest_mismatch" });
  });

  it("rejects DISC-02 when schema projection evidence is absent", async () => {
    const root = new URL("../../fixtures/conformance/", import.meta.url);
    const scenario = await captureAndValidateConformanceScenario(await load(new URL("scenarios/DISC-02.json", root)));
    const expected = scenario.expected as Record<string, unknown>;
    const discovery = (expected.discovery as readonly Record<string, unknown>[]).map(({ inputSchemaDigest: _omitted, ...item }) => item);
    await expect(expectedObservation({
      ...scenario,
      expected: { ...expected, discovery } as never,
    }, "dom-jsdom")).rejects.toMatchObject({ reason: "missing_schema_digest" });
  });

  it("does not swallow fixture cleanup failure", async () => {
    const root = new URL("../../fixtures/conformance/", import.meta.url);
    const matrix = await captureAndValidateCapabilityMatrix(await load(new URL("capability-matrix-0.1.json", root)));
    const corpus = await captureAndValidateSentinelCorpus(await load(new URL("sentinels-0.1.json", root)));
    const scenario = await captureAndValidateConformanceScenario(await load(new URL("scenarios/DISC-01.json", root)));
    const scan = new ConformanceScanCollector(corpus);
    await expect(runConformanceCase({
      scenario,
      target: CONFORMANCE_TARGETS[0],
      matrix,
      sentinelCorpus: corpus,
      scan,
      fixtureHost: {
        create: () => Object.freeze({
          driver: Object.freeze({
            targetId: "dom-jsdom" as const,
            family: "dom" as const,
            tier: "in-process" as const,
            run: async () => ({ discovery: [], outcomes: [], lifecycle: [] }),
          }),
          execution: Object.freeze({
            scenarioId: "DISC-01" as const,
            driverInput: {},
            readAuthoritativeState: () => ({ decision: "pending", mutations: 0 }),
            dispose: () => { throw new Error("must not be swallowed"); },
          }),
        }),
      },
    })).rejects.toMatchObject({ reason: "fixture_cleanup_failed" });
  });

  it("exposes only detached frozen input and no oracle or cleanup alias to a driver", async () => {
    const root = new URL("../../fixtures/conformance/", import.meta.url);
    const matrix = await captureAndValidateCapabilityMatrix(await load(new URL("capability-matrix-0.1.json", root)));
    const corpus = await captureAndValidateSentinelCorpus(await load(new URL("sentinels-0.1.json", root)));
    const scenario = await captureAndValidateConformanceScenario(await load(new URL("scenarios/DISC-01.json", root)));
    let authoritativeReads = 0;
    let cleanupCalls = 0;
    let inspected = false;
    const scan = new ConformanceScanCollector(corpus);
    const result = await runConformanceCase({
      scenario,
      target: CONFORMANCE_TARGETS[0],
      matrix,
      sentinelCorpus: corpus,
      scan,
      fixtureHost: {
        create: (plan) => {
          const driver = Object.freeze({
            targetId: "dom-jsdom" as const,
            family: "dom" as const,
            tier: "in-process" as const,
            async run(this: unknown, input: Readonly<import("./types.js").ConformanceDriverInput>) {
              inspected = true;
              expect(this).toBeUndefined();
              expect(Object.isFrozen(input)).toBe(true);
              expect(Object.isFrozen(input.driverInput)).toBe(true);
              expect(Reflect.ownKeys(input).sort()).toEqual(["driverInput", "scenarioId"]);
              expect(JSON.stringify(input)).not.toContain("readAuthoritativeState");
              expect(JSON.stringify(input)).not.toContain("dispose");
              expect(() => { (input as { scenarioId: string }).scenarioId = "SUCCESS-01"; }).toThrow();
              return { discovery: [], outcomes: [], lifecycle: [] };
            },
          });
          const execution = Object.freeze({
            scenarioId: plan.scenarioId,
            driverInput: Object.freeze({ scenarioId: plan.scenarioId, actions: plan.actions, requests: plan.requests }),
            readAuthoritativeState: () => { authoritativeReads += 1; return { decision: "pending", mutations: 0 }; },
            dispose: () => { cleanupCalls += 1; },
          });
          expect(Reflect.ownKeys(driver)).not.toContain("execution");
          expect(Reflect.ownKeys(driver)).not.toContain("readAuthoritativeState");
          expect(Reflect.ownKeys(driver)).not.toContain("dispose");
          expect(driver).not.toBe(execution);
          return Object.freeze({ driver, execution });
        },
      },
    });
    expect(inspected).toBe(true);
    expect(authoritativeReads).toBe(1);
    expect(cleanupCalls).toBe(1);
    expect(result.status).toBe("failed");
  });

  it("requires all scan channels and scans report projection before inserting evidence and digest", async () => {
    const root = new URL("../../fixtures/conformance/", import.meta.url);
    const corpus = await captureAndValidateSentinelCorpus(await load(new URL("sentinels-0.1.json", root)));
    const scan = new ConformanceScanCollector(corpus);
    for (const channel of CONFORMANCE_SCAN_CHANNELS) {
      if (channel === "report_payload") continue;
      if (channel === "fixture_host_input" || channel === "authoritative_state") scan.scanTrusted(channel, { safe: channel }, []);
      else scan.scanEgress(channel, { safe: channel });
    }
    expect(() => scan.evidence()).toThrowError("Conformance artifact validation failed");
    const digest = "sha256:" + "0".repeat(64) as `sha256:${string}`;
    const scenarios = CONFORMANCE_CASE_IDS.map((caseId) => ({
      caseId, scenarioId: caseId, scenarioDigest: digest, injectionDigest: digest,
    }));
    const driverDigests = Object.fromEntries(CONFORMANCE_TARGETS.map(({ targetId }) => [targetId, digest]));
    const suitePayload = {
      matrixDigest: digest, scenarios: scenarios.map(({ caseId, scenarioDigest, injectionDigest }) => ({ caseId, scenarioDigest, injectionDigest })),
      fixtureHostDigest: digest, driverDigests, sentinelSetDigest: corpus.sentinelSetDigest,
      scanChannels: CONFORMANCE_SCAN_CHANNELS,
    };
    const suite = {
      schemaVersion: "0.1", kind: "agent-conformance-suite", suiteId: "suite",
      matrixDigest: digest, scenarios, fixtureHostDigest: digest,
      driverDigests,
      sentinelSetDigest: corpus.sentinelSetDigest,
      scanChannels: CONFORMANCE_SCAN_CHANNELS,
      suiteDigest: await digestConformanceValue(CONFORMANCE_DOMAINS.suite, suitePayload),
    } as unknown as ConformanceSuiteManifest;
    const runs = CONFORMANCE_TARGETS.map((target) => ({
      ...target, runStatus: "environment_failed" as const, environment: {}, cases: [] as const,
      reason: "protocol_environment_failed" as const,
      summary: { passed: 0 as const, failed: 0 as const, unsupported: 0 as const },
    }));
    const report = await buildConformanceReport({
      suite,
      source: { commit: "a".repeat(40), treeDigest: digest, dirty: false },
      package: { name: "dual-surface-ui", version: "0.1.0", tarballDigest: digest, installedManifestDigest: digest },
      runs,
    }, scan);
    expect(report).toHaveProperty("scan");
    expect(report).toHaveProperty("reportDigest");
    expect((report as Record<string, unknown>).summary).not.toHaveProperty("gate");
    await expect(captureAndValidateConformanceReport(report, suite)).resolves.toEqual(report);
    const evidence = scan.evidence();
    expect(evidence.channels).toHaveLength(13);
    expect(evidence.channels.find((item) => item.channel === "report_payload")?.bytesScanned).toBeGreaterThan(0);
  });

  it("rejects report status, reason, digest, summary, and suite binding drift", async () => {
    const root = new URL("../../fixtures/conformance/", import.meta.url);
    const corpus = await captureAndValidateSentinelCorpus(await load(new URL("sentinels-0.1.json", root)));
    const digest = "sha256:" + "0".repeat(64) as `sha256:${string}`;
    const bindings = CONFORMANCE_CASE_IDS.map((caseId) => ({ caseId, scenarioId: caseId, scenarioDigest: digest, injectionDigest: digest }));
    const driverDigests = Object.fromEntries(CONFORMANCE_TARGETS.map(({ targetId }) => [targetId, digest]));
    const suitePayload = { matrixDigest: digest, scenarios: bindings.map(({ caseId, scenarioDigest, injectionDigest }) => ({ caseId, scenarioDigest, injectionDigest })), fixtureHostDigest: digest, driverDigests, sentinelSetDigest: corpus.sentinelSetDigest, scanChannels: CONFORMANCE_SCAN_CHANNELS };
    const suite = { schemaVersion: "0.1", kind: "agent-conformance-suite", suiteId: "suite", matrixDigest: digest, scenarios: bindings, fixtureHostDigest: digest, driverDigests, sentinelSetDigest: corpus.sentinelSetDigest, scanChannels: CONFORMANCE_SCAN_CHANNELS, suiteDigest: await digestConformanceValue(CONFORMANCE_DOMAINS.suite, suitePayload) } as unknown as ConformanceSuiteManifest;
    const scan = new ConformanceScanCollector(corpus);
    for (const channel of CONFORMANCE_SCAN_CHANNELS) {
      if (channel === "report_payload") continue;
      if (channel === "fixture_host_input" || channel === "authoritative_state") scan.scanTrusted(channel, { safe: channel }, []);
      else scan.scanEgress(channel, { safe: channel });
    }
    const runs = CONFORMANCE_TARGETS.map((target) => ({ ...target, runStatus: "environment_failed" as const, environment: {}, cases: [] as const, reason: "protocol_environment_failed" as const, summary: { passed: 0 as const, failed: 0 as const, unsupported: 0 as const } }));
    const report = await buildConformanceReport({ suite, source: { commit: "a".repeat(40), treeDigest: digest, dirty: false }, package: { name: "dual-surface-ui", version: "0.1.0", tarballDigest: digest, installedManifestDigest: digest }, runs }, scan);
    const invalidStatus = structuredClone(report) as Record<string, any>;
    invalidStatus.runs[0].runStatus = "skipped";
    await expect(captureAndValidateConformanceReport(invalidStatus, suite)).rejects.toMatchObject({ reason: "invalid_run_status" });
    const invalidReason = structuredClone(report) as Record<string, any>;
    invalidReason.runs[0].reason = "not_available";
    await expect(captureAndValidateConformanceReport(invalidReason, suite)).rejects.toMatchObject({ reason: "invalid_environment_failure" });
    const invalidUnsupported = structuredClone(report) as Record<string, any>;
    invalidUnsupported.runs[0] = {
      ...CONFORMANCE_TARGETS[0], runStatus: "completed", environment: {},
      cases: CONFORMANCE_CASE_IDS.map((caseId, index) => index === 19
        ? { caseId, scenarioDigest: digest, status: "unsupported", reason: "not_available" }
        : { caseId, scenarioDigest: digest, status: "passed" }),
      summary: { passed: 25, failed: 0, unsupported: 1 },
    };
    await expect(captureAndValidateConformanceReport(invalidUnsupported, suite)).rejects.toMatchObject({ reason: "invalid_report_unsupported" });
    const invalidSummary = structuredClone(report) as Record<string, any>;
    invalidSummary.summary.failed = 0;
    await expect(captureAndValidateConformanceReport(invalidSummary, suite)).rejects.toMatchObject({ reason: "invalid_report_summary" });
    const invalidDigest = structuredClone(report) as Record<string, any>;
    invalidDigest.reportDigest = digest;
    await expect(captureAndValidateConformanceReport(invalidDigest, suite)).rejects.toMatchObject({ reason: "digest_mismatch" });
    await expect(captureAndValidateConformanceReport(report, { ...suite, suiteDigest: digest })).rejects.toMatchObject({ reason: "digest_mismatch" });
  });
});
