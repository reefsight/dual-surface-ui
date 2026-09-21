import type { CanonicalJson } from "../../src/delta/canonical.js";
import {
  assertExactKeys,
  canonicalConformanceJson,
  captureConformanceJson,
  ConformanceValidationError,
  digestConformanceValue,
  isDigest,
  isRecord,
} from "./canonical.js";
import type {
  ConformanceDifference,
  ConformanceScenario,
  ConformanceTargetId,
  NormalizedConformanceObservation,
  NormalizedDiscovery,
  NormalizedLifecycleEvent,
  NormalizedOutcome,
} from "./types.js";

const VALUE_DOMAIN = "dual-surface-ui:agent-conformance-scenario:0.1\0";
const RISKS = new Set(["read", "write", "consequential", "destructive", "credential"]);
const IDEMPOTENCY = new Set(["none", "keyed", "safe-retry"]);
// Harness-owned closed vocabularies keep the oracle independent from the
// package implementation under test. Package drift must fail conformance; it
// must not silently update the validator through a workspace source import.
const AGENT_FAILURE_CODES = [
  "element_not_found", "action_not_found", "authorization_required",
  "duplicate_element_id", "surface_mismatch", "stale_revision",
  "invalid_input", "confirmation_required", "invalid_policy_decision",
  "precondition_failed", "verification_failed", "invalid_output",
  "idempotency_key_required", "invalid_idempotency_key",
  "idempotency_conflict", "idempotency_unavailable", "internal_error",
] as const;
const AGENT_AUDIT_EVENT_NAMES = [
  "surface_observed", "action_requested", "policy_decided",
  "confirmation_requested", "action_started", "action_verified", "action_failed",
] as const;
const AGENT_AUDIT_OUTCOMES = [
  "observed", "requested", "allow", "deny", "require_confirmation",
  "started", "succeeded", "replayed", ...AGENT_FAILURE_CODES,
] as const;
const EVENTS = new Set<string>(AGENT_AUDIT_EVENT_NAMES);
const OUTCOMES = new Set<string>(AGENT_AUDIT_OUTCOMES);
const FAILURE_CODES = new Set<string>(AGENT_FAILURE_CODES);

class ReferenceNormalizer {
  readonly #values = new Map<string, string>();
  #next = 1;

  get(value: unknown): string {
    if (typeof value !== "string" || value.length < 1 || value.length > 128) {
      throw new ConformanceValidationError("invalid_revision");
    }
    let result = this.#values.get(value);
    if (!result) {
      result = `revision-${this.#next++}`;
      this.#values.set(value, result);
    }
    return result;
  }
}

const actionRef = (scenario: ConformanceScenario, value: unknown): string => {
  if (typeof value !== "string") throw new ConformanceValidationError("invalid_action_ref");
  const direct = scenario.actions.find((item) => isRecord(item) && item.ref === value);
  if (direct && isRecord(direct)) return direct.ref as string;
  const byAction = scenario.actions.find((item) => isRecord(item) && item.action === value);
  if (byAction && isRecord(byAction)) return byAction.ref as string;
  throw new ConformanceValidationError("unknown_action_ref");
};

async function schemaDigest(item: Record<string, unknown>, digestKey: string, valueKey: string) {
  const digest = item[digestKey];
  if (digest !== undefined) {
    if (!isDigest(digest)) throw new ConformanceValidationError("invalid_schema_digest");
    return digest;
  }
  if (item[valueKey] === undefined) return undefined;
  return digestConformanceValue(VALUE_DOMAIN, item[valueKey]);
}

