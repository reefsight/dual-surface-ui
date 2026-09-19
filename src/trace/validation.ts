import {
  AGENT_AUDIT_EVENT_NAMES,
  AGENT_AUDIT_OUTCOMES,
} from "../audit.js";
import type {
  AgentAuditEventName,
  AgentAuditOutcome,
} from "../audit.js";
import { AGENT_FAILURE_CODES } from "../errors.js";
import {
  deepFreezeJson,
  descriptorSafeCaptureJson,
} from "../delta/canonical.js";
import {
  ZERO_TRACE_DIGEST,
  canonicalRuntimeTraceText,
  containsSecretSentinel,
  digestRuntimeTraceRecord,
} from "./canonical.js";
import type { UnsignedAgentRuntimeTraceRecord } from "./canonical.js";
import {
  AGENT_RUNTIME_TRACE_KIND,
  AGENT_RUNTIME_TRACE_LIMITS,
  AGENT_RUNTIME_TRACE_SCHEMA_VERSION,
} from "./schema.js";
import type {
  AgentRuntimeTrace,
  AgentRuntimeTraceDigest,
  AgentRuntimeTraceRecord,
} from "./types.js";

const SOURCE_PATTERN = /^[A-Za-z0-9._~-]{1,128}$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const REVISION_REF_PATTERN = /^revision-([1-9][0-9]*)$/;
const ACTION_REF_PATTERN = /^action-([1-9][0-9]*)$/;
const EVENT_NAMES = new Set<string>(AGENT_AUDIT_EVENT_NAMES);
const OUTCOMES = new Set<string>(AGENT_AUDIT_OUTCOMES);
const FAILURE_OUTCOMES = new Set<string>(AGENT_FAILURE_CODES);
const encoder = new TextEncoder();

export class AgentTraceValidationError extends TypeError {
  constructor() {
    super("Runtime trace validation failed");
    this.name = "AgentTraceValidationError";
  }
}

function invalid(): never {
  throw new AgentTraceValidationError();
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const recordValue = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) invalid();
  return value;
};

const onlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): void => {
  const set = new Set(allowed);
  if (Object.keys(value).some((key) => !set.has(key))) invalid();
};

const required = (value: Record<string, unknown>, key: string): unknown => {
  if (!Object.hasOwn(value, key)) invalid();
  return value[key];
};

const stringValue = (value: unknown): string => {
  if (typeof value !== "string") invalid();
  return value;
};

const positiveInteger = (value: unknown, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    invalid();
  }
  return value as number;
};

const refOrdinal = (value: string, pattern: RegExp): number => {
  const match = pattern.exec(value);
  if (!match) invalid();
  return positiveInteger(Number(match[1]!));
};

type OperationStage =
  | "requested"
  | "policy_allow"
  | "policy_confirmation"
  | "policy_deny"
  | "confirmation"
  | "started"
  | "terminal";

interface OperationState {
  actionRef?: string;
  sequence: number;
  stage: OperationStage;
}

export interface RuntimeTraceOrderState {
  readonly operations: Map<number, OperationState>;
  actionRefCount: number;
  revisionRefCount: number;
}

export const createRuntimeTraceOrderState = (): RuntimeTraceOrderState => ({
  operations: new Map(),
  actionRefCount: 0,
  revisionRefCount: 0,
});

const acceptRef = (
  ref: string,
  pattern: RegExp,
  knownCount: number,
  seen: Set<string>,
): number => {
  const ordinal = refOrdinal(ref, pattern);
  if (seen.has(ref)) return knownCount;
  if (ordinal !== knownCount + 1) invalid();
  seen.add(ref);
  return ordinal;
};

const ACTION_SEEN = Symbol("actionSeen");
const REVISION_SEEN = Symbol("revisionSeen");
type InternalOrderState = RuntimeTraceOrderState & {
  [ACTION_SEEN]?: Set<string>;
  [REVISION_SEEN]?: Set<string>;
};

const seenFor = (
  state: RuntimeTraceOrderState,
  key: typeof ACTION_SEEN | typeof REVISION_SEEN,
): Set<string> => {
  const internal = state as InternalOrderState;
  const existing = internal[key];
  if (existing) return existing;
  const created = new Set<string>();
  internal[key] = created;
  return created;
};

const isFailure = (outcome: AgentAuditOutcome): boolean =>
  FAILURE_OUTCOMES.has(outcome);

