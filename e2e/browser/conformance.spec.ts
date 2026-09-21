import { readdir, readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import { ConformanceScanCollector } from "../../test/conformance/scanning.js";
import { captureExecutionPlan, materializeExecutionPlan } from "../../test/conformance/fixture-host.js";
import { runConformanceTarget } from "../../test/conformance/harness.js";
import { writeConformanceTierFragment } from "../../test/conformance/evidence.js";
import { captureAndValidateSentinelCorpus } from "../../test/conformance/scanning.js";
import {
  captureAndValidateCapabilityMatrix,
  captureAndValidateConformanceScenario,
  captureAndValidateSuiteManifest,
} from "../../test/conformance/validation.js";
import {
  CONFORMANCE_TARGETS,
  CONFORMANCE_CASE_IDS,
  type ConformanceExecutionPlan,
  type ConformanceFixtureHost,
  type ConformanceTarget,
} from "../../test/conformance/types.js";
import { createPlaywrightConformanceBinding } from "../../test/conformance/drivers/playwright.js";

const load = async (url: URL) => JSON.parse(await readFile(url, "utf8")) as unknown;

async function loadCorpus() {
  const root = new URL("../../fixtures/conformance/", import.meta.url);
  const matrix = await captureAndValidateCapabilityMatrix(await load(new URL("capability-matrix-0.1.json", root)));
  const sentinelCorpus = await captureAndValidateSentinelCorpus(await load(new URL("sentinels-0.1.json", root)));
  const scenarioRoot = new URL("scenarios/", root);
  const files = (await readdir(scenarioRoot)).filter((file) => file.endsWith(".json")).sort();
  const byId = new Map();
  for (const file of files) {
    const scenario = await captureAndValidateConformanceScenario(await load(new URL(file, scenarioRoot)));
    byId.set(scenario.scenarioId, scenario);
  }
  const scenarios = CONFORMANCE_CASE_IDS.map((caseId) => byId.get(caseId)!);
  const suite = await captureAndValidateSuiteManifest(await load(new URL("suite-0.1.json", root)), matrix, scenarios);
  return { matrix, sentinelCorpus, scenarios, suite };
}

function fixtureHost(page: Page): ConformanceFixtureHost {
  return Object.freeze({
    create: (plan: Readonly<ConformanceExecutionPlan>, target: ConformanceTarget) =>
      createPlaywrightConformanceBinding(plan, target, page),
  });
}

function canonicalCases(run: Awaited<ReturnType<typeof runConformanceTarget>>) {
  const order = new Map(CONFORMANCE_CASE_IDS.map((caseId, index) => [caseId, index]));
  return Object.freeze([...run.cases].sort((left, right) => order.get(left.caseId)! - order.get(right.caseId)!));
}

test("managed Playwright target is deterministic across the canonical corpus", async ({ page, browserName }) => {
  test.setTimeout(180_000);
  await page.goto("/__health");
  const { matrix, sentinelCorpus, scenarios, suite } = await loadCorpus();
  const target = CONFORMANCE_TARGETS.find(({ targetId }) => targetId === "playwright-managed")!;
  const direction = process.env.CONFORMANCE_DIRECTION === "reverse" ? "reverse" : "forward";
  const browserVersion = page.context().browser()?.version();
  const browser = browserVersion ? `${browserName}/${browserVersion}` : browserName;
  const orders = [direction === "reverse" ? [...scenarios].reverse() : scenarios];
  const summaries = [];
  const completed = [];
  const scans: ConformanceScanCollector[] = [];
  for (const orderedScenarios of orders) {
    const scan = new ConformanceScanCollector(sentinelCorpus);
    scans.push(scan);
    const run = await runConformanceTarget({
      target,
      scenarios: orderedScenarios,
      matrix,
      sentinelCorpus,
      scan,
      fixtureHost: fixtureHost(page),
      environment: { browser },
    });
    expect(run.cases.filter((item) => item.status !== "passed")).toEqual([]);
    expect(run.summary).toEqual({ passed: 26, failed: 0, unsupported: 0 });
    summaries.push(Object.fromEntries(run.cases.map((item) => [item.caseId, item.status])));
    completed.push(run);
  }
  await writeConformanceTierFragment({
    suiteDigest: suite.suiteDigest,
    targetId: target.targetId,
    environmentKey: browserName,
    direction,
    run: Object.freeze({ ...completed[0]!, cases: canonicalCases(completed[0]!) }),
    scan: Object.freeze(scans.flatMap((collector) => collector.partialEvidence())),
  });
});

test("managed disposal reports the real post-mutation adapter boundary", async ({ page }) => {
  await page.goto("/__health");
  const { sentinelCorpus, scenarios } = await loadCorpus();
  const target = CONFORMANCE_TARGETS.find(({ targetId }) => targetId === "playwright-managed")!;
  const scenario = scenarios.find(({ scenarioId }) => scenarioId === "DISP-02")!;
  const plan = materializeExecutionPlan(
    captureExecutionPlan(scenario),
    sentinelCorpus.sentinels,
    scenario.sentinelInjections,
  );
  const binding = await createPlaywrightConformanceBinding(plan, target, page);
  try {
    const raw = await binding.driver.run(Object.freeze({
      scenarioId: scenario.scenarioId,
      driverInput: binding.execution.driverInput,
    }), new AbortController().signal) as {
      outcomes: Array<Record<string, unknown>>;
      lifecycle: Array<Record<string, unknown>>;
    };
    expect(raw.outcomes).toEqual([
      expect.objectContaining({ status: "failed", code: "stale_revision" }),
    ]);
    expect(raw.lifecycle.map(({ event, outcome, sequence }) => ({ event, outcome, sequence }))).toEqual([
      { event: "action_requested", outcome: "requested", sequence: 1 },
      { event: "policy_decided", outcome: "allow", sequence: 2 },
      { event: "action_started", outcome: "started", sequence: 3 },
      { event: "action_failed", outcome: "stale_revision", sequence: 4 },
    ]);
    await expect(binding.execution.readAuthoritativeState()).resolves.toMatchObject({
      decision: "approved",
      mutations: 1,
    });
  } finally {
    await binding.execution.dispose();
  }
});

test("managed authoritative state rejects page and console spoofing", async ({ page }) => {
  await page.goto("/__health");
  const { sentinelCorpus, scenarios } = await loadCorpus();
  const target = CONFORMANCE_TARGETS.find(({ targetId }) => targetId === "playwright-managed")!;
  const scenario = scenarios.find(({ scenarioId }) => scenarioId === "SUCCESS-01")!;
  const plan = materializeExecutionPlan(
    captureExecutionPlan(scenario),
    sentinelCorpus.sentinels,
    scenario.sentinelInjections,
  );
  const binding = await createPlaywrightConformanceBinding(plan, target, page);
  try {
    await page.evaluate(async () => {
      console.debug("dual-surface-ui-conformance:mutation:approved");
      document.querySelector("output")!.textContent = "approved";
      const name = Object.getOwnPropertyNames(globalThis)
        .find((candidate) => candidate.startsWith("__dsuiAuthenticatedMutation_"));
      if (!name) throw new TypeError("authenticated mutation binding unavailable");
      const exposed = (globalThis as typeof globalThis & Record<string, unknown>)[name];
      if (typeof exposed !== "function") throw new TypeError("authenticated mutation binding invalid");
      await Reflect.apply(exposed, undefined, ["wrong-capability", "approved"]);
    });
    await expect(binding.execution.readAuthoritativeState()).resolves.toMatchObject({
      decision: "pending",
      mutations: 0,
    });

    await binding.driver.run(Object.freeze({
      scenarioId: scenario.scenarioId,
      driverInput: binding.execution.driverInput,
    }), new AbortController().signal);
    await expect(binding.execution.readAuthoritativeState()).resolves.toMatchObject({
      decision: "approved",
      mutations: 1,
    });
  } finally {
    await binding.execution.dispose();
  }
});
