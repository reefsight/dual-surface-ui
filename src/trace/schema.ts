import {
  AGENT_AUDIT_EVENT_NAMES,
  AGENT_AUDIT_OUTCOMES,
} from "../audit.js";

export const AGENT_RUNTIME_TRACE_SCHEMA_VERSION = "0.1" as const;
export const AGENT_RUNTIME_TRACE_KIND = "agent-runtime-trace" as const;

export const AGENT_RUNTIME_TRACE_LIMITS = Object.freeze({
  records: 1_024,
  operations: 256,
  bytes: 1_048_576,
  sourceIdLength: 128,
  inputDepth: 16,
  inputNodes: 16_384,
  inputStringLength: 8_192,
  inputPropertiesPerObject: 32,
} as const);

const DIGEST_PATTERN = "^sha256:[a-f0-9]{64}$";
const SOURCE_PATTERN = "^[A-Za-z0-9._~-]{1,128}$";
const REVISION_REF_PATTERN = "^revision-[1-9][0-9]*$";
const ACTION_REF_PATTERN = "^action-[1-9][0-9]*$";

export const AGENT_RUNTIME_TRACE_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://dual-surface-ui.dev/schema/agent-runtime-trace-0.1.json",
  title: "Dual Surface UI Redacted Runtime Trace",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "kind",
    "sourceId",
    "recordCount",
    "operationCount",
    "headDigest",
    "records",
  ],
  properties: {
    schemaVersion: { const: AGENT_RUNTIME_TRACE_SCHEMA_VERSION },
    kind: { const: AGENT_RUNTIME_TRACE_KIND },
    sourceId: { type: "string", pattern: SOURCE_PATTERN },
    recordCount: {
      type: "integer",
      minimum: 1,
      maximum: AGENT_RUNTIME_TRACE_LIMITS.records,
    },
    operationCount: {
      type: "integer",
      minimum: 1,
      maximum: AGENT_RUNTIME_TRACE_LIMITS.operations,
    },
    headDigest: { type: "string", pattern: DIGEST_PATTERN },
    records: {
      type: "array",
      minItems: 1,
      maxItems: AGENT_RUNTIME_TRACE_LIMITS.records,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "index",
          "operation",
          "sequence",
          "event",
          "outcome",
          "revisionRef",
          "previousDigest",
          "digest",
        ],
        properties: {
          index: { type: "integer", minimum: 1 },
          operation: {
            type: "integer",
            minimum: 1,
            maximum: AGENT_RUNTIME_TRACE_LIMITS.operations,
          },
          sequence: { type: "integer", minimum: 1 },
          event: { enum: AGENT_AUDIT_EVENT_NAMES },
          outcome: { enum: AGENT_AUDIT_OUTCOMES },
          revisionRef: { type: "string", pattern: REVISION_REF_PATTERN },
          previousDigest: { type: "string", pattern: DIGEST_PATTERN },
          digest: { type: "string", pattern: DIGEST_PATTERN },
          actionRef: { type: "string", pattern: ACTION_REF_PATTERN },
        },
      },
    },
  },
} as const;