/** Validates one normalized record and advances only deterministic order state. */
export const acceptRuntimeTraceOrder = (
  record: UnsignedAgentRuntimeTraceRecord,
  state: RuntimeTraceOrderState,
): void => {
  state.revisionRefCount = acceptRef(
    record.revisionRef,
    REVISION_REF_PATTERN,
    state.revisionRefCount,
    seenFor(state, REVISION_SEEN),
  );
  if (record.actionRef !== undefined) {
    state.actionRefCount = acceptRef(
      record.actionRef,
      ACTION_REF_PATTERN,
      state.actionRefCount,
      seenFor(state, ACTION_SEEN),
    );
  }

  const current = state.operations.get(record.operation);
  if (!current) {
    if (record.operation !== state.operations.size + 1 || record.sequence !== 1) invalid();
    if (record.event === "surface_observed" && record.outcome === "observed") {
      if (record.actionRef !== undefined) invalid();
      state.operations.set(record.operation, { sequence: 1, stage: "terminal" });
      return;
    }
    if (record.event === "action_failed" && isFailure(record.outcome)) {
      if (record.actionRef !== undefined) invalid();
      state.operations.set(record.operation, { sequence: 1, stage: "terminal" });
      return;
    }
    if (
      record.event !== "action_requested" ||
      record.outcome !== "requested" ||
      record.actionRef === undefined
    ) {
      invalid();
    }
    const actionRef = record.actionRef;
    if (actionRef === undefined) invalid();
    state.operations.set(record.operation, {
      actionRef,
      sequence: 1,
      stage: "requested",
    });
    return;
  }

  if (current.stage === "terminal" || record.sequence !== current.sequence + 1) invalid();
  if (current.actionRef === undefined || record.actionRef !== current.actionRef) invalid();
  current.sequence = record.sequence;

  if (record.event === "action_failed" && isFailure(record.outcome)) {
    current.stage = "terminal";
    return;
  }
  if (
    current.stage === "requested" &&
    record.event === "action_verified" &&
    record.outcome === "replayed"
  ) {
    current.stage = "terminal";
    return;
  }
  if (current.stage === "requested" && record.event === "policy_decided") {
    if (record.outcome === "deny") current.stage = "policy_deny";
    else if (record.outcome === "allow") current.stage = "policy_allow";
    else if (record.outcome === "require_confirmation") {
      current.stage = "policy_confirmation";
    } else invalid();
    return;
  }
  if (
    (current.stage === "policy_allow" || current.stage === "policy_confirmation") &&
    record.event === "confirmation_requested" &&
    record.outcome === "requested"
  ) {
    current.stage = "confirmation";
    return;
  }
  if (
    (current.stage === "policy_allow" || current.stage === "confirmation") &&
    record.event === "action_started" &&
    record.outcome === "started"
  ) {
    current.stage = "started";
    return;
  }
  if (
    current.stage === "started" &&
    record.event === "action_verified" &&
    record.outcome === "succeeded"
  ) {
    current.stage = "terminal";
    return;
  }
  invalid();
};

export const assertRuntimeTraceOrderComplete = (
  state: RuntimeTraceOrderState,
): void => {
  if (
    state.operations.size === 0 ||
    [...state.operations.values()].some((operation) => operation.stage !== "terminal")
  ) {
    invalid();
  }
};

const captureRecord = (value: unknown): AgentRuntimeTraceRecord => {
  const source = recordValue(value);
  onlyKeys(source, [
    "index",
    "operation",
    "sequence",
    "event",
    "outcome",
    "revisionRef",
    "previousDigest",
    "digest",
    "actionRef",
  ]);
  const event = stringValue(required(source, "event"));
  const outcome = stringValue(required(source, "outcome"));
  const revisionRef = stringValue(required(source, "revisionRef"));
  const previousDigest = stringValue(required(source, "previousDigest"));
  const digest = stringValue(required(source, "digest"));
  const actionValue = Object.hasOwn(source, "actionRef") ? source.actionRef : undefined;
  if (
    !EVENT_NAMES.has(event) ||
    !OUTCOMES.has(outcome) ||
    !REVISION_REF_PATTERN.test(revisionRef) ||
    !DIGEST_PATTERN.test(previousDigest) ||
    !DIGEST_PATTERN.test(digest) ||
    (actionValue !== undefined &&
      (typeof actionValue !== "string" || !ACTION_REF_PATTERN.test(actionValue)))
  ) invalid();
  const actionRef = actionValue === undefined ? undefined : stringValue(actionValue);
  return {
    index: positiveInteger(required(source, "index"), AGENT_RUNTIME_TRACE_LIMITS.records),
    operation: positiveInteger(
      required(source, "operation"),
      AGENT_RUNTIME_TRACE_LIMITS.operations,
    ),
    sequence: positiveInteger(required(source, "sequence")),
    event: event as AgentAuditEventName,
    outcome: outcome as AgentAuditOutcome,
    revisionRef,
    previousDigest: previousDigest as AgentRuntimeTraceDigest,
    digest: digest as AgentRuntimeTraceDigest,
    ...(actionRef !== undefined ? { actionRef } : {}),
  };
};

