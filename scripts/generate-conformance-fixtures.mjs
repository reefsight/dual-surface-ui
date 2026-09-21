import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const base = resolve(root, "fixtures", "conformance");
const contracts = resolve(base, "contracts");
const scenariosDirectory = resolve(base, "scenarios");

const SCENARIO_DOMAIN = "dual-surface-ui:agent-conformance-scenario:0.1\0";
const MATRIX_DOMAIN = "dual-surface-ui:agent-conformance-capability-matrix:0.1\0";
const SUITE_DOMAIN = "dual-surface-ui:agent-conformance-suite:0.1\0";

const CASES = [
  "DISC-01", "DISC-02", "SUCCESS-01", "SUCCESS-02", "INVALID-01",
  "STALE-01", "REPLACED-01", "DENY-01", "CONFIRM-01", "CONFIRM-02",
  "PRE-01", "PRE-02", "VERIFY-01", "VERIFY-02", "REPLAY-01",
  "CONFLICT-01", "ORIGIN-01", "PRINCIPAL-01", "SURFACE-01",
  "CANCEL-01", "CANCEL-02", "DISP-01", "DISP-02", "REDACT-01",
  "REDACT-02", "REDACT-03",
];

const TARGETS = [
  { targetId: "dom-jsdom", family: "dom", tier: "in-process" },
  { targetId: "webmcp-compat", family: "webmcp", tier: "compatibility" },
  { targetId: "webmcp-native", family: "webmcp", tier: "native-webmcp" },
  { targetId: "mcp-sdk", family: "mcp", tier: "protocol" },
  { targetId: "playwright-managed", family: "playwright", tier: "managed-engine" },
];

const SCAN_CHANNELS = [
  "scenario_artifacts", "capability_matrix", "suite_manifest",
  "fixture_host_input", "authoritative_state", "driver_result",
  "normalized_observation", "mismatches", "report_payload", "stdout",
  "stderr", "packed_tarball_files", "installed_package_files",
];

const canonicalValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  }
  return Object.is(value, -0) ? 0 : value;
};
const canonical = (value) => JSON.stringify(canonicalValue(value));
const sha = (text) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const digest = (domain, value, field) => {
  const payload = { ...value };
  delete payload[field];
  return sha(domain + canonical(payload));
};
const writeJson = async (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");

const identifier = { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" };
const digestSchema = { type: "string", pattern: "^sha256:[a-f0-9]{64}$" };
const jsonValue = {
  oneOf: [
    { type: "null" }, { type: "boolean" }, { type: "number" },
    { type: "string", maxLength: 32768 },
    { type: "array", maxItems: 1024, items: { $ref: "#/$defs/jsonValue" } },
    { type: "object", maxProperties: 1024, additionalProperties: { $ref: "#/$defs/jsonValue" } },
  ],
};

const outcomeSchema = {
  oneOf: [
    {
      type: "object", additionalProperties: false,
      required: ["operation", "status", "previousRevisionRef", "revisionRef", "actionRef", "targetPresent"],
      properties: {
        operation: { type: "integer", minimum: 1, maximum: 64 }, status: { const: "succeeded" },
        previousRevisionRef: { type: "string", pattern: "^revision-[1-9][0-9]*$" }, revisionRef: { type: "string", pattern: "^revision-[1-9][0-9]*$" }, actionRef: identifier,
        targetPresent: { type: "boolean" }, outputDigest: digestSchema,
      },
    },
    {
      type: "object", additionalProperties: false,
      required: ["operation", "status", "revisionRef", "code"],
      properties: { operation: { type: "integer", minimum: 1, maximum: 64 }, status: { const: "failed" }, revisionRef: { type: "string", pattern: "^revision-[1-9][0-9]*$" }, code: identifier },
    },
  ],
};

const lifecycleSchema = {
  type: "object", additionalProperties: false,
  required: ["operation", "event", "outcome", "sequence", "revisionRef"],
  properties: {
    operation: { type: "integer", minimum: 1, maximum: 64 },
    event: { enum: ["action_requested", "policy_decided", "confirmation_requested", "action_started", "action_verified", "action_failed"] },
    outcome: identifier, sequence: { type: "integer", minimum: 1, maximum: 64 }, revisionRef: { type: "string", pattern: "^revision-[1-9][0-9]*$" }, actionRef: identifier,
  },
};

const scenarioSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://dual-surface-ui.dev/schema/private/agent-conformance-scenario-0.1.json",
  title: "Dual Surface UI Private Conformance Scenario", type: "object", additionalProperties: false,
  required: ["schemaVersion", "kind", "scenarioId", "capability", "actions", "initialState", "requests", "sentinelInjections", "expected", "scenarioDigest"],
  properties: {
    schemaVersion: { const: "0.1" }, kind: { const: "agent-conformance-scenario" },
    scenarioId: { enum: CASES }, capability: identifier,
    actions: { type: "array", minItems: 1, maxItems: 128, items: { type: "object", additionalProperties: false, required: ["ref", "elementId", "action", "disposition"], properties: { ref: identifier, elementId: identifier, action: identifier, disposition: { enum: ["permitted", "forbidden"] } } } },
    initialState: { $ref: "#/$defs/jsonValue" },
    requests: { type: "array", minItems: 1, maxItems: 64, items: { type: "object", additionalProperties: false, required: ["operation", "elementId", "action", "controls"], properties: { operation: { type: "integer", minimum: 1, maximum: 64 }, elementId: identifier, action: identifier, input: { $ref: "#/$defs/jsonValue" }, idempotencyKey: identifier, controls: { type: "object", additionalProperties: false, required: ["policy"], properties: { policy: { enum: ["allow", "deny", "require_confirmation"] }, confirmation: { type: "boolean" }, precondition: { type: "boolean" }, effect: { type: "boolean" }, cancelTiming: { enum: ["none", "before_start", "after_start"] }, disposeTiming: { enum: ["none", "before_start", "after_start"] }, originRef: identifier, principalRef: identifier } } } } },
    sentinelInjections: { type: "array", maxItems: 4, items: { type: "object", additionalProperties: false, required: ["channel", "sentinelId", "sentinelDigest", "count"], properties: { channel: { enum: ["fixture_host_input", "authoritative_state"] }, sentinelId: identifier, sentinelDigest: digestSchema, count: { type: "integer", minimum: 1, maximum: 16 } } } },
    expected: { type: "object", additionalProperties: false, required: ["discovery", "outcomes", "lifecycle", "finalState"], properties: {
      discovery: { type: "array", minItems: 1, maxItems: 128, items: { type: "object", additionalProperties: false, required: ["actionRef", "risk", "requiresConfirmation", "idempotency"], properties: { actionRef: identifier, risk: { enum: ["read", "write", "consequential", "destructive"] }, requiresConfirmation: { type: "boolean" }, idempotency: { enum: ["none", "keyed", "safe-retry"] }, inputSchemaDigest: digestSchema, outputSchemaDigest: digestSchema } } },
      outcomes: { type: "array", minItems: 1, maxItems: 64, items: outcomeSchema },
      lifecycle: { type: "array", maxItems: 512, items: lifecycleSchema }, finalState: { $ref: "#/$defs/jsonValue" },
      perTargetOverrides: { type: "object", additionalProperties: false, required: ["playwright-managed"], properties: { "playwright-managed": { type: "object", additionalProperties: false, required: ["outcomes", "lifecycle"], properties: { outcomes: { type: "array", minItems: 1, maxItems: 64, items: outcomeSchema }, lifecycle: { type: "array", maxItems: 512, items: lifecycleSchema } } } } },
    } },
    scenarioDigest: digestSchema,
  },
  allOf: [{ if: { properties: { scenarioId: { const: "DISP-02" } }, required: ["scenarioId"] }, then: { properties: { expected: { type: "object", properties: { perTargetOverrides: {} }, required: ["perTargetOverrides"] } } }, else: { properties: { expected: { type: "object", properties: { perTargetOverrides: {} }, not: { type: "object", properties: { perTargetOverrides: {} }, required: ["perTargetOverrides"] } } } } }],
  $defs: { jsonValue },
};

const targetEntry = (targetId) => ({ oneOf: [
  { type: "object", additionalProperties: false, required: ["targetId", "status"], properties: { targetId: { const: targetId }, status: { const: "supported" } } },
  { type: "object", additionalProperties: false, required: ["targetId", "status", "reason"], properties: { targetId: { const: targetId }, status: { const: "unsupported" }, reason: { enum: ["dom_no_abort_signal", "dom_no_disposal_boundary"] } } },
] });
const matrixSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema", $id: "https://dual-surface-ui.dev/schema/private/agent-conformance-capability-matrix-0.1.json",
  title: "Dual Surface UI Private Conformance Capability Matrix", type: "object", additionalProperties: false,
  required: ["schemaVersion", "kind", "matrixId", "targets", "cases", "matrixDigest"],
  properties: {
    schemaVersion: { const: "0.1" }, kind: { const: "agent-conformance-capability-matrix" }, matrixId: identifier,
    targets: { type: "array", minItems: 5, maxItems: 5, prefixItems: TARGETS.map((target) => ({ type: "object", additionalProperties: false, required: ["targetId", "family", "tier"], properties: { targetId: { const: target.targetId }, family: { const: target.family }, tier: { const: target.tier } } })), items: false },
    cases: { type: "array", minItems: 26, maxItems: 26, items: { type: "object", additionalProperties: false, required: ["caseId", "capability", "targets"], properties: { caseId: { enum: CASES }, capability: identifier, targets: { type: "array", minItems: 5, maxItems: 5, prefixItems: TARGETS.map((item) => targetEntry(item.targetId)), items: false } } } },
    matrixDigest: digestSchema,
  },
};

const suiteSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema", $id: "https://dual-surface-ui.dev/schema/private/agent-conformance-suite-0.1.json",
  title: "Dual Surface UI Private Conformance Suite Manifest", type: "object", additionalProperties: false,
  required: ["schemaVersion", "kind", "suiteId", "matrixDigest", "scenarios", "fixtureHostDigest", "driverDigests", "sentinelSetDigest", "scanChannels", "suiteDigest"],
  properties: {
    schemaVersion: { const: "0.1" }, kind: { const: "agent-conformance-suite" }, suiteId: identifier, matrixDigest: digestSchema,
    scenarios: { type: "array", minItems: 26, maxItems: 26, items: { type: "object", additionalProperties: false, required: ["caseId", "scenarioId", "scenarioDigest", "injectionDigest"], properties: { caseId: { enum: CASES }, scenarioId: { enum: CASES }, scenarioDigest: digestSchema, injectionDigest: digestSchema } } },
    fixtureHostDigest: digestSchema,
    driverDigests: { type: "object", additionalProperties: false, required: TARGETS.map((item) => item.targetId), properties: Object.fromEntries(TARGETS.map((item) => [item.targetId, digestSchema])) },
    sentinelSetDigest: digestSchema,
    scanChannels: { type: "array", minItems: 13, maxItems: 13, prefixItems: SCAN_CHANNELS.map((channel) => ({ const: channel })), items: false }, suiteDigest: digestSchema,
  },
};

