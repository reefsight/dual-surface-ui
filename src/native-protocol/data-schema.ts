import { AGENT_SNAPSHOT_DELTA_SCHEMA } from "../delta/schema.js";
import { AGENT_SNAPSHOT_SCHEMA } from "../schema.js";
import {
  NATIVE_PROTOCOL_CAPABILITIES,
  NATIVE_PROTOCOL_HANDSHAKE_SCHEMA,
  NATIVE_PROTOCOL_LIMITS,
  NATIVE_PROTOCOL_SCHEMA_VERSION,
} from "./schema.js";

const OPAQUE_ID_PATTERN = "^[A-Za-z0-9._~-]{1,128}$";
const DIGEST_PATTERN = "^sha256:[a-f0-9]{64}$";
const OPAQUE_ID = { type: "string", pattern: OPAQUE_ID_PATTERN } as const;
const REVISION = { type: "string", minLength: 1, maxLength: 128 } as const;
const CAPABILITY_LIST = {
  type: "array",
  maxItems: NATIVE_PROTOCOL_CAPABILITIES.length,
  uniqueItems: true,
  items: { type: "string", enum: NATIVE_PROTOCOL_CAPABILITIES },
} as const;

const taggedObject = <
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

const SURFACE_ENTRY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "surfaceRef",
    "revision",
    "title",
    "application",
    "capabilities",
    "actionCount",
  ],
  properties: {
    surfaceRef: OPAQUE_ID,
    revision: REVISION,
    title: { type: "string", maxLength: 500 },
    application: { type: "string", minLength: 1, maxLength: 128 },
    capabilities: CAPABILITY_LIST,
    actionCount: {
      type: "integer",
      minimum: 0,
      maximum: NATIVE_PROTOCOL_LIMITS.actionsPerSurface,
    },
  },
} as const;

const SURFACE_LIST_REQUEST_SCHEMA = taggedObject(
  "surface-list-request",
  {},
  [],
);
const SURFACE_LIST_RESPONSE_SCHEMA = taggedObject(
  "surface-list-response",
  {
    surfaces: {
      type: "array",
      maxItems: NATIVE_PROTOCOL_LIMITS.surfaces,
      items: SURFACE_ENTRY_SCHEMA,
    },
  },
  ["surfaces"],
);
const SNAPSHOT_REQUEST_SCHEMA = taggedObject(
  "snapshot-request",
  { surfaceRef: OPAQUE_ID },
  ["surfaceRef"],
);
const SNAPSHOT_RESPONSE_SCHEMA = taggedObject(
  "snapshot-response",
  {
    surfaceRef: OPAQUE_ID,
    snapshot: { $ref: AGENT_SNAPSHOT_SCHEMA.$id },
  },
  ["surfaceRef", "snapshot"],
);
const DELTA_REQUEST_SCHEMA = taggedObject(
  "delta-request",
  {
    surfaceRef: OPAQUE_ID,
    baseRevision: REVISION,
    baseDigest: { type: "string", pattern: DIGEST_PATTERN },
  },
  ["surfaceRef", "baseRevision", "baseDigest"],
);
const DELTA_RESPONSE_SCHEMA = taggedObject(
  "delta-response",
  {
    surfaceRef: OPAQUE_ID,
    delta: { $ref: AGENT_SNAPSHOT_DELTA_SCHEMA.$id },
  },
  ["surfaceRef", "delta"],
);

export const NATIVE_PROTOCOL_DATA_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://dual-surface-ui.dev/schema/native/native-protocol-data-0.1.json",
  title: "Dual Surface UI Native Protocol Data Messages 0.1",
  oneOf: [
    SURFACE_LIST_REQUEST_SCHEMA,
    SURFACE_LIST_RESPONSE_SCHEMA,
    SNAPSHOT_REQUEST_SCHEMA,
    SNAPSHOT_RESPONSE_SCHEMA,
    DELTA_REQUEST_SCHEMA,
    DELTA_RESPONSE_SCHEMA,
  ],
} as const;

export const NATIVE_PROTOCOL_MESSAGE_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://dual-surface-ui.dev/schema/native/native-protocol-message-0.1.json",
  title: "Dual Surface UI Native Protocol Messages 0.1",
  oneOf: [
    { $ref: NATIVE_PROTOCOL_HANDSHAKE_SCHEMA.$id },
    { $ref: NATIVE_PROTOCOL_DATA_SCHEMA.$id },
  ],
} as const;
