import type { CanonicalJson } from "../../src/delta/canonical.js";
import {
  assertExactKeys,
  canonicalConformanceJson,
  captureConformanceJson,
  ConformanceValidationError,
  digestConformanceValue,
  isDigest,
  isRecord,
  withoutTopLevelField,
} from "./canonical.js";
import {
  CONFORMANCE_CASE_IDS,
  CONFORMANCE_SCAN_CHANNELS,
  CONFORMANCE_TARGETS,
  type ConformanceCapabilityMatrix,
  type ConformanceCaseId,
  type ConformanceScenario,
  type ConformanceSuiteManifest,
  type ConformanceTargetId,
} from "./types.js";

export const CONFORMANCE_DOMAINS = Object.freeze({
  scenario: "dual-surface-ui:agent-conformance-scenario:0.1\0",
  matrix: "dual-surface-ui:agent-conformance-capability-matrix:0.1\0",
  suite: "dual-surface-ui:agent-conformance-suite:0.1\0",
  sourceTree: "dual-surface-ui:agent-conformance-source-tree:0.1\0",
  report: "dual-surface-ui:agent-conformance-report:0.1\0",
});

const idsEqual = (actual: readonly string[], expected: readonly string[]): boolean =>
  actual.length === expected.length && actual.every((value, index) => value === expected[index]);

const requireString = (value: unknown, pattern = /^[A-Za-z0-9._~-]{1,128}$/): string => {
  if (typeof value !== "string" || !pattern.test(value)) throw new ConformanceValidationError("invalid_identifier");
  return value;
};

const requireArray = (value: unknown, maximum: number): readonly unknown[] => {
  if (!Array.isArray(value) || value.length > maximum) throw new ConformanceValidationError("invalid_array");
  return value;
};

function validateInjection(value: unknown): void {
  if (!isRecord(value)) throw new ConformanceValidationError("invalid_injection");
  assertExactKeys(value, ["channel", "sentinelId", "sentinelDigest", "count"]);
  if (value.channel !== "fixture_host_input" && value.channel !== "authoritative_state") {
    throw new ConformanceValidationError("invalid_injection");
  }
  requireString(value.sentinelId);
  if (!isDigest(value.sentinelDigest) || !Number.isSafeInteger(value.count) || (value.count as number) <= 0) {
    throw new ConformanceValidationError("invalid_injection");
  }
}

