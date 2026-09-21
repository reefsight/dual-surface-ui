import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { chromium, expect, test, type BrowserContext, type Page, type TestInfo } from "@playwright/test";

import {
  CONFORMANCE_CASE_IDS,
  CONFORMANCE_TARGETS,
  ConformanceScanCollector,
  captureAndValidateCapabilityMatrix,
  captureAndValidateConformanceScenario,
  captureAndValidateSentinelCorpus,
  captureAndValidateSuiteManifest,
  runConformanceTarget,
  writeConformanceTierFragment,
  type ConformanceEnvironmentFailure,
  type ConformanceDriverInput,
  type ConformanceExecutionPlan,
  type ConformanceFixtureHost,
  type ConformanceRunResult,
  type ConformanceScenario,
  type ConformanceTarget,
} from "../../test/conformance/index.js";
import { loadInstalledPackageApis } from "../../test/conformance/installed-package.js";

const port = Number(process.env.BROWSER_FIXTURE_PORT ?? "43991");
const origin = `http://127.0.0.1:${port}`;
const nativeTarget = CONFORMANCE_TARGETS.find((target) => target.targetId === "webmcp-native")!;

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

function environmentFailure(
  reason: ConformanceEnvironmentFailure["reason"],
  browser?: string,
): ConformanceEnvironmentFailure {
  const environment: Readonly<Record<string, string>> = browser
    ? Object.freeze({ browser })
    : Object.freeze({});
  return Object.freeze({
    targetId: "webmcp-native",
    family: "webmcp",
    tier: "native-webmcp",
    runStatus: "environment_failed",
    environment,
    reason,
    cases: Object.freeze([]) as readonly [],
    summary: Object.freeze({ passed: 0, failed: 0, unsupported: 0 }),
  });
}

async function attachEvidence(testInfo: TestInfo, value: unknown): Promise<void> {
  await testInfo.attach("native-webmcp-conformance", {
    body: Buffer.from(JSON.stringify(value)),
    contentType: "application/json",
  });
}

interface NodeOracleChannel {
  prepare(scenarioId: ConformanceExecutionPlan["scenarioId"], initialState: unknown): string;
  read(scenarioId: ConformanceExecutionPlan["scenarioId"]): unknown;
}

async function createNodeOracleChannel(page: Page): Promise<Readonly<NodeOracleChannel>> {
  let expectedToken: string | undefined;
  let expectedScenario: ConformanceExecutionPlan["scenarioId"] | undefined;
  let authoritativeState: unknown;
  let captured = false;
  await page.exposeBinding(
    "__dsuiNativeOracleCommit",
    (_source, token: unknown, scenarioId: unknown, state: unknown) => {
      if (token !== expectedToken || scenarioId !== expectedScenario) {
        throw new TypeError("invalid_oracle_capability");
      }
      authoritativeState = structuredClone(state);
      captured = true;
    },
  );
  return Object.freeze({
    prepare(scenarioId: ConformanceExecutionPlan["scenarioId"], initialState: unknown) {
      expectedToken = randomUUID();
      expectedScenario = scenarioId;
      authoritativeState = structuredClone(initialState);
      captured = true;
      return expectedToken;
    },
    read(scenarioId: ConformanceExecutionPlan["scenarioId"]) {
      if (!captured || scenarioId !== expectedScenario) {
        throw new TypeError("authoritative_state_unavailable");
      }
      return structuredClone(authoritativeState);
    },
  });
}

function remoteFixtureHost(page: Page, oracle: Readonly<NodeOracleChannel>): ConformanceFixtureHost {
  const invokeTransport = Object.freeze(async (
    input: Readonly<ConformanceDriverInput>,
    signal: AbortSignal,
  ): Promise<unknown> => {
    if (signal.aborted) throw new TypeError("driver_aborted");
    const isolation = await page.evaluate(async () => {
      let oracleAccess = "unexpected_access";
      try {
        await globalThis.__dsuiNativeOracleCommit("forged-token", "DISC-01", { forged: true });
      } catch {
        oracleAccess = "capability_rejected";
      }
      return {
        hasReadOracle: "nativeConformanceHarness" in globalThis,
        hasSetupCapability: "nativeConformanceSetup" in globalThis,
        oracleAccess,
      };
    });
    if (isolation.hasReadOracle || isolation.hasSetupCapability || isolation.oracleAccess !== "capability_rejected") {
      throw new TypeError("driver_oracle_isolation_failed");
    }
    const serialized = JSON.stringify(input);
    return page.evaluate(
      (capturedInput) => globalThis.nativeConformanceDriver.run(JSON.parse(capturedInput)),
      serialized,
    );
  });
  const prepareFixture = Object.freeze(async (
    plan: Readonly<ConformanceExecutionPlan>,
    packageBinding: Awaited<ReturnType<typeof loadInstalledPackageApis>>["binding"],
  ): Promise<void> => {
    const serializedPlan = JSON.stringify(plan);
    const oracleToken = oracle.prepare(plan.scenarioId, plan.initialState);
    await page.evaluate(
      ([capturedPlan, binding, token]) => {
        const setup = globalThis.nativeConformanceSetup;
        if (!setup) throw new TypeError("native_setup_unavailable");
        return setup.prepare(JSON.parse(capturedPlan), binding, token);
      },
      [serializedPlan, packageBinding, oracleToken] as const,
    );
  });

  return Object.freeze({
    async create(plan: Readonly<ConformanceExecutionPlan>, target: ConformanceTarget) {
      if (target.targetId !== "webmcp-native" || target.family !== "webmcp" || target.tier !== "native-webmcp") {
        throw new TypeError("invalid_native_target");
      }
      const packageBinding = (await loadInstalledPackageApis()).binding;
      await prepareFixture(plan, packageBinding);
      const driver = Object.freeze({
        targetId: "webmcp-native" as const,
        family: "webmcp" as const,
        tier: "native-webmcp" as const,
        async run(input: Readonly<ConformanceDriverInput>, signal: AbortSignal) {
          return invokeTransport(input, signal);
        },
      });
      return Object.freeze({
        driver,
        execution: Object.freeze({
          scenarioId: plan.scenarioId,
          driverInput: Object.freeze({
            scenarioId: plan.scenarioId,
            actions: plan.actions,
            packageEvidence: packageBinding,
            requests: plan.requests,
          }),
          readAuthoritativeState: () => oracle.read(plan.scenarioId),
          dispose() {},
        }),
      });
    },
  });
}

