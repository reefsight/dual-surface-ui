import type { CanonicalJson } from "../../src/delta/canonical.js";
import { captureConformanceJson, ConformanceValidationError } from "./canonical.js";
import type {
  ConformanceCaseBinding,
  ConformanceExecutionPlan,
  ConformanceFixtureExecution,
  ConformanceScenario,
  ConformanceSentinel,
} from "./types.js";

export function captureExecutionPlan(scenario: ConformanceScenario): Readonly<ConformanceExecutionPlan> {
  const captured = captureConformanceJson({
    scenarioId: scenario.scenarioId,
    actions: scenario.actions,
    initialState: scenario.initialState,
    requests: scenario.requests,
  });
  if (captured === null || Array.isArray(captured) || typeof captured !== "object") {
    throw new ConformanceValidationError("invalid_execution_plan");
  }
  return captured as unknown as Readonly<ConformanceExecutionPlan>;
}

/** Materializes only exact single-property {$sentinelRef: id} markers. */
export function materializeExecutionPlan(
  plan: Readonly<ConformanceExecutionPlan>,
  sentinels: readonly ConformanceSentinel[],
  declarations: readonly ConformanceScenario["sentinelInjections"][number][],
): Readonly<ConformanceExecutionPlan> {
  const byId = new Map(sentinels.map((item) => [item.sentinelId, item.value]));
  const counts = new Map<string, number>();
  const replace = (
    value: CanonicalJson,
    channel: "fixture_host_input" | "authoritative_state",
  ): CanonicalJson => {
    if (Array.isArray(value)) return Object.freeze(value.map((item) => replace(item, channel)));
    if (value !== null && typeof value === "object") {
      const entries = Object.entries(value);
      if (Object.hasOwn(value, "$sentinelRef")) {
        if (entries.length !== 1 || entries[0]![0] !== "$sentinelRef") {
          throw new ConformanceValidationError("invalid_sentinel_ref");
        }
        const id = entries[0]![1];
        if (typeof id !== "string" || !byId.has(id)) throw new ConformanceValidationError("unknown_sentinel_ref");
        const declaration = declarations.find((item) => item.channel === channel && item.sentinelId === id);
        if (!declaration) throw new ConformanceValidationError("unexpected_sentinel_ref");
        counts.set(`${channel}\0${id}`, (counts.get(`${channel}\0${id}`) ?? 0) + 1);
        return byId.get(id)!;
      }
      return Object.freeze(Object.fromEntries(entries.map(([key, item]) => [key, replace(item, channel)])));
    }
    return value;
  };
  const materialized = Object.freeze({
    scenarioId: plan.scenarioId,
    actions: replace(plan.actions as unknown as CanonicalJson, "fixture_host_input"),
    initialState: replace(plan.initialState, "authoritative_state"),
    requests: replace(plan.requests as unknown as CanonicalJson, "fixture_host_input"),
  });
  for (const declaration of declarations) {
    if ((counts.get(`${declaration.channel}\0${declaration.sentinelId}`) ?? 0) !== declaration.count) {
      throw new ConformanceValidationError("sentinel_reference_count_mismatch");
    }
  }
  return materialized as unknown as Readonly<ConformanceExecutionPlan>;
}

export function assertFixtureExecution(
  execution: ConformanceFixtureExecution,
  scenarioId: string,
): void {
  if (
    !execution || execution.scenarioId !== scenarioId ||
    !Object.isFrozen(execution) ||
    typeof execution.readAuthoritativeState !== "function" ||
    typeof execution.dispose !== "function"
  ) throw new ConformanceValidationError("invalid_fixture_execution");
  const keys = Reflect.ownKeys(execution);
  if (keys.length !== 4 || !["scenarioId", "driverInput", "readAuthoritativeState", "dispose"].every((key) => keys.includes(key))) {
    throw new ConformanceValidationError("invalid_fixture_execution");
  }
  captureConformanceJson(execution.driverInput as CanonicalJson);
}

export function assertCaseBinding(
  binding: ConformanceCaseBinding,
  scenarioId: string,
  targetId: string,
): void {
  if (!binding || !Object.isFrozen(binding) || !binding.driver || !binding.execution) {
    throw new ConformanceValidationError("invalid_case_binding");
  }
  if (
    !Object.isFrozen(binding.driver) || binding.driver.targetId !== targetId ||
    typeof binding.driver.run !== "function"
  ) throw new ConformanceValidationError("invalid_driver");
  const driverKeys = Reflect.ownKeys(binding.driver);
  if (driverKeys.length !== 4 || !["targetId", "family", "tier", "run"].every((key) => driverKeys.includes(key)) ||
    binding.driver === binding.execution || binding.execution.driverInput === binding.driver) {
    throw new ConformanceValidationError("invalid_driver");
  }
  assertFixtureExecution(binding.execution, scenarioId);
}