export async function captureAndValidateConformanceScenario(value: unknown): Promise<ConformanceScenario> {
  const captured = captureConformanceJson(value);
  if (!isRecord(captured)) throw new ConformanceValidationError("invalid_scenario");
  assertExactKeys(captured, [
    "schemaVersion", "kind", "scenarioId", "capability", "actions",
    "initialState", "requests", "sentinelInjections", "expected", "scenarioDigest",
  ]);
  if (captured.schemaVersion !== "0.1" || captured.kind !== "agent-conformance-scenario") {
    throw new ConformanceValidationError("invalid_scenario");
  }
  if (!CONFORMANCE_CASE_IDS.includes(captured.scenarioId as ConformanceCaseId)) {
    throw new ConformanceValidationError("invalid_case_id");
  }
  requireString(captured.capability);
  const actions = requireArray(captured.actions, 128);
  if (actions.length < 1) throw new ConformanceValidationError("invalid_action");
  const actionRefs = new Set<string>();
  for (const action of actions) {
    if (!isRecord(action)) throw new ConformanceValidationError("invalid_action");
    assertExactKeys(action, ["ref", "elementId", "action", "disposition"]);
    requireString(action.ref); requireString(action.elementId); requireString(action.action);
    if (actionRefs.has(action.ref as string)) throw new ConformanceValidationError("duplicate_action_ref");
    actionRefs.add(action.ref as string);
    if (action.disposition !== "permitted" && action.disposition !== "forbidden") {
      throw new ConformanceValidationError("invalid_action");
    }
  }
  const requests = requireArray(captured.requests, 64);
  if (requests.length < 1) throw new ConformanceValidationError("invalid_request");
  const operations = new Set<number>();
  for (const request of requests) {
    if (!isRecord(request)) throw new ConformanceValidationError("invalid_request");
    assertExactKeys(request, ["operation", "elementId", "action", "controls"], ["input", "idempotencyKey"]);
    if (!Number.isSafeInteger(request.operation) || (request.operation as number) < 1 || (request.operation as number) > 64 || operations.has(request.operation as number)) {
      throw new ConformanceValidationError("invalid_request");
    }
    operations.add(request.operation as number);
    requireString(request.elementId); requireString(request.action);
    if (request.idempotencyKey !== undefined) requireString(request.idempotencyKey);
    if (!isRecord(request.controls)) throw new ConformanceValidationError("invalid_request_controls");
    assertExactKeys(request.controls, ["policy"], ["confirmation", "precondition", "effect", "cancelTiming", "disposeTiming", "originRef", "principalRef"]);
    if (!["allow", "deny", "require_confirmation"].includes(request.controls.policy as string)) throw new ConformanceValidationError("invalid_request_controls");
    for (const flag of ["confirmation", "precondition", "effect"] as const) {
      if (request.controls[flag] !== undefined && typeof request.controls[flag] !== "boolean") throw new ConformanceValidationError("invalid_request_controls");
    }
    if (request.controls.cancelTiming !== undefined && !["none", "before_start", "after_start"].includes(request.controls.cancelTiming as string)) throw new ConformanceValidationError("invalid_request_controls");
    if (request.controls.disposeTiming !== undefined && !["none", "before_start", "after_start"].includes(request.controls.disposeTiming as string)) throw new ConformanceValidationError("invalid_request_controls");
    for (const field of ["originRef", "principalRef"] as const) {
      const value = request.controls[field];
      if (value !== undefined && (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value))) {
        throw new ConformanceValidationError("invalid_request_controls");
      }
    }
  }
  const injections = requireArray(captured.sentinelInjections, 4);
  const injectionKeys = new Set<string>();
  for (const injection of injections) validateInjection(injection);
  for (const injection of injections) {
    const item = injection as Record<string, unknown>;
    const key = `${item.channel}\0${item.sentinelId}`;
    if (injectionKeys.has(key) || (item.count as number) > 16) throw new ConformanceValidationError("invalid_injection");
    injectionKeys.add(key);
  }
  if (!isRecord(captured.expected)) throw new ConformanceValidationError("invalid_expected");
  assertExactKeys(captured.expected, ["discovery", "outcomes", "lifecycle", "finalState"], ["perTargetOverrides"]);
  const override = captured.expected.perTargetOverrides;
  if (captured.scenarioId === "DISP-02") {
    if (!isRecord(override)) throw new ConformanceValidationError("missing_target_override");
    assertExactKeys(override, ["playwright-managed"]);
    const playwright = override["playwright-managed"];
    if (!isRecord(playwright)) throw new ConformanceValidationError("invalid_target_override");
    assertExactKeys(playwright, ["outcomes", "lifecycle"]);
  } else if (override !== undefined) {
    throw new ConformanceValidationError("unexpected_target_override");
  }
  if (!isDigest(captured.scenarioDigest)) throw new ConformanceValidationError("invalid_digest");
  const computed = await digestConformanceValue(
    CONFORMANCE_DOMAINS.scenario,
    withoutTopLevelField(captured, "scenarioDigest"),
  );
  if (computed !== captured.scenarioDigest) throw new ConformanceValidationError("digest_mismatch");
  return captured as unknown as ConformanceScenario;
}

const allowedUnsupported = (targetId: string, caseId: string, reason: unknown): boolean =>
  targetId === "dom-jsdom" && (
    (["CANCEL-01", "CANCEL-02"] as const).includes(caseId as never)
      ? reason === "dom_no_abort_signal"
      : (["DISP-01", "DISP-02"] as const).includes(caseId as never) && reason === "dom_no_disposal_boundary"
  );

