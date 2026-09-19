import {
  AGENT_AUDIT_EVENT_NAMES,
  AGENT_AUDIT_OUTCOMES,
} from "../audit.js";
import type { AgentAuditEvent } from "../audit.js";
import {
  deepFreezeJson,
  descriptorSafeCaptureJson,
} from "../delta/canonical.js";
import {
  ZERO_TRACE_DIGEST,
  buildRuntimeTraceRecord,
  canonicalRuntimeTraceText,
  containsSecretSentinel,
} from "./canonical.js";
import type { UnsignedAgentRuntimeTraceRecord } from "./canonical.js";
import {
  AGENT_RUNTIME_TRACE_KIND,
  AGENT_RUNTIME_TRACE_LIMITS,
  AGENT_RUNTIME_TRACE_SCHEMA_VERSION,
} from "./schema.js";
import type {
  AgentRuntimeTrace,
  AgentTraceFinishResult,
  AgentTraceRecorder,
  AgentTraceRecorderOptions,
  AgentTraceRejectionReason,
} from "./types.js";
import {
  acceptRuntimeTraceOrder,
  assertRuntimeTraceOrderComplete,
  captureAndValidateAgentRuntimeTrace,
  createRuntimeTraceOrderState,
} from "./validation.js";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9._~-]{1,128}$/;
const EVENT_NAMES = new Set<string>(AGENT_AUDIT_EVENT_NAMES);
const OUTCOMES = new Set<string>(AGENT_AUDIT_OUTCOMES);
const encoder = new TextEncoder();

export class AgentTraceConfigurationError extends TypeError {
  constructor() {
    super("Invalid runtime trace recorder configuration");
    this.name = "AgentTraceConfigurationError";
  }
}

function invalidConfiguration(): never {
  throw new AgentTraceConfigurationError();
}

const captureSourceId = (options: AgentTraceRecorderOptions): string => {
  let captured: unknown;
  try {
    captured = descriptorSafeCaptureJson(options, {
      maxDepth: 2,
      maxNodes: 4,
      maxCharacters: 256,
      maxStringLength: AGENT_RUNTIME_TRACE_LIMITS.sourceIdLength,
      maxPropertiesPerObject: 1,
    });
  } catch {
    return invalidConfiguration();
  }
  if (
    typeof captured !== "object" ||
    captured === null ||
    Array.isArray(captured) ||
    Object.keys(captured).length !== 1 ||
    !Object.hasOwn(captured, "sourceId")
  ) invalidConfiguration();
  const sourceId = (captured as Record<string, unknown>).sourceId;
  if (
    typeof sourceId !== "string" ||
    !IDENTIFIER_PATTERN.test(sourceId) ||
    containsSecretSentinel(sourceId)
  ) invalidConfiguration();
  return sourceId;
};

interface CapturedAuditEvent {
  readonly event: AgentAuditEvent["event"];
  readonly correlationId: string;
  readonly surfaceId: string;
  readonly revision: string;
  readonly sequence: number;
  readonly outcome: AgentAuditEvent["outcome"];
  readonly action?: string;
}

const captureAuditEvent = (value: unknown): CapturedAuditEvent => {
  const captured = descriptorSafeCaptureJson(value, {
    maxDepth: 3,
    maxNodes: 20,
    maxCharacters: 40_000,
    maxStringLength: AGENT_RUNTIME_TRACE_LIMITS.inputStringLength,
    maxPropertiesPerObject: 10,
  });
  if (typeof captured !== "object" || captured === null || Array.isArray(captured)) {
    throw new TypeError();
  }
  const source = captured as Record<string, unknown>;
  const allowed = new Set([
    "schemaVersion",
    "event",
    "correlationId",
    "surfaceId",
    "revision",
    "sequence",
    "timestamp",
    "durationMs",
    "outcome",
    "action",
  ]);
  if (Object.keys(source).some((key) => !allowed.has(key))) throw new TypeError();
  for (const key of [
    "schemaVersion",
    "event",
    "correlationId",
    "surfaceId",
    "revision",
    "sequence",
    "timestamp",
    "durationMs",
    "outcome",
  ]) {
    if (!Object.hasOwn(source, key)) throw new TypeError();
  }
  if (source.schemaVersion !== "0.1") throw new TypeError();
  const event = source.event;
  const outcome = source.outcome;
  const correlationId = source.correlationId;
  const surfaceId = source.surfaceId;
  const revision = source.revision;
  const sequence = source.sequence;
  const timestamp = source.timestamp;
  const durationMs = source.durationMs;
  const action = Object.hasOwn(source, "action") ? source.action : undefined;
  if (
    typeof event !== "string" ||
    !EVENT_NAMES.has(event) ||
    typeof outcome !== "string" ||
    !OUTCOMES.has(outcome) ||
    typeof correlationId !== "string" ||
    !IDENTIFIER_PATTERN.test(correlationId) ||
    typeof surfaceId !== "string" ||
    !IDENTIFIER_PATTERN.test(surfaceId) ||
    typeof revision !== "string" ||
    revision.length < 1 ||
    revision.length > AGENT_RUNTIME_TRACE_LIMITS.inputStringLength ||
    !Number.isSafeInteger(sequence) ||
    (sequence as number) < 1 ||
    typeof timestamp !== "string" ||
    timestamp.length > 64 ||
    !Number.isFinite(Date.parse(timestamp)) ||
    typeof durationMs !== "number" ||
    !Number.isFinite(durationMs) ||
    durationMs < 0 ||
    (action !== undefined &&
      (typeof action !== "string" || action.length < 1 || action.length > 64))
  ) throw new TypeError();
  return {
    event: event as AgentAuditEvent["event"],
    correlationId,
    surfaceId,
    revision,
    sequence: sequence as number,
    outcome: outcome as AgentAuditEvent["outcome"],
    ...(action !== undefined ? { action } : {}),
  };
};