export async function normalizeDriverResult(
  value: unknown,
  scenario: ConformanceScenario,
  authoritativeState: unknown,
): Promise<NormalizedConformanceObservation> {
  const captured = captureConformanceJson(value);
  if (!isRecord(captured)) throw new ConformanceValidationError("invalid_driver_result");
  assertExactKeys(captured, ["discovery", "outcomes", "lifecycle"]);
  if (!Array.isArray(captured.discovery) || !Array.isArray(captured.outcomes) || !Array.isArray(captured.lifecycle)) {
    throw new ConformanceValidationError("invalid_driver_result");
  }
  if (captured.discovery.length > 128 || captured.outcomes.length > 64 || captured.lifecycle.length > 512) {
    throw new ConformanceValidationError("budget_exceeded");
  }
  const revisions = new ReferenceNormalizer();
  // Lifecycle is chronological; seed revision aliases from it before outcomes,
  // whose failure shape may expose only the final/current revision.
  for (const item of captured.lifecycle) {
    if (!isRecord(item)) throw new ConformanceValidationError("invalid_lifecycle");
    revisions.get(item.revision);
  }
  const discovery: NormalizedDiscovery[] = [];
  for (const item of captured.discovery) {
    if (!isRecord(item)) throw new ConformanceValidationError("invalid_discovery");
    assertExactKeys(item, ["actionRef", "risk", "requiresConfirmation", "idempotency"], [
      "inputSchema", "outputSchema", "inputSchemaDigest", "outputSchemaDigest",
    ]);
    if (!RISKS.has(item.risk as string) || typeof item.requiresConfirmation !== "boolean" || !IDEMPOTENCY.has(item.idempotency as string)) {
      throw new ConformanceValidationError("invalid_discovery");
    }
    const inputSchemaDigest = await schemaDigest(item, "inputSchemaDigest", "inputSchema");
    const outputSchemaDigest = await schemaDigest(item, "outputSchemaDigest", "outputSchema");
    discovery.push(Object.freeze({
      actionRef: actionRef(scenario, item.actionRef),
      risk: item.risk as NormalizedDiscovery["risk"],
      requiresConfirmation: item.requiresConfirmation,
      idempotency: item.idempotency as NormalizedDiscovery["idempotency"],
      ...(inputSchemaDigest ? { inputSchemaDigest } : {}),
      ...(outputSchemaDigest ? { outputSchemaDigest } : {}),
    }));
  }
  discovery.sort((left, right) => left.actionRef < right.actionRef ? -1 : left.actionRef > right.actionRef ? 1 : 0);

  const outcomes: NormalizedOutcome[] = [];
  for (const item of captured.outcomes) {
    if (!isRecord(item) || !Number.isSafeInteger(item.operation) || (item.operation as number) < 0) {
      throw new ConformanceValidationError("invalid_outcome");
    }
    if (item.status === "succeeded") {
      assertExactKeys(item, ["operation", "status", "previousRevision", "revision", "actionRef", "targetPresent"], ["output", "outputDigest"]);
      if (typeof item.targetPresent !== "boolean") throw new ConformanceValidationError("invalid_outcome");
      const outputDigest = item.outputDigest === undefined
        ? item.output === undefined ? undefined : await digestConformanceValue(VALUE_DOMAIN, item.output)
        : isDigest(item.outputDigest) ? item.outputDigest : (() => { throw new ConformanceValidationError("invalid_output_digest"); })();
      outcomes.push(Object.freeze({
        operation: item.operation as number,
        status: "succeeded",
        previousRevisionRef: revisions.get(item.previousRevision),
        revisionRef: revisions.get(item.revision),
        actionRef: actionRef(scenario, item.actionRef),
        targetPresent: item.targetPresent,
        ...(outputDigest ? { outputDigest } : {}),
      }));
    } else if (item.status === "failed") {
      assertExactKeys(item, ["operation", "status", "revision", "code"]);
      if (!FAILURE_CODES.has(item.code as string)) throw new ConformanceValidationError("invalid_failure_code");
      outcomes.push(Object.freeze({
        operation: item.operation as number,
        status: "failed",
        revisionRef: revisions.get(item.revision),
        code: item.code as string,
      }));
    } else throw new ConformanceValidationError("invalid_outcome");
  }

  const lifecycle: NormalizedLifecycleEvent[] = [];
  for (const item of captured.lifecycle) {
    if (!isRecord(item)) throw new ConformanceValidationError("invalid_lifecycle");
    assertExactKeys(item, ["operation", "event", "outcome", "sequence", "revision"], ["actionRef"]);
    if (
      !Number.isSafeInteger(item.operation) || (item.operation as number) < 0 ||
      !Number.isSafeInteger(item.sequence) || (item.sequence as number) < 1 ||
      !EVENTS.has(item.event as string) || !OUTCOMES.has(item.outcome as string)
    ) throw new ConformanceValidationError("invalid_lifecycle");
    lifecycle.push(Object.freeze({
      operation: item.operation as number,
      event: item.event as string,
      outcome: item.outcome as string,
      sequence: item.sequence as number,
      revisionRef: revisions.get(item.revision),
      ...(item.actionRef === undefined ? {} : { actionRef: actionRef(scenario, item.actionRef) }),
    }));
  }
  const finalStateDigest = await digestConformanceValue(VALUE_DOMAIN, authoritativeState);
  return Object.freeze({
    discovery: Object.freeze(discovery),
    outcomes: Object.freeze(outcomes),
    lifecycle: Object.freeze(lifecycle),
    finalStateDigest,
  });
}