export async function captureAndValidateCapabilityMatrix(value: unknown): Promise<ConformanceCapabilityMatrix> {
  const captured = captureConformanceJson(value);
  if (!isRecord(captured)) throw new ConformanceValidationError("invalid_matrix");
  assertExactKeys(captured, ["schemaVersion", "kind", "matrixId", "targets", "cases", "matrixDigest"]);
  if (captured.schemaVersion !== "0.1" || captured.kind !== "agent-conformance-capability-matrix") {
    throw new ConformanceValidationError("invalid_matrix");
  }
  requireString(captured.matrixId);
  const targets = requireArray(captured.targets, 5);
  if (targets.length !== 5) throw new ConformanceValidationError("invalid_target_set");
  targets.forEach((target, index) => {
    if (!isRecord(target)) throw new ConformanceValidationError("invalid_target");
    assertExactKeys(target, ["targetId", "family", "tier"]);
    const expected = CONFORMANCE_TARGETS[index]!;
    if (target.targetId !== expected.targetId || target.family !== expected.family || target.tier !== expected.tier) {
      throw new ConformanceValidationError("invalid_target_set");
    }
  });
  const cases = requireArray(captured.cases, 26);
  if (cases.length !== 26) throw new ConformanceValidationError("invalid_case_set");
  cases.forEach((item, caseIndex) => {
    if (!isRecord(item)) throw new ConformanceValidationError("invalid_case");
    assertExactKeys(item, ["caseId", "capability", "targets"]);
    const caseId = CONFORMANCE_CASE_IDS[caseIndex]!;
    if (item.caseId !== caseId) throw new ConformanceValidationError("invalid_case_set");
    requireString(item.capability);
    const entries = requireArray(item.targets, 5);
    if (entries.length !== 5) throw new ConformanceValidationError("invalid_case_targets");
    entries.forEach((entry, targetIndex) => {
      if (!isRecord(entry)) throw new ConformanceValidationError("invalid_case_target");
      const targetId = CONFORMANCE_TARGETS[targetIndex]!.targetId;
      if (entry.targetId !== targetId) throw new ConformanceValidationError("invalid_case_target");
      if (entry.status === "supported") {
        assertExactKeys(entry, ["targetId", "status"]);
      } else if (entry.status === "unsupported") {
        assertExactKeys(entry, ["targetId", "status", "reason"]);
        if (!allowedUnsupported(targetId, caseId, entry.reason)) {
          throw new ConformanceValidationError("invalid_unsupported_case");
        }
      } else throw new ConformanceValidationError("invalid_case_target");
    });
  });
  if (!isDigest(captured.matrixDigest)) throw new ConformanceValidationError("invalid_digest");
  const computed = await digestConformanceValue(CONFORMANCE_DOMAINS.matrix, withoutTopLevelField(captured, "matrixDigest"));
  if (computed !== captured.matrixDigest) throw new ConformanceValidationError("digest_mismatch");
  return captured as unknown as ConformanceCapabilityMatrix;
}

export async function digestScenarioInjections(scenario: ConformanceScenario): Promise<`sha256:${string}`> {
  return digestConformanceValue(CONFORMANCE_DOMAINS.scenario, scenario.sentinelInjections);
}

export async function captureAndValidateSuiteManifest(
  value: unknown,
  matrix: ConformanceCapabilityMatrix,
  scenarios: readonly ConformanceScenario[],
): Promise<ConformanceSuiteManifest> {
  const captured = captureConformanceJson(value);
  if (!isRecord(captured)) throw new ConformanceValidationError("invalid_suite");
  assertExactKeys(captured, [
    "schemaVersion", "kind", "suiteId", "matrixDigest", "scenarios",
    "fixtureHostDigest", "driverDigests", "sentinelSetDigest", "scanChannels", "suiteDigest",
  ]);
  if (captured.schemaVersion !== "0.1" || captured.kind !== "agent-conformance-suite") {
    throw new ConformanceValidationError("invalid_suite");
  }
  requireString(captured.suiteId);
  if (captured.matrixDigest !== matrix.matrixDigest) throw new ConformanceValidationError("matrix_digest_mismatch");
  if (!isDigest(captured.fixtureHostDigest) || !isDigest(captured.sentinelSetDigest) || !isDigest(captured.suiteDigest)) {
    throw new ConformanceValidationError("invalid_digest");
  }
  const channels = requireArray(captured.scanChannels, 13);
  if (!idsEqual(channels as string[], CONFORMANCE_SCAN_CHANNELS)) throw new ConformanceValidationError("invalid_scan_channels");
  if (!isRecord(captured.driverDigests)) throw new ConformanceValidationError("invalid_driver_digests");
  assertExactKeys(captured.driverDigests, CONFORMANCE_TARGETS.map(({ targetId }) => targetId));
  for (const digest of Object.values(captured.driverDigests)) if (!isDigest(digest)) throw new ConformanceValidationError("invalid_digest");
  const bindings = requireArray(captured.scenarios, 26);
  if (bindings.length !== 26 || scenarios.length !== 26) throw new ConformanceValidationError("invalid_scenario_set");
  for (let index = 0; index < 26; index += 1) {
    const binding = bindings[index]; const scenario = scenarios[index]; const caseId = CONFORMANCE_CASE_IDS[index]!;
    if (!isRecord(binding) || !scenario) throw new ConformanceValidationError("invalid_scenario_binding");
    assertExactKeys(binding, ["caseId", "scenarioId", "scenarioDigest", "injectionDigest"]);
    if (binding.caseId !== caseId || binding.scenarioId !== caseId || scenario.scenarioId !== caseId || binding.scenarioDigest !== scenario.scenarioDigest) {
      throw new ConformanceValidationError("invalid_scenario_binding");
    }
    if (binding.injectionDigest !== await digestScenarioInjections(scenario)) throw new ConformanceValidationError("injection_digest_mismatch");
  }
  const suitePayload = {
    matrixDigest: matrix.matrixDigest,
    scenarios: bindings.map((binding) => {
      const item = binding as Record<string, unknown>;
      return {
        caseId: item.caseId,
        scenarioDigest: item.scenarioDigest,
        injectionDigest: item.injectionDigest,
      };
    }),
    fixtureHostDigest: captured.fixtureHostDigest,
    driverDigests: captured.driverDigests,
    sentinelSetDigest: captured.sentinelSetDigest,
    scanChannels: captured.scanChannels,
  };
  const computed = await digestConformanceValue(CONFORMANCE_DOMAINS.suite, suitePayload);
  if (computed !== captured.suiteDigest) throw new ConformanceValidationError("digest_mismatch");
  return captured as unknown as ConformanceSuiteManifest;
}