export const captureAndValidateAgentRuntimeTrace = async (
  value: unknown,
): Promise<AgentRuntimeTrace> => {
  let captured: unknown;
  try {
    captured = descriptorSafeCaptureJson(value, {
      maxDepth: AGENT_RUNTIME_TRACE_LIMITS.inputDepth,
      maxNodes: AGENT_RUNTIME_TRACE_LIMITS.inputNodes,
      maxCharacters: AGENT_RUNTIME_TRACE_LIMITS.bytes,
      maxStringLength: AGENT_RUNTIME_TRACE_LIMITS.inputStringLength,
      maxPropertiesPerObject: AGENT_RUNTIME_TRACE_LIMITS.inputPropertiesPerObject,
    });
  } catch {
    return invalid();
  }
  const source = recordValue(captured);
  onlyKeys(source, [
    "schemaVersion",
    "kind",
    "sourceId",
    "recordCount",
    "operationCount",
    "headDigest",
    "records",
  ]);
  if (
    required(source, "schemaVersion") !== AGENT_RUNTIME_TRACE_SCHEMA_VERSION ||
    required(source, "kind") !== AGENT_RUNTIME_TRACE_KIND
  ) invalid();
  const sourceId = stringValue(required(source, "sourceId"));
  if (!SOURCE_PATTERN.test(sourceId) || containsSecretSentinel(sourceId)) invalid();
  const recordCount = positiveInteger(
    required(source, "recordCount"),
    AGENT_RUNTIME_TRACE_LIMITS.records,
  );
  const operationCount = positiveInteger(
    required(source, "operationCount"),
    AGENT_RUNTIME_TRACE_LIMITS.operations,
  );
  const headDigest = stringValue(required(source, "headDigest"));
  if (!DIGEST_PATTERN.test(headDigest)) invalid();
  const recordsValue = required(source, "records");
  if (!Array.isArray(recordsValue) || recordsValue.length !== recordCount) invalid();

  const records = recordsValue.map(captureRecord);
  const order = createRuntimeTraceOrderState();
  let previousDigest = ZERO_TRACE_DIGEST;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    if (record.index !== index + 1 || record.previousDigest !== previousDigest) invalid();
    const unsigned: UnsignedAgentRuntimeTraceRecord = {
      index: record.index,
      operation: record.operation,
      sequence: record.sequence,
      event: record.event,
      outcome: record.outcome,
      revisionRef: record.revisionRef,
      ...(record.actionRef !== undefined ? { actionRef: record.actionRef } : {}),
    };
    acceptRuntimeTraceOrder(unsigned, order);
    let expectedDigest: AgentRuntimeTraceDigest;
    try {
      expectedDigest = await digestRuntimeTraceRecord(
        sourceId,
        previousDigest,
        unsigned,
      );
    } catch {
      return invalid();
    }
    if (expectedDigest !== record.digest) invalid();
    previousDigest = record.digest;
  }
  assertRuntimeTraceOrderComplete(order);
  if (order.operations.size !== operationCount || previousDigest !== headDigest) invalid();

  const result: AgentRuntimeTrace = {
    schemaVersion: AGENT_RUNTIME_TRACE_SCHEMA_VERSION,
    kind: AGENT_RUNTIME_TRACE_KIND,
    sourceId,
    recordCount,
    operationCount,
    headDigest: headDigest as AgentRuntimeTraceDigest,
    records,
  };
  try {
    if (
      encoder.encode(canonicalRuntimeTraceText(result)).byteLength >
      AGENT_RUNTIME_TRACE_LIMITS.bytes
    ) invalid();
  } catch (error) {
    if (error instanceof AgentTraceValidationError) throw error;
    return invalid();
  }
  return deepFreezeJson(result);
};