export async function expectedObservation(
  scenario: ConformanceScenario,
  targetId: ConformanceTargetId,
  authoritativeExpectedState?: unknown,
): Promise<NormalizedConformanceObservation> {
  if (!isRecord(scenario.expected)) throw new ConformanceValidationError("invalid_expected");
  const overrideContainer = scenario.expected.perTargetOverrides;
  const override = isRecord(overrideContainer) && isRecord(overrideContainer[targetId])
    ? overrideContainer[targetId] as Record<string, CanonicalJson>
    : undefined;
  const discovery = captureConformanceJson(scenario.expected.discovery);
  const outcomes = captureConformanceJson(override?.outcomes ?? scenario.expected.outcomes);
  const lifecycle = captureConformanceJson(override?.lifecycle ?? scenario.expected.lifecycle);
  if (!Array.isArray(discovery) || !Array.isArray(outcomes) || !Array.isArray(lifecycle)) {
    throw new ConformanceValidationError("invalid_expected");
  }
  for (const item of discovery) {
    if (!isRecord(item)) throw new ConformanceValidationError("invalid_expected_discovery");
    assertExactKeys(item, ["actionRef", "risk", "requiresConfirmation", "idempotency"], ["inputSchemaDigest", "outputSchemaDigest"]);
    actionRef(scenario, item.actionRef);
    if (!RISKS.has(item.risk as string) || typeof item.requiresConfirmation !== "boolean" || !IDEMPOTENCY.has(item.idempotency as string)) {
      throw new ConformanceValidationError("invalid_expected_discovery");
    }
    if (item.inputSchemaDigest !== undefined && !isDigest(item.inputSchemaDigest)) throw new ConformanceValidationError("invalid_expected_discovery");
    if (item.outputSchemaDigest !== undefined && !isDigest(item.outputSchemaDigest)) throw new ConformanceValidationError("invalid_expected_discovery");
    if (scenario.scenarioId === "DISC-02" && item.inputSchemaDigest === undefined) {
      throw new ConformanceValidationError("missing_schema_digest");
    }
  }
  const revisionRef = (value: unknown) => {
    if (typeof value !== "string" || !/^revision-[1-9][0-9]*$/.test(value)) throw new ConformanceValidationError("invalid_revision_ref");
  };
  for (const item of outcomes) {
    if (!isRecord(item) || !Number.isSafeInteger(item.operation) || (item.operation as number) < 0) throw new ConformanceValidationError("invalid_expected_outcome");
    if (item.status === "succeeded") {
      assertExactKeys(item, ["operation", "status", "previousRevisionRef", "revisionRef", "actionRef", "targetPresent"], ["outputDigest"]);
      revisionRef(item.previousRevisionRef); revisionRef(item.revisionRef); actionRef(scenario, item.actionRef);
      if (typeof item.targetPresent !== "boolean" || (item.outputDigest !== undefined && !isDigest(item.outputDigest))) {
        throw new ConformanceValidationError("invalid_expected_outcome");
      }
    } else if (item.status === "failed") {
      assertExactKeys(item, ["operation", "status", "revisionRef", "code"]);
      revisionRef(item.revisionRef);
      if (!FAILURE_CODES.has(item.code as string)) throw new ConformanceValidationError("invalid_expected_outcome");
    } else throw new ConformanceValidationError("invalid_expected_outcome");
  }
  for (const item of lifecycle) {
    if (!isRecord(item)) throw new ConformanceValidationError("invalid_expected_lifecycle");
    assertExactKeys(item, ["operation", "event", "outcome", "sequence", "revisionRef"], ["actionRef"]);
    if (!Number.isSafeInteger(item.operation) || !Number.isSafeInteger(item.sequence) || !EVENTS.has(item.event as string) || !OUTCOMES.has(item.outcome as string)) {
      throw new ConformanceValidationError("invalid_expected_lifecycle");
    }
    revisionRef(item.revisionRef);
    if (item.actionRef !== undefined) actionRef(scenario, item.actionRef);
  }
  return Object.freeze({
    discovery: discovery as unknown as readonly NormalizedDiscovery[],
    outcomes: outcomes as unknown as readonly NormalizedOutcome[],
    lifecycle: lifecycle as unknown as readonly NormalizedLifecycleEvent[],
    finalStateDigest: await digestConformanceValue(
      VALUE_DOMAIN,
      authoritativeExpectedState === undefined ? scenario.expected.finalState : authoritativeExpectedState,
    ),
  });
}

export function compareObservations(
  expected: NormalizedConformanceObservation,
  actual: NormalizedConformanceObservation,
): readonly ConformanceDifference[] {
  const differences: ConformanceDifference[] = [];
  const compare = (
    path: ConformanceDifference["path"],
    left: unknown,
    right: unknown,
  ) => {
    if (canonicalConformanceJson(left) !== canonicalConformanceJson(right) && differences.length < 256) {
      differences.push(Object.freeze({ path }));
    }
  };
  compare("discovery", expected.discovery, actual.discovery);
  compare("outcome", expected.outcomes, actual.outcomes);
  compare("lifecycle", expected.lifecycle, actual.lifecycle);
  compare("final_state", expected.finalStateDigest, actual.finalStateDigest);
  return Object.freeze(differences);
}