const caseResult = {
  oneOf: [
    { type: "object", additionalProperties: false, required: ["caseId", "scenarioDigest", "status"], properties: { caseId: { enum: CASES }, scenarioDigest: digestSchema, status: { const: "passed" } } },
    { type: "object", additionalProperties: false, required: ["caseId", "scenarioDigest", "status", "failureClass", "differences"], properties: { caseId: { enum: CASES }, scenarioDigest: digestSchema, status: { const: "failed" }, failureClass: { enum: ["discovery_mismatch", "outcome_mismatch", "lifecycle_mismatch", "final_state_mismatch", "secret_scan_failed", "driver_result_invalid"] }, differences: { type: "array", maxItems: 256, items: { type: "object", additionalProperties: false, required: ["path"], properties: { path: { enum: ["discovery", "outcome", "lifecycle", "final_state", "secret_channel"] }, operation: { type: "integer", minimum: 1, maximum: 64 }, index: { type: "integer", minimum: 0, maximum: 511 }, actionRef: identifier } } } } },
    { type: "object", additionalProperties: false, required: ["caseId", "scenarioDigest", "status", "reason"], properties: { caseId: { enum: CASES }, scenarioDigest: digestSchema, status: { const: "unsupported" }, reason: { enum: ["dom_no_abort_signal", "dom_no_disposal_boundary"] } } },
  ],
};
const scanChannelSchema = (channel) => {
  if (channel === "fixture_host_input" || channel === "authoritative_state") {
    const evidence = { type: "object", additionalProperties: false, required: ["sentinelId", "sentinelDigest", "count"], properties: { sentinelId: identifier, sentinelDigest: digestSchema, count: { type: "integer", minimum: 1 } } };
    return { type: "object", additionalProperties: false, required: ["channel", "kind", "bytesScanned", "expected", "observed"], properties: { channel: { const: channel }, kind: { const: "trusted_injection" }, bytesScanned: { type: "integer", minimum: 0 }, expected: { type: "array", maxItems: 104, items: evidence }, observed: { type: "array", maxItems: 104, items: evidence } } };
  }
  return { type: "object", additionalProperties: false, required: ["channel", "kind", "bytesScanned", "matches"], properties: { channel: { const: channel }, kind: { const: "egress_artifact" }, bytesScanned: { type: "integer", minimum: 0 }, matches: { const: 0 } } };
};
const environmentSchema = { type: "object", additionalProperties: false, properties: { runtime: { type: "string", maxLength: 128 }, browser: { type: "string", maxLength: 128 }, protocol: { type: "string", maxLength: 128 } } };
const summarySchema = { type: "object", additionalProperties: false, required: ["passed", "failed", "unsupported"], properties: { passed: { type: "integer", minimum: 0 }, failed: { type: "integer", minimum: 0 }, unsupported: { type: "integer", minimum: 0 } } };
const targetIdentitySchema = { oneOf: TARGETS.map((target) => ({ type: "object", properties: { targetId: { const: target.targetId }, family: { const: target.family }, tier: { const: target.tier } }, required: ["targetId", "family", "tier"] })) };
const completedRunSchema = { type: "object", additionalProperties: false, required: ["targetId", "family", "tier", "runStatus", "environment", "cases", "summary"], properties: { targetId: { enum: TARGETS.map((item) => item.targetId) }, family: { enum: ["dom", "webmcp", "mcp", "playwright"] }, tier: { enum: TARGETS.map((item) => item.tier) }, runStatus: { const: "completed" }, environment: environmentSchema, cases: { type: "array", minItems: 22, maxItems: 26, items: caseResult }, summary: summarySchema }, allOf: [targetIdentitySchema] };
const environmentFailedRunSchema = { type: "object", additionalProperties: false, required: ["targetId", "family", "tier", "runStatus", "environment", "reason", "cases", "summary"], properties: { targetId: { enum: TARGETS.map((item) => item.targetId) }, family: { enum: ["dom", "webmcp", "mcp", "playwright"] }, tier: { enum: TARGETS.map((item) => item.tier) }, runStatus: { const: "environment_failed" }, environment: environmentSchema, reason: { enum: ["native_api_unavailable", "browser_launch_failed", "protocol_environment_failed"] }, cases: { type: "array", maxItems: 0 }, summary: { type: "object", additionalProperties: false, required: ["passed", "failed", "unsupported"], properties: { passed: { const: 0 }, failed: { const: 0 }, unsupported: { const: 0 } } } }, allOf: [targetIdentitySchema] };
const reportSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema", $id: "https://dual-surface-ui.dev/schema/private/agent-conformance-report-0.1.json",
  title: "Dual Surface UI Private Conformance Report", type: "object", additionalProperties: false,
  required: ["schemaVersion", "kind", "suiteId", "suiteDigest", "matrixDigest", "sentinelSetDigest", "source", "package", "scan", "runs", "summary", "reportDigest"],
  properties: {
    schemaVersion: { const: "0.1" }, kind: { const: "agent-conformance-report" }, suiteId: identifier, suiteDigest: digestSchema, matrixDigest: digestSchema, sentinelSetDigest: digestSchema,
    source: { type: "object", additionalProperties: false, required: ["commit", "treeDigest", "dirty"], properties: { commit: { type: "string", pattern: "^[a-f0-9]{40}$" }, treeDigest: digestSchema, dirty: { const: false } } },
    package: { type: "object", additionalProperties: false, required: ["name", "version", "tarballDigest", "installedManifestDigest"], properties: { name: { const: "dual-surface-ui" }, version: { type: "string", pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$" }, tarballDigest: digestSchema, installedManifestDigest: digestSchema } },
    scan: { type: "object", additionalProperties: false, required: ["sentinelSetDigest", "channels", "bytesScanned"], properties: { sentinelSetDigest: digestSchema, channels: { type: "array", minItems: 13, maxItems: 13, prefixItems: SCAN_CHANNELS.map(scanChannelSchema), items: false }, bytesScanned: { type: "integer", minimum: 0 } } },
    runs: { type: "array", minItems: 5, maxItems: 5, items: { oneOf: [completedRunSchema, environmentFailedRunSchema] } },
    summary: summarySchema, reportDigest: digestSchema,
  },
};

const capability = (caseId) => caseId.split("-")[0].toLowerCase();
const fixedSentinels = [
  { sentinelId: "sentinel-input", value: "DSUI_TEST_SECRET_INPUT_7f3c9a", channels: ["fixture_host_input"] },
  { sentinelId: "sentinel-state", value: "DSUI_TEST_SECRET_STATE_4d8e2b", channels: ["authoritative_state"] },
];
const sentinels = fixedSentinels.map(({ sentinelId, value, channels }) => ({ sentinelId, value, channels, sentinelDigest: sha(value) }));
let sentinelSet = { schemaVersion: "0.1", kind: "agent-conformance-sentinel-set", sentinelSetId: "phase3-conformance", sentinels };
sentinelSet = { ...sentinelSet, sentinelSetDigest: digest(SUITE_DOMAIN, sentinelSet, "sentinelSetDigest") };
const fixtureInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    decision: { type: "string", enum: ["approve", "reject"] },
    note: { type: "string" },
  },
  required: ["decision"],
};
const fixtureInputSchemaDigest = sha(SCENARIO_DOMAIN + canonical(fixtureInputSchema));