export function findCapability(
  matrix: ConformanceCapabilityMatrix,
  caseId: ConformanceCaseId,
  targetId: ConformanceTargetId,
) {
  const item = matrix.cases.find((candidate) => candidate.caseId === caseId);
  const entry = item?.targets.find((candidate) => candidate.targetId === targetId);
  if (!entry) throw new ConformanceValidationError("missing_capability");
  return entry;
}

const REPORT_FAILURE_CLASSES = new Set([
  "discovery_mismatch", "outcome_mismatch", "lifecycle_mismatch",
  "final_state_mismatch", "secret_scan_failed", "driver_result_invalid",
]);
const REPORT_DIFFERENCE_PATHS = new Set([
  "discovery", "outcome", "lifecycle", "final_state", "secret_channel",
]);
const ENVIRONMENT_FAILURE_REASONS = new Set([
  "native_api_unavailable", "browser_launch_failed", "protocol_environment_failed",
]);

function validateReportSummary(value: unknown, expected: { passed: number; failed: number; unsupported: number }): void {
  if (!isRecord(value)) throw new ConformanceValidationError("invalid_report_summary");
  assertExactKeys(value, ["passed", "failed", "unsupported"]);
  for (const key of ["passed", "failed", "unsupported"] as const) {
    if (!Number.isSafeInteger(value[key]) || value[key] !== expected[key]) {
      throw new ConformanceValidationError("invalid_report_summary");
    }
  }
}

function validateReportEnvironment(value: unknown): void {
  if (!isRecord(value)) throw new ConformanceValidationError("invalid_report_environment");
  assertExactKeys(value, [], ["runtime", "browser", "protocol"]);
  for (const item of Object.values(value)) {
    if (typeof item !== "string" || item.length > 128) throw new ConformanceValidationError("invalid_report_environment");
  }
}

function validateReportDifference(value: unknown): void {
  if (!isRecord(value)) throw new ConformanceValidationError("invalid_report_difference");
  assertExactKeys(value, ["path"], ["operation", "index", "actionRef"]);
  if (!REPORT_DIFFERENCE_PATHS.has(value.path as string)) throw new ConformanceValidationError("invalid_report_difference");
  if (value.operation !== undefined && (!Number.isSafeInteger(value.operation) || (value.operation as number) < 1 || (value.operation as number) > 64)) throw new ConformanceValidationError("invalid_report_difference");
  if (value.index !== undefined && (!Number.isSafeInteger(value.index) || (value.index as number) < 0 || (value.index as number) > 511)) throw new ConformanceValidationError("invalid_report_difference");
  if (value.actionRef !== undefined) requireString(value.actionRef);
}