function stableCases(result: ConformanceRunResult) {
  const order = new Map(CONFORMANCE_CASE_IDS.map((caseId, index) => [caseId, index]));
  return [...result.cases].sort((left, right) => order.get(left.caseId)! - order.get(right.caseId)!);
}

test("native WebMCP runs the canonical 26-case conformance corpus", async ({}, testInfo) => {
  test.setTimeout(360_000);
  const userDataDir = process.env.WEBMCP_NATIVE_PROFILE;
  if (!userDataDir) {
    const evidence = environmentFailure("native_api_unavailable");
    await attachEvidence(testInfo, evidence);
    throw new Error(evidence.reason);
  }

  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chrome",
      headless: false,
      args: [
        "--enable-experimental-web-platform-features",
        "--enable-features=WebMCPTesting,DevToolsWebMCPSupport",
      ],
    });
  } catch {
    const evidence = environmentFailure("browser_launch_failed", "chrome");
    await attachEvidence(testInfo, evidence);
    throw new Error(evidence.reason);
  }
  try {
    const page = context.pages()[0] ?? await context.newPage();
    const oracle = await createNodeOracleChannel(page);
    await page.goto(`${origin}/e2e/native/conformance.html`);
    await expect(page.locator("html")).toHaveAttribute(
      "data-native-conformance",
      /^(?:ready|unavailable)$/,
    );
    const browserVersion = context.browser()?.version();
    const browser = browserVersion ? `chrome/${browserVersion}` : "chrome";
    const browserCapabilities = await page.evaluate(() => ({
      driverFrozen: Object.isFrozen(globalThis.nativeConformanceDriver),
      driverKeys: Object.keys(globalThis.nativeConformanceDriver).sort(),
      setupFrozen: Object.isFrozen(globalThis.nativeConformanceSetup),
      setupKeys: Object.keys(globalThis.nativeConformanceSetup ?? {}).sort(),
      hasReadOracle: "nativeConformanceHarness" in globalThis,
    }));
    expect(browserCapabilities).toEqual({
      driverFrozen: true,
      driverKeys: ["run"],
      setupFrozen: true,
      setupKeys: ["prepare"],
      hasReadOracle: false,
    });
    const adversarialProbe = await page.evaluate(async () => {
      try {
        await globalThis.__dsuiNativeOracleCommit("forged-token", "DISC-01", { forged: true });
        return "unexpected_access";
      } catch {
        return "capability_rejected";
      }
    });
    expect(adversarialProbe).toBe("capability_rejected");
    if (await page.getAttribute("html", "data-native-conformance") !== "ready") {
      const evidence = environmentFailure("native_api_unavailable", browser);
      await attachEvidence(testInfo, evidence);
      throw new Error(evidence.reason);
    }

    const { corpus, matrix, scenarios, suite } = await artifacts();
    const direction = process.env.CONFORMANCE_DIRECTION === "reverse" ? "reverse" : "forward";
    const scans: ConformanceScanCollector[] = [];
    const execute = async (orderedScenarios: readonly ConformanceScenario[]) => {
      const scan = new ConformanceScanCollector(corpus);
      scans.push(scan);
      return runConformanceTarget({
      target: nativeTarget,
      scenarios: orderedScenarios,
      matrix,
      fixtureHost: remoteFixtureHost(page, oracle),
      sentinelCorpus: corpus,
      scan,
      environment: Object.freeze({ browser }),
      });
    };
    const run = await execute(direction === "reverse" ? [...scenarios].reverse() : scenarios);
    const evidence = Object.freeze({
      targetId: nativeTarget.targetId,
      family: nativeTarget.family,
      tier: nativeTarget.tier,
      direction,
      run,
    });
    await attachEvidence(testInfo, evidence);
    await writeConformanceTierFragment({
      suiteDigest: suite.suiteDigest,
      targetId: nativeTarget.targetId,
      environmentKey: "native-chrome",
      direction,
      run: Object.freeze({ ...run, cases: Object.freeze(stableCases(run)) }),
      scan: Object.freeze(scans.flatMap((collector) => collector.partialEvidence())),
    });

    expect(stableCases(run).map((item) => item.caseId)).toEqual(CONFORMANCE_CASE_IDS);
    expect(run.cases.filter((item) => item.status === "failed")).toEqual([]);
    expect(run.summary).toEqual({ passed: 26, failed: 0, unsupported: 0 });
  } finally {
    await context.close();
  }
});