const failureCode = (id) => ({
  "INVALID-01": "invalid_input", "STALE-01": "stale_revision", "REPLACED-01": "stale_revision",
  "DENY-01": "authorization_required", "CONFIRM-02": "confirmation_required", "PRE-02": "precondition_failed",
  "VERIFY-02": "verification_failed", "CONFLICT-01": "idempotency_conflict", "SURFACE-01": "surface_mismatch", "CANCEL-01": "internal_error",
  "DISP-01": "stale_revision",
}[id]);

const makeScenario = (id) => {
  const keyed = ["REPLAY-01", "CONFLICT-01", "ORIGIN-01", "PRINCIPAL-01"].includes(id);
  const denied = failureCode(id);
  const stateValue = !denied || ["CANCEL-02", "DISP-02", "CONFLICT-01"].includes(id) ? "approved" : "pending";
  const inputSentinel = sentinels[0];
  const stateSentinel = sentinels[1];
  const injections = [];
  let input = { decision: "approve" };
  let initialState = { decision: "pending", mutations: 0 };
  if (id === "REDACT-01" || id === "REDACT-03") {
    input = { decision: "approve", note: { $sentinelRef: inputSentinel.sentinelId } };
    injections.push({ channel: "fixture_host_input", sentinelId: inputSentinel.sentinelId, sentinelDigest: inputSentinel.sentinelDigest, count: 1 });
  }
  if (id === "REDACT-02" || id === "REDACT-03") {
    initialState = { decision: "pending", mutations: 0, privateNote: { $sentinelRef: stateSentinel.sentinelId } };
    injections.push({ channel: "authoritative_state", sentinelId: stateSentinel.sentinelId, sentinelDigest: stateSentinel.sentinelDigest, count: 1 });
  }
  const controls = { policy: id === "DENY-01" ? "deny" : id.startsWith("CONFIRM") ? "require_confirmation" : "allow" };
  if (id === "CONFIRM-01" || id === "CONFIRM-02") controls.confirmation = id === "CONFIRM-01";
  if (id.startsWith("PRE-")) controls.precondition = id === "PRE-01";
  if (id.startsWith("VERIFY-")) controls.effect = id === "VERIFY-01";
  if (id.startsWith("CANCEL-")) controls.cancelTiming = id === "CANCEL-01" ? "before_start" : "after_start";
  if (id.startsWith("DISP-")) controls.disposeTiming = id === "DISP-01" ? "before_start" : "after_start";
  if (id === "ORIGIN-01" || id === "PRINCIPAL-01") {
    controls.originRef = "origin-a";
    controls.principalRef = "principal-a";
  }
  if (id === "INVALID-01") input = { decision: 42 };
  const firstRequest = { operation: 1, elementId: "approval", action: "approve", input, controls, ...(keyed ? { idempotencyKey: "approval-key-1" } : {}) };
  const requests = [firstRequest];
  if (keyed) requests.push({
    ...firstRequest,
    operation: 2,
    ...(id === "CONFLICT-01" ? { input: { decision: "reject" } } : {}),
    ...(id === "ORIGIN-01" ? { controls: { ...controls, originRef: "origin-b" } } : {}),
    ...(id === "PRINCIPAL-01" ? { controls: { ...controls, principalRef: "principal-b" } } : {}),
  });
  const firstOutcome = denied && id !== "CONFLICT-01"
    ? { operation: 1, status: "failed", revisionRef: id === "REPLACED-01" ? "revision-2" : stateValue === "approved" ? "revision-2" : "revision-1", code: denied }
    : { operation: 1, status: "succeeded", previousRevisionRef: "revision-1", revisionRef: "revision-2", actionRef: "action-1", targetPresent: true };
  const requested = (operation, revisionRef = "revision-1") => ({ operation, event: "action_requested", outcome: "requested", sequence: 1, revisionRef, actionRef: "action-1" });
  const event = (operation, name, outcome, sequence, revisionRef = "revision-1") => ({ operation, event: name, outcome, sequence, revisionRef, actionRef: "action-1" });
  const failed = (operation, code, sequence, revisionRef = "revision-1", withAction = true) => ({ operation, event: "action_failed", outcome: code, sequence, revisionRef, ...(withAction ? { actionRef: "action-1" } : {}) });
  let lifecycle;
  if (["STALE-01", "SURFACE-01", "CANCEL-01", "DISP-01"].includes(id)) {
    lifecycle = [failed(1, denied, 1, "revision-1", false)];
  } else if (id === "INVALID-01") {
    lifecycle = [requested(1), failed(1, denied, 2)];
  } else if (id === "DENY-01") {
    lifecycle = [requested(1), event(1, "policy_decided", "deny", 2), failed(1, denied, 3)];
  } else if (id === "CONFIRM-02") {
    lifecycle = [requested(1), event(1, "policy_decided", "require_confirmation", 2), event(1, "confirmation_requested", "requested", 3), failed(1, denied, 4)];
  } else if (id === "PRE-02") {
    lifecycle = [requested(1), event(1, "policy_decided", "allow", 2), failed(1, denied, 3)];
  } else if (id === "VERIFY-02") {
    lifecycle = [requested(1), event(1, "policy_decided", "allow", 2), event(1, "action_started", "started", 3), failed(1, denied, 4)];
  } else if (id === "REPLACED-01") {
    lifecycle = [requested(1), event(1, "policy_decided", "allow", 2), failed(1, denied, 3, "revision-2")];
  } else {
    lifecycle = [requested(1), event(1, "policy_decided", id.startsWith("CONFIRM-") ? "require_confirmation" : "allow", 2)];
    if (id === "CONFIRM-01") lifecycle.push(event(1, "confirmation_requested", "requested", 3));
    lifecycle.push(event(1, "action_started", "started", lifecycle.length + 1), event(1, "action_verified", "succeeded", lifecycle.length + 2, "revision-2"));
  }
  const outcomes = [firstOutcome];
  if (id === "REPLAY-01") {
    outcomes.push({ operation: 2, status: "succeeded", previousRevisionRef: "revision-1", revisionRef: "revision-2", actionRef: "action-1", targetPresent: true });
    lifecycle.push(requested(2, "revision-2"), event(2, "action_verified", "replayed", 2, "revision-2"));
  } else if (id === "CONFLICT-01") {
    outcomes.push({ operation: 2, status: "failed", revisionRef: "revision-2", code: "idempotency_conflict" });
    lifecycle.push(requested(2, "revision-2"), failed(2, "idempotency_conflict", 2, "revision-2"));
  } else if (id === "ORIGIN-01") {
    // The public surface captures the new origin in a new semantic snapshot
    // before rejecting reuse, so the failure owns a third revision alias.
    outcomes.push({ operation: 2, status: "failed", revisionRef: "revision-3", code: "stale_revision" });
    lifecycle.push(failed(2, "stale_revision", 1, "revision-3", false));
  } else if (id === "PRINCIPAL-01") {
    outcomes.push({ operation: 2, status: "failed", revisionRef: "revision-2", code: "idempotency_conflict" });
    lifecycle.push(requested(2, "revision-2"), failed(2, "idempotency_conflict", 2, "revision-2"));
  }
  const finalState = { decision: stateValue, mutations: stateValue === "approved" ? 1 : 0, ...(Object.hasOwn(initialState, "privateNote") ? { privateNote: initialState.privateNote } : {}) };
  const expected = {
    discovery: [{ actionRef: "action-1", risk: "consequential", requiresConfirmation: id.startsWith("CONFIRM"), idempotency: keyed ? "keyed" : "none", inputSchemaDigest: fixtureInputSchemaDigest }],
    outcomes, lifecycle, finalState,
  };
  if (id === "DISP-02") {
    expected.perTargetOverrides = { "playwright-managed": { outcomes: [{ operation: 1, status: "failed", revisionRef: "revision-2", code: "stale_revision" }], lifecycle: [requested(1), event(1, "policy_decided", "allow", 2), event(1, "action_started", "started", 3), failed(1, "stale_revision", 4, "revision-2")] } };
  }
  const scenario = { schemaVersion: "0.1", kind: "agent-conformance-scenario", scenarioId: id, capability: capability(id), actions: [{ ref: "action-1", elementId: "approval", action: "approve", disposition: id === "DENY-01" ? "forbidden" : "permitted" }], initialState, requests, sentinelInjections: injections, expected };
  return { ...scenario, scenarioDigest: digest(SCENARIO_DOMAIN, scenario, "scenarioDigest") };
};

