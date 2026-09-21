import { captureConformanceJson, ConformanceValidationError, isRecord } from "./canonical.js";
import {
  assertCaseBinding,
  captureExecutionPlan,
  materializeExecutionPlan,
} from "./fixture-host.js";
import {
  compareObservations,
  expectedObservation,
  normalizeDriverResult,
} from "./normalization.js";
import type { ConformanceSentinelCorpus } from "./scanning.js";
import { ConformanceScanCollector } from "./scanning.js";
import {
  findCapability,
} from "./validation.js";
import type {
  ConformanceCapabilityMatrix,
  ConformanceCaseResult,
  ConformanceFixtureHost,
  ConformanceRunResult,
  ConformanceScenario,
  ConformanceTarget,
} from "./types.js";

function assertDriverIdentity(driver: object, target: ConformanceTarget): void {
  if (!Object.isFrozen(driver)) throw new ConformanceValidationError("mutable_driver");
  for (const key of ["targetId", "family", "tier"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(driver, key);
    if (!descriptor || !("value" in descriptor) || descriptor.writable || descriptor.value !== target[key]) {
      throw new ConformanceValidationError("invalid_driver_identity");
    }
  }
}

const failureClass = (path: string) => path === "discovery" ? "discovery_mismatch" as const
  : path === "outcome" ? "outcome_mismatch" as const
    : path === "lifecycle" ? "lifecycle_mismatch" as const
      : path === "final_state" ? "final_state_mismatch" as const
        : "secret_scan_failed" as const;

export interface RunConformanceCaseOptions {
  readonly scenario: ConformanceScenario;
  readonly target: ConformanceTarget;
  readonly matrix: ConformanceCapabilityMatrix;
  readonly fixtureHost: ConformanceFixtureHost;
  readonly sentinelCorpus: ConformanceSentinelCorpus;
  readonly scan: ConformanceScanCollector;
  readonly signal?: AbortSignal;
}

export async function runConformanceCase(options: RunConformanceCaseOptions): Promise<ConformanceCaseResult> {
  const { scenario, target, matrix, fixtureHost, sentinelCorpus, scan } = options;
  const capability = findCapability(matrix, scenario.scenarioId, target.targetId);
  if (capability.status === "unsupported") {
    return Object.freeze({
      caseId: scenario.scenarioId,
      scenarioDigest: scenario.scenarioDigest,
      status: "unsupported",
      reason: capability.reason!,
    });
  }
  const plan = captureExecutionPlan(scenario);
  const materialized = materializeExecutionPlan(plan, sentinelCorpus.sentinels, scenario.sentinelInjections);
  const binding = await fixtureHost.create(materialized, target);
  assertCaseBinding(binding, scenario.scenarioId, target.targetId);
  assertDriverIdentity(binding.driver, target);
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener("abort", abort, { once: true });
  try {
    const detachedDriverInput = captureConformanceJson({
      scenarioId: scenario.scenarioId,
      driverInput: binding.execution.driverInput,
    });
    scan.scanTrusted("fixture_host_input", binding.execution.driverInput, scenario.sentinelInjections);
    const raw = await Reflect.apply(
      binding.driver.run,
      undefined,
      [detachedDriverInput as never, controller.signal],
    );
    scan.scanEgress("driver_result", raw);
    const state = captureConformanceJson(await binding.execution.readAuthoritativeState());
    scan.scanTrusted("authoritative_state", state, scenario.sentinelInjections);
    const actual = await normalizeDriverResult(raw, scenario, state);
    scan.scanEgress("normalized_observation", actual);
    if (!isRecord(scenario.expected)) throw new ConformanceValidationError("invalid_expected");
    const materializedExpected = materializeExecutionPlan(
      Object.freeze({
        scenarioId: scenario.scenarioId,
        actions: Object.freeze([]),
        initialState: scenario.expected.finalState as never,
        requests: Object.freeze([]),
      }),
      sentinelCorpus.sentinels,
      scenario.sentinelInjections.filter((item) => item.channel === "authoritative_state"),
    ).initialState;
    const expected = await expectedObservation(scenario, target.targetId, materializedExpected);
    const differences = compareObservations(expected, actual);
    scan.scanEgress("mismatches", differences);
    if (differences.length === 0) {
      return Object.freeze({ caseId: scenario.scenarioId, scenarioDigest: scenario.scenarioDigest, status: "passed" });
    }
    return Object.freeze({
      caseId: scenario.scenarioId,
      scenarioDigest: scenario.scenarioDigest,
      status: "failed",
      failureClass: failureClass(differences[0]!.path),
      differences,
    });
  } catch (error) {
    if (
      error instanceof ConformanceValidationError &&
      /(?:secret|sentinel|scan)/.test(error.reason)
    ) throw error;
    return Object.freeze({
      caseId: scenario.scenarioId,
      scenarioDigest: scenario.scenarioDigest,
      status: "failed",
      failureClass: "driver_result_invalid",
      differences: Object.freeze([]),
    });
  } finally {
    options.signal?.removeEventListener("abort", abort);
    try { await binding.execution.dispose(); }
    catch { throw new ConformanceValidationError("fixture_cleanup_failed"); }
  }
}

export async function runConformanceTarget(options: {
  readonly target: ConformanceTarget;
  readonly scenarios: readonly ConformanceScenario[];
  readonly matrix: ConformanceCapabilityMatrix;
  readonly fixtureHost: ConformanceFixtureHost;
  readonly sentinelCorpus: ConformanceSentinelCorpus;
  readonly scan: ConformanceScanCollector;
  readonly environment?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
}): Promise<ConformanceRunResult> {
  const cases: ConformanceCaseResult[] = [];
  for (const scenario of options.scenarios) {
    options.scan.scanEgress("scenario_artifacts", scenario);
    cases.push(await runConformanceCase({
      scenario, target: options.target, matrix: options.matrix,
      fixtureHost: options.fixtureHost, sentinelCorpus: options.sentinelCorpus,
      scan: options.scan, ...(options.signal ? { signal: options.signal } : {}),
    }));
  }
  const count = (status: ConformanceCaseResult["status"]) => cases.filter((item) => item.status === status).length;
  return Object.freeze({
    ...options.target,
    runStatus: "completed",
    environment: Object.freeze({ ...(options.environment ?? {}) }),
    cases: Object.freeze(cases),
    summary: Object.freeze({ passed: count("passed"), failed: count("failed"), unsupported: count("unsupported") }),
  });
}
