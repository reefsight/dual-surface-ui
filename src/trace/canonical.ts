import type {
  AgentAuditEventName,
  AgentAuditOutcome,
} from "../audit.js";
import {
  deepFreezeJson,
  descriptorSafeCaptureJson,
} from "../delta/canonical.js";
import { AGENT_RUNTIME_TRACE_LIMITS } from "./schema.js";
import type {
  AgentRuntimeTrace,
  AgentRuntimeTraceDigest,
  AgentRuntimeTraceRecord,
} from "./types.js";
import { containsSecretSentinel } from "../internal/secret-detection.js";

export const ZERO_TRACE_DIGEST =
  `sha256:${"0".repeat(64)}` as AgentRuntimeTraceDigest;

export interface UnsignedAgentRuntimeTraceRecord {
  readonly index: number;
  readonly operation: number;
  readonly sequence: number;
  readonly event: AgentAuditEventName;
  readonly outcome: AgentAuditOutcome;
  readonly revisionRef: string;
  readonly actionRef?: string;
}

const encoder = new TextEncoder();

export class AgentTraceIntegrityError extends TypeError {
  constructor() {
    super("Runtime trace integrity validation failed");
    this.name = "AgentTraceIntegrityError";
  }
}

const invalid = (): never => {
  throw new AgentTraceIntegrityError();
};

export { containsSecretSentinel } from "../internal/secret-detection.js";

const canonicalUnsignedRecordText = (
  record: UnsignedAgentRuntimeTraceRecord,
  previousDigest: AgentRuntimeTraceDigest,
): string =>
  JSON.stringify({
    index: record.index,
    operation: record.operation,
    sequence: record.sequence,
    event: record.event,
    outcome: record.outcome,
    revisionRef: record.revisionRef,
    previousDigest,
    ...(record.actionRef !== undefined ? { actionRef: record.actionRef } : {}),
  });

const sha256 = async (value: string): Promise<AgentRuntimeTraceDigest> => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) invalid();
  try {
    const digest = await subtle.digest("SHA-256", encoder.encode(value));
    const hex = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    return `sha256:${hex}`;
  } catch {
    return invalid();
  }
};

export const digestRuntimeTraceRecord = async (
  sourceId: string,
  previousDigest: AgentRuntimeTraceDigest,
  record: UnsignedAgentRuntimeTraceRecord,
): Promise<AgentRuntimeTraceDigest> =>
  sha256(
    JSON.stringify([
      "dual-surface-ui:runtime-trace-record:0.1",
      sourceId,
      previousDigest,
      canonicalUnsignedRecordText(record, previousDigest),
    ]),
  );

export const buildRuntimeTraceRecord = async (
  sourceId: string,
  previousDigest: AgentRuntimeTraceDigest,
  record: UnsignedAgentRuntimeTraceRecord,
): Promise<AgentRuntimeTraceRecord> => {
  const digest = await digestRuntimeTraceRecord(sourceId, previousDigest, record);
  return deepFreezeJson({
    index: record.index,
    operation: record.operation,
    sequence: record.sequence,
    event: record.event,
    outcome: record.outcome,
    revisionRef: record.revisionRef,
    previousDigest,
    digest,
    ...(record.actionRef !== undefined ? { actionRef: record.actionRef } : {}),
  });
};

export const canonicalRuntimeTraceText = (trace: AgentRuntimeTrace): string => {
  const captured = descriptorSafeCaptureJson(trace, {
    maxDepth: AGENT_RUNTIME_TRACE_LIMITS.inputDepth,
    maxNodes: AGENT_RUNTIME_TRACE_LIMITS.inputNodes,
    maxCharacters: AGENT_RUNTIME_TRACE_LIMITS.bytes,
    maxStringLength: AGENT_RUNTIME_TRACE_LIMITS.inputStringLength,
    maxPropertiesPerObject: AGENT_RUNTIME_TRACE_LIMITS.inputPropertiesPerObject,
  });
  const text = JSON.stringify(captured);
  if (encoder.encode(text).byteLength > AGENT_RUNTIME_TRACE_LIMITS.bytes) invalid();
  return text;
};