await Promise.all([mkdir(contracts, { recursive: true }), mkdir(scenariosDirectory, { recursive: true })]);
await Promise.all([
  writeJson(resolve(contracts, "agent-conformance-scenario-0.1.schema.json"), scenarioSchema),
  writeJson(resolve(contracts, "agent-conformance-capability-matrix-0.1.schema.json"), matrixSchema),
  writeJson(resolve(contracts, "agent-conformance-suite-0.1.schema.json"), suiteSchema),
  writeJson(resolve(contracts, "agent-conformance-report-0.1.schema.json"), reportSchema),
  writeJson(resolve(base, "sentinels-0.1.json"), sentinelSet),
]);

const scenarios = CASES.map(makeScenario);
await Promise.all(scenarios.map((scenario) => writeJson(resolve(scenariosDirectory, `${scenario.scenarioId}.json`), scenario)));

const targetCells = (caseId) => TARGETS.map(({ targetId }) => {
  if (targetId === "dom-jsdom" && caseId.startsWith("CANCEL-")) return { targetId, status: "unsupported", reason: "dom_no_abort_signal" };
  if (targetId === "dom-jsdom" && caseId.startsWith("DISP-")) return { targetId, status: "unsupported", reason: "dom_no_disposal_boundary" };
  return { targetId, status: "supported" };
});
let matrix = { schemaVersion: "0.1", kind: "agent-conformance-capability-matrix", matrixId: "phase3-cross-exporter", targets: TARGETS, cases: CASES.map((caseId) => ({ caseId, capability: capability(caseId), targets: targetCells(caseId) })) };
matrix = { ...matrix, matrixDigest: digest(MATRIX_DOMAIN, matrix, "matrixDigest") };
await writeJson(resolve(base, "capability-matrix-0.1.json"), matrix);

