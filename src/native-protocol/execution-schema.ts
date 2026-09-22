import {
  AGENT_ACTION_FAILURE_SCHEMA,
  AGENT_ACTION_RESULT_SCHEMA,
} from "../schema.js";
import {
  NATIVE_PROTOCOL_LIMITS,
  NATIVE_PROTOCOL_SCHEMA_VERSION,
} from "./schema.js";

const OPAQUE_ID_PATTERN = "^[A-Za-z0-9._~-]{1,128}$";
const OPAQUE_ID = { type: "string", pattern: OPAQUE_ID_PATTERN } as const;
const REVISION = { type: "string", minLength: 1, maxLength: 128 } as const;

export const NATIVE_PROTOCOL_REQUEST_ERROR_MESSAGES = Object.freeze({
  capability_not_negotiated: "Capability was not negotiated for this session",
  internal_error: "Native protocol request failed",
  invalid_message: "Invalid native protocol message",
  invalid_session: "Native protocol session is invalid",
  permission_denied: "Native accessibility permission is unavailable",
  request_cancelled: "Native protocol request was cancelled",
  request_conflict: "Native protocol request conflicts with prior state",
  resource_limit: "Native protocol resource limit exceeded",
  resync_required: "Native protocol state resynchronization is required",
  stale_revision: "Native surface revision is stale",
  surface_unavailable: "Native surface is unavailable",
} as const);

const taggedRequest = <
  const TKind extends string,
  const TProperties extends Record<string, unknown>,
  const TRequired extends readonly string[],
>(kind: TKind, properties: TProperties, required: TRequired) => ({
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "kind", "requestId", "sessionRef", ...required],
  properties: {
    schemaVersion: { const: NATIVE_PROTOCOL_SCHEMA_VERSION },
    kind: { const: kind },
    requestId: OPAQUE_ID,
    sessionRef: OPAQUE_ID,
    ...properties,
  },
} as const);

const ACTION_REQUEST_SCHEMA = taggedRequest(
  "action-request",
  {
    surfaceRef: OPAQUE_ID,
    revision: REVISION,
    elementId: OPAQUE_ID,
    action: OPAQUE_ID,
    input: {},
    idempotencyKey: OPAQUE_ID,
  },
  ["surfaceRef", "revision", "elementId", "action"],
);

const ACTION_RESPONSE_SCHEMA = taggedRequest(
  "action-response",
  {
    surfaceRef: OPAQUE_ID,
    outcome: {
      oneOf: [
        { $ref: AGENT_ACTION_RESULT_SCHEMA.$id },
        { $ref: AGENT_ACTION_FAILURE_SCHEMA.$id },
      ],
    },
  },
  ["surfaceRef", "outcome"],
);

const CANCEL_REQUEST_SCHEMA = taggedRequest(
  "cancel-request",
  { targetRequestId: OPAQUE_ID },
  ["targetRequestId"],
);

const CANCEL_RESPONSE_SCHEMA = taggedRequest(
  "cancel-response",
  {
    targetRequestId: OPAQUE_ID,
    disposition: {
      enum: ["accepted", "already-completed", "not-cancellable"],
    },
  },
  ["targetRequestId", "disposition"],
);

const REQUEST_ERROR_SCHEMA = taggedRequest(
  "request-error",
  {
    code: { enum: Object.keys(NATIVE_PROTOCOL_REQUEST_ERROR_MESSAGES) },
    message: {
      type: "string",
      minLength: 1,
      maxLength: NATIVE_PROTOCOL_LIMITS.errorMessageCharacters,
    },
  },
  ["code", "message"],
);

const event = <
  const TEvent extends string,
  const TProperties extends Record<string, unknown>,
  const TRequired extends readonly string[],
>(name: TEvent, properties: TProperties, required: TRequired) => ({
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "kind", "sessionRef", "sequence", "event", ...required],
  properties: {
    schemaVersion: { const: NATIVE_PROTOCOL_SCHEMA_VERSION },
    kind: { const: "event" },
    sessionRef: OPAQUE_ID,
    sequence: {
      type: "integer",
      minimum: 1,
      maximum: Number.MAX_SAFE_INTEGER,
    },
    event: { const: name },
    ...properties,
  },
} as const);

const EVENT_SCHEMAS = [
  event("catalog-changed", {}, []),
  event("surface-changed", { surfaceRef: OPAQUE_ID, revision: REVISION }, [
    "surfaceRef",
    "revision",
  ]),
  event("surface-closed", { surfaceRef: OPAQUE_ID }, ["surfaceRef"]),
  event("session-invalidated", {}, []),
] as const;

export const NATIVE_PROTOCOL_EXECUTION_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://dual-surface-ui.dev/schema/native/native-protocol-execution-0.1.json",
  title: "Dual Surface UI Native Protocol Execution Messages 0.1",
  oneOf: [
    ACTION_REQUEST_SCHEMA,
    ACTION_RESPONSE_SCHEMA,
    CANCEL_REQUEST_SCHEMA,
    CANCEL_RESPONSE_SCHEMA,
    REQUEST_ERROR_SCHEMA,
    ...EVENT_SCHEMAS,
  ],
} as const;