function validateReportCase(
  value: unknown,
  targetId: ConformanceTargetId,
  caseId: ConformanceCaseId,
  expectedDigest: string,
): "passed" | "failed" | "unsupported" {
  if (!isRecord(value) || value.caseId !== caseId || value.scenarioDigest !== expectedDigest) {
    throw new ConformanceValidationError("invalid_report_case");
  }
  if (value.status === "passed") {
    assertExactKeys(value, ["caseId", "scenarioDigest", "status"]);
    return "passed";
  }
  if (value.status === "failed") {
    assertExactKeys(value, ["caseId", "scenarioDigest", "status", "failureClass", "differences"]);
    if (!REPORT_FAILURE_CLASSES.has(value.failureClass as string) || !Array.isArray(value.differences) || value.differences.length > 256) {
      throw new ConformanceValidationError("invalid_report_case");
    }
    value.differences.forEach(validateReportDifference);
    return "failed";
  }
  if (value.status === "unsupported") {
    assertExactKeys(value, ["caseId", "scenarioDigest", "status", "reason"]);
    if (!allowedUnsupported(targetId, caseId, value.reason)) throw new ConformanceValidationError("invalid_report_unsupported");
    return "unsupported";
  }
  throw new ConformanceValidationError("invalid_report_case");
}

function validateReportScan(value: unknown, sentinelSetDigest: string, scenarios?: readonly ConformanceScenario[]): void {
  if (!isRecord(value)) throw new ConformanceValidationError("invalid_report_scan");
  assertExactKeys(value, ["sentinelSetDigest", "channels", "bytesScanned"]);
  if (value.sentinelSetDigest !== sentinelSetDigest || !Array.isArray(value.channels) || value.channels.length !== CONFORMANCE_SCAN_CHANNELS.length) {
    throw new ConformanceValidationError("invalid_report_scan");
  }
  let total = 0;
  value.channels.forEach((entry, index) => {
    if (!isRecord(entry) || entry.channel !== CONFORMANCE_SCAN_CHANNELS[index] || !Number.isSafeInteger(entry.bytesScanned) || (entry.bytesScanned as number) < 0) {
      throw new ConformanceValidationError("invalid_report_scan");
    }
    total += entry.bytesScanned as number;
    if (!Number.isSafeInteger(total)) throw new ConformanceValidationError("invalid_report_scan");
    if (entry.channel === "fixture_host_input" || entry.channel === "authoritative_state") {
      if (entry.kind === "egress_artifact") {
        assertExactKeys(entry, ["channel", "kind", "bytesScanned", "matches"]);
        if (entry.matches !== 0 || entry.bytesScanned === 0) throw new ConformanceValidationError("invalid_report_scan");
        return;
      }
      assertExactKeys(entry, ["channel", "kind", "bytesScanned", "expected", "observed"]);
      if (entry.kind !== "trusted_injection" || !Array.isArray(entry.expected) || !Array.isArray(entry.observed) || canonicalConformanceJson(entry.expected) !== canonicalConformanceJson(entry.observed)) {
        throw new ConformanceValidationError("invalid_report_scan");
      }
      for (const injection of entry.expected) {
        if (!isRecord(injection)) throw new ConformanceValidationError("invalid_report_scan");
        assertExactKeys(injection, ["sentinelId", "sentinelDigest", "count"]);
        requireString(injection.sentinelId);
        if (!isDigest(injection.sentinelDigest) || !Number.isSafeInteger(injection.count) || (injection.count as number) < 1) throw new ConformanceValidationError("invalid_report_scan");
      }
      if (entry.bytesScanned === 0) throw new ConformanceValidationError("invalid_report_scan");
    } else {
      assertExactKeys(entry, ["channel", "kind", "bytesScanned", "matches"]);
      if (entry.kind !== "egress_artifact" || entry.matches !== 0 || entry.bytesScanned === 0) {
        throw new ConformanceValidationError("invalid_report_scan");
      }
    }
  });
  if (!Number.isSafeInteger(value.bytesScanned) || value.bytesScanned !== total) throw new ConformanceValidationError("invalid_report_scan");
  if (scenarios) {
    if (scenarios.length !== CONFORMANCE_CASE_IDS.length) throw new ConformanceValidationError("invalid_scenario_set");
    for (const channel of ["fixture_host_input", "authoritative_state"] as const) {
      const entry = value.channels.find((item) => isRecord(item) && item.channel === channel);
      if (!isRecord(entry) || entry.kind !== "trusted_injection" || !Array.isArray(entry.expected)) {
        throw new ConformanceValidationError("invalid_report_scan_binding");
      }
      const expected = scenarios.flatMap((scenario) => scenario.sentinelInjections
        .filter((injection) => injection.channel === channel)
        .flatMap(({ channel: _channel, ...injection }) => CONFORMANCE_TARGETS.map(() => injection)))
        .sort((left, right) => canonicalConformanceJson(left) < canonicalConformanceJson(right) ? -1 : canonicalConformanceJson(left) > canonicalConformanceJson(right) ? 1 : 0);
      const actual = [...entry.expected].sort((left, right) => canonicalConformanceJson(left) < canonicalConformanceJson(right) ? -1 : canonicalConformanceJson(left) > canonicalConformanceJson(right) ? 1 : 0);
      if (canonicalConformanceJson(actual) !== canonicalConformanceJson(expected)) {
        throw new ConformanceValidationError("invalid_report_scan_binding");
      }
    }
  }
}