const sourceBindings = [
  { targetId: "dom-jsdom", sourcePath: "test/conformance/drivers/dom.ts" },
  { targetId: "webmcp-compat", sourcePath: "test/conformance/drivers/webmcp.ts" },
  { targetId: "webmcp-native", sourcePath: "e2e/native/conformance-driver.ts" },
  { targetId: "mcp-sdk", sourcePath: "test/conformance/drivers/mcp.ts" },
  { targetId: "playwright-managed", sourcePath: "test/conformance/drivers/playwright.ts" },
];
const sourceDigest = async (path) => sha(await readFile(resolve(root, path)));
const injectionDigest = (scenario) => sha(SCENARIO_DOMAIN + canonical(scenario.sentinelInjections));
const suiteDigest = (suite) => sha(SUITE_DOMAIN + canonical({
  matrixDigest: suite.matrixDigest,
  scenarios: suite.scenarios.map(({ caseId, scenarioDigest, injectionDigest }) => ({
    caseId,
    scenarioDigest,
    injectionDigest,
  })),
  fixtureHostDigest: suite.fixtureHostDigest,
  driverDigests: suite.driverDigests,
  sentinelSetDigest: suite.sentinelSetDigest,
  scanChannels: suite.scanChannels,
}));
let generatedSuite;
try {
  const fixtureHostDigest = await sourceDigest("test/conformance/fixture-host.ts");
  const driverDigests = Object.fromEntries(await Promise.all(sourceBindings.map(async (binding) => [binding.targetId, await sourceDigest(binding.sourcePath)])));
  let suite = {
    schemaVersion: "0.1", kind: "agent-conformance-suite", suiteId: "phase3-cross-exporter",
    matrixDigest: matrix.matrixDigest,
    scenarios: scenarios.map((scenario) => ({ caseId: scenario.scenarioId, scenarioId: scenario.scenarioId, scenarioDigest: scenario.scenarioDigest, injectionDigest: injectionDigest(scenario) })),
    fixtureHostDigest, driverDigests,
    sentinelSetDigest: sentinelSet.sentinelSetDigest, scanChannels: SCAN_CHANNELS,
  };
  suite = { ...suite, suiteDigest: suiteDigest(suite) };
  await writeJson(resolve(base, "suite-0.1.json"), suite);
  generatedSuite = suite;
  console.log(`Generated ${scenarios.length} conformance scenarios, contracts, and source-bound suite.`);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  console.log(`Generated ${scenarios.length} conformance scenarios and contracts; suite deferred until real driver sources exist.`);
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validators = [scenarioSchema, matrixSchema, suiteSchema, reportSchema].map((schema) => ajv.compile(schema));
for (const scenario of scenarios) {
  if (!validators[0](scenario)) throw new Error(`Scenario schema rejected ${scenario.scenarioId}: ${JSON.stringify(validators[0].errors)}`);
  if (scenario.scenarioDigest !== digest(SCENARIO_DOMAIN, scenario, "scenarioDigest")) throw new Error(`Scenario digest mismatch: ${scenario.scenarioId}`);
  const serialized = JSON.stringify(scenario);
  if (sentinels.some((sentinel) => serialized.includes(sentinel.value))) throw new Error(`Raw sentinel leaked into scenario: ${scenario.scenarioId}`);
}
if (scenarios.length !== 26 || scenarios.some((scenario, index) => scenario.scenarioId !== CASES[index])) throw new Error("Scenario set/order mismatch");
if (!validators[1](matrix)) throw new Error(`Matrix schema rejected: ${JSON.stringify(validators[1].errors)}`);
if (matrix.matrixDigest !== digest(MATRIX_DOMAIN, matrix, "matrixDigest")) throw new Error("Matrix digest mismatch");
for (const [index, item] of matrix.cases.entries()) {
  if (item.caseId !== CASES[index] || item.targets.some((entry, targetIndex) => entry.targetId !== TARGETS[targetIndex].targetId)) throw new Error("Matrix set/order mismatch");
  for (const entry of item.targets) {
    const allowedAbort = entry.targetId === "dom-jsdom" && item.caseId.startsWith("CANCEL-") && entry.status === "unsupported" && entry.reason === "dom_no_abort_signal";
    const allowedDispose = entry.targetId === "dom-jsdom" && item.caseId.startsWith("DISP-") && entry.status === "unsupported" && entry.reason === "dom_no_disposal_boundary";
    if (!allowedAbort && !allowedDispose && entry.status !== "supported") throw new Error(`Invalid matrix waiver: ${item.caseId}/${entry.targetId}`);
  }
}
for (const sentinel of sentinels) if (sentinel.sentinelDigest !== sha(sentinel.value)) throw new Error(`Sentinel value fingerprint mismatch: ${sentinel.sentinelId}`);
if (sentinelSet.sentinelSetDigest !== digest(SUITE_DOMAIN, sentinelSet, "sentinelSetDigest")) throw new Error("Sentinel set digest mismatch");
if (generatedSuite) {
  if (!validators[2](generatedSuite)) throw new Error(`Suite schema rejected: ${JSON.stringify(validators[2].errors)}`);
  if (generatedSuite.suiteDigest !== suiteDigest(generatedSuite)) throw new Error("Suite digest mismatch");
  for (const [index, binding] of generatedSuite.scenarios.entries()) {
    const scenario = scenarios[index];
    if (binding.caseId !== CASES[index] || binding.scenarioId !== binding.caseId || binding.scenarioDigest !== scenario.scenarioDigest || binding.injectionDigest !== injectionDigest(scenario)) throw new Error(`Suite scenario binding mismatch: ${binding.caseId}`);
  }
}
console.log(`Validated strict schemas, exact sets, and digests${generatedSuite ? " including source-bound suite" : " (suite pending sources)"}.`);