const rejected = (reason: AgentTraceRejectionReason): AgentTraceFinishResult =>
  Object.freeze({ status: "rejected", reason });

export const createAgentTraceRecorder = (
  options: AgentTraceRecorderOptions,
): AgentTraceRecorder => {
  const sourceId = captureSourceId(options);
  const unsignedRecords: UnsignedAgentRuntimeTraceRecord[] = [];
  const operationRefs = new Map<string, number>();
  const revisionRefs = new Map<string, string>();
  const actionRefs = new Map<string, string>();
  const order = createRuntimeTraceOrderState();
  let expectedSurface: string | undefined;
  let poison: AgentTraceRejectionReason | undefined;
  let finished = false;
  let projectedBytes = 0;

  const discardTransientIdentifiers = (): void => {
    operationRefs.clear();
    revisionRefs.clear();
    actionRefs.clear();
    expectedSurface = undefined;
  };

  const token = (values: Map<string, string>, raw: string, prefix: string): string => {
    const existing = values.get(raw);
    if (existing) return existing;
    const created = `${prefix}-${values.size + 1}`;
    values.set(raw, created);
    return created;
  };

  const record = (value: AgentAuditEvent): void => {
    if (finished || poison) return;
    try {
      const event = captureAuditEvent(value);
      if (
        [
          event.correlationId,
          event.surfaceId,
          event.revision,
          ...(event.action !== undefined ? [event.action] : []),
        ].some(containsSecretSentinel)
      ) {
        poison = "secret_detected";
        return;
      }
      if (expectedSurface === undefined) expectedSurface = event.surfaceId;
      else if (event.surfaceId !== expectedSurface) {
        poison = "surface_mismatch";
        return;
      }
      let operation = operationRefs.get(event.correlationId);
      if (operation === undefined) {
        if (operationRefs.size >= AGENT_RUNTIME_TRACE_LIMITS.operations) {
          poison = "budget_exceeded";
          return;
        }
        operation = operationRefs.size + 1;
        operationRefs.set(event.correlationId, operation);
      }
      if (unsignedRecords.length >= AGENT_RUNTIME_TRACE_LIMITS.records) {
        poison = "budget_exceeded";
        return;
      }
      const unsigned: UnsignedAgentRuntimeTraceRecord = {
        index: unsignedRecords.length + 1,
        operation,
        sequence: event.sequence,
        event: event.event,
        outcome: event.outcome,
        revisionRef: token(revisionRefs, event.revision, "revision"),
        ...(event.action !== undefined
          ? { actionRef: token(actionRefs, event.action, "action") }
          : {}),
      };
      try {
        acceptRuntimeTraceOrder(unsigned, order);
      } catch {
        poison = "invalid_order";
        return;
      }
      projectedBytes += encoder.encode(JSON.stringify(unsigned)).byteLength + 160;
      if (projectedBytes > AGENT_RUNTIME_TRACE_LIMITS.bytes) {
        poison = "budget_exceeded";
        return;
      }
      unsignedRecords.push(Object.freeze(unsigned));
    } catch {
      poison = "invalid_event";
    }
  };

  const finish = async (): Promise<AgentTraceFinishResult> => {
    if (finished) return rejected("already_finished");
    finished = true;
    const operationCount = operationRefs.size;
    if (poison) {
      discardTransientIdentifiers();
      return rejected(poison);
    }
    try {
      assertRuntimeTraceOrderComplete(order);
    } catch {
      discardTransientIdentifiers();
      return rejected("invalid_order");
    }
    discardTransientIdentifiers();
    try {
      let previousDigest = ZERO_TRACE_DIGEST;
      const records = [];
      for (const unsigned of unsignedRecords) {
        const next = await buildRuntimeTraceRecord(sourceId, previousDigest, unsigned);
        records.push(next);
        previousDigest = next.digest;
      }
      const trace: AgentRuntimeTrace = {
        schemaVersion: AGENT_RUNTIME_TRACE_SCHEMA_VERSION,
        kind: AGENT_RUNTIME_TRACE_KIND,
        sourceId,
        recordCount: records.length,
        operationCount,
        headDigest: previousDigest,
        records,
      };
      if (
        encoder.encode(canonicalRuntimeTraceText(trace)).byteLength >
        AGENT_RUNTIME_TRACE_LIMITS.bytes
      ) return rejected("budget_exceeded");
      const validated = await captureAndValidateAgentRuntimeTrace(trace);
      return deepFreezeJson({ status: "complete", trace: validated });
    } catch {
      return rejected("integrity_failure");
    }
  };

  return Object.freeze({ record, finish });
};