/** Strictly validates a completed report against its already-validated suite. */
export async function captureAndValidateConformanceReport(
  value: unknown,
  suite: ConformanceSuiteManifest,
  scenarios?: readonly ConformanceScenario[],
): Promise<CanonicalJson> {
  const capturedSuite = captureConformanceJson(suite);
  if (!isRecord(capturedSuite)) throw new ConformanceValidationError("invalid_suite");
  assertExactKeys(capturedSuite, [
    "schemaVersion", "kind", "suiteId", "matrixDigest", "scenarios", "fixtureHostDigest",
    "driverDigests", "sentinelSetDigest", "scanChannels", "suiteDigest",
  ]);
  if (capturedSuite.schemaVersion !== "0.1" || capturedSuite.kind !== "agent-conformance-suite" ||
    !isDigest(capturedSuite.matrixDigest) || !isDigest(capturedSuite.fixtureHostDigest) ||
    !isDigest(capturedSuite.sentinelSetDigest) || !isDigest(capturedSuite.suiteDigest) ||
    !Array.isArray(capturedSuite.scenarios) || capturedSuite.scenarios.length !== CONFORMANCE_CASE_IDS.length) {
    throw new ConformanceValidationError("invalid_suite");
  }
  capturedSuite.scenarios.forEach((binding, index) => {
    if (!isRecord(binding)) throw new ConformanceValidationError("invalid_suite");
    assertExactKeys(binding, ["caseId", "scenarioId", "scenarioDigest", "injectionDigest"]);
    const caseId = CONFORMANCE_CASE_IDS[index]!;
    if (binding.caseId !== caseId || binding.scenarioId !== caseId || !isDigest(binding.scenarioDigest) || !isDigest(binding.injectionDigest)) throw new ConformanceValidationError("invalid_suite");
  });
  if (!isRecord(capturedSuite.driverDigests)) throw new ConformanceValidationError("invalid_suite");
  assertExactKeys(capturedSuite.driverDigests, CONFORMANCE_TARGETS.map(({ targetId }) => targetId));
  if (Object.values(capturedSuite.driverDigests).some((item) => !isDigest(item)) ||
    !Array.isArray(capturedSuite.scanChannels) || !idsEqual(capturedSuite.scanChannels as string[], CONFORMANCE_SCAN_CHANNELS)) {
    throw new ConformanceValidationError("invalid_suite");
  }
  const suiteDigest = await digestConformanceValue(CONFORMANCE_DOMAINS.suite, {
    matrixDigest: capturedSuite.matrixDigest,
    scenarios: capturedSuite.scenarios.map((binding) => {
      const item = binding as Record<string, CanonicalJson>;
      return { caseId: item.caseId!, scenarioDigest: item.scenarioDigest!, injectionDigest: item.injectionDigest! };
    }),
    fixtureHostDigest: capturedSuite.fixtureHostDigest,
    driverDigests: capturedSuite.driverDigests,
    sentinelSetDigest: capturedSuite.sentinelSetDigest,
    scanChannels: capturedSuite.scanChannels,
  });
  if (suiteDigest !== capturedSuite.suiteDigest) throw new ConformanceValidationError("digest_mismatch");
  const captured = captureConformanceJson(value);
  if (!isRecord(captured)) throw new ConformanceValidationError("invalid_report");
  assertExactKeys(captured, [
    "schemaVersion", "kind", "suiteId", "suiteDigest", "matrixDigest", "sentinelSetDigest",
    "source", "package", "scan", "runs", "summary", "reportDigest",
  ]);
  if (captured.schemaVersion !== "0.1" || captured.kind !== "agent-conformance-report" ||
    captured.suiteId !== suite.suiteId || captured.suiteDigest !== suite.suiteDigest ||
    captured.matrixDigest !== suite.matrixDigest || captured.sentinelSetDigest !== suite.sentinelSetDigest) {
    throw new ConformanceValidationError("invalid_report_binding");
  }
  if (!isRecord(captured.source)) throw new ConformanceValidationError("invalid_source_evidence");
  assertExactKeys(captured.source, ["commit", "treeDigest", "dirty"]);
  if (!/^[a-f0-9]{40}$/.test(captured.source.commit as string) || !isDigest(captured.source.treeDigest) || captured.source.dirty !== false) throw new ConformanceValidationError("invalid_source_evidence");
  if (!isRecord(captured.package)) throw new ConformanceValidationError("invalid_package_evidence");
  assertExactKeys(captured.package, ["name", "version", "tarballDigest", "installedManifestDigest"]);
  if (captured.package.name !== "dual-surface-ui" || typeof captured.package.version !== "string" || !/^\d+\.\d+\.\d+$/.test(captured.package.version) || !isDigest(captured.package.tarballDigest) || !isDigest(captured.package.installedManifestDigest)) throw new ConformanceValidationError("invalid_package_evidence");
  if (!Array.isArray(captured.runs) || captured.runs.length !== CONFORMANCE_TARGETS.length) throw new ConformanceValidationError("invalid_run_set");
  const totals = { passed: 0, failed: 0, unsupported: 0 };
  captured.runs.forEach((run, targetIndex) => {
    if (!isRecord(run)) throw new ConformanceValidationError("invalid_run");
    const target = CONFORMANCE_TARGETS[targetIndex]!;
    if (run.targetId !== target.targetId || run.family !== target.family || run.tier !== target.tier) throw new ConformanceValidationError("invalid_run_set");
    validateReportEnvironment(run.environment);
    if (run.runStatus === "completed") {
      assertExactKeys(run, ["targetId", "family", "tier", "runStatus", "environment", "cases", "summary"]);
      if (!Array.isArray(run.cases) || run.cases.length !== CONFORMANCE_CASE_IDS.length) throw new ConformanceValidationError("invalid_case_set");
      const summary = { passed: 0, failed: 0, unsupported: 0 };
      run.cases.forEach((item, caseIndex) => {
        const binding = suite.scenarios[caseIndex];
        const status = validateReportCase(item, target.targetId, CONFORMANCE_CASE_IDS[caseIndex]!, binding?.scenarioDigest ?? "");
        summary[status] += 1;
      });
      validateReportSummary(run.summary, summary);
      totals.passed += summary.passed; totals.failed += summary.failed; totals.unsupported += summary.unsupported;
    } else if (run.runStatus === "environment_failed") {
      assertExactKeys(run, ["targetId", "family", "tier", "runStatus", "environment", "reason", "cases", "summary"]);
      if (!ENVIRONMENT_FAILURE_REASONS.has(run.reason as string) || !Array.isArray(run.cases) || run.cases.length !== 0) throw new ConformanceValidationError("invalid_environment_failure");
      validateReportSummary(run.summary, { passed: 0, failed: 0, unsupported: 0 });
      totals.failed += 1;
    } else throw new ConformanceValidationError("invalid_run_status");
  });
  validateReportSummary(captured.summary, totals);
  validateReportScan(captured.scan, suite.sentinelSetDigest, scenarios);
  if (!isDigest(captured.reportDigest)) throw new ConformanceValidationError("invalid_digest");
  const computed = await digestConformanceValue(CONFORMANCE_DOMAINS.report, withoutTopLevelField(captured, "reportDigest"));
  if (computed !== captured.reportDigest) throw new ConformanceValidationError("digest_mismatch");
  return captured;
}
