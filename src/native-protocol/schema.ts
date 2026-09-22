export const NATIVE_PROTOCOL_SCHEMA_VERSION = "0.1" as const;
export const NATIVE_PROTOCOL_VERSION = "0.1" as const;

export const NATIVE_PROTOCOL_CAPABILITIES = Object.freeze([
  "actions",
  "cancellation",
  "deltas",
  "events",
  "snapshots",
  "surface-catalog",
] as const);

export const NATIVE_PROTOCOL_LIMITS = Object.freeze({
  frameBytes: 1_048_576,
  snapshotBytes: 1_048_576,
  deltaBytes: 524_288,
  actionResultBytes: 262_144,
  errorMessageCharacters: 500,
  surfaces: 128,
  actionsPerSurface: 128,
} as const);

const OPAQUE_ID_PATTERN = "^[A-Za-z0-9._~-]{1,128}$";
const CAPABILITY_SCHEMA = {
  type: "string",
  enum: NATIVE_PROTOCOL_CAPABILITIES,
} as const;
const CAPABILITY_LIST_SCHEMA = {
  type: "array",
  maxItems: NATIVE_PROTOCOL_CAPABILITIES.length,
  uniqueItems: true,
  items: CAPABILITY_SCHEMA,
} as const;

const CLIENT_HELLO_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "kind",
    "requestId",
    "supportedVersions",
    "capabilities",
    "requiredCapabilities",
  ],
  properties: {
    schemaVersion: { const: NATIVE_PROTOCOL_SCHEMA_VERSION },
    kind: { const: "client-hello" },
    requestId: { type: "string", pattern: OPAQUE_ID_PATTERN },
    supportedVersions: {
      type: "array",
      minItems: 1,
      maxItems: 16,
      uniqueItems: true,
      items: { type: "string", pattern: "^[0-9]+\\.[0-9]+$", maxLength: 16 },
    },
    capabilities: CAPABILITY_LIST_SCHEMA,
    requiredCapabilities: CAPABILITY_LIST_SCHEMA,
  },
} as const;

const SERVER_HELLO_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "kind",
    "requestId",
    "sessionRef",
    "protocolVersion",
    "capabilities",
    "limits",
  ],
  properties: {
    schemaVersion: { const: NATIVE_PROTOCOL_SCHEMA_VERSION },
    kind: { const: "server-hello" },
    requestId: { type: "string", pattern: OPAQUE_ID_PATTERN },
    sessionRef: { type: "string", pattern: OPAQUE_ID_PATTERN },
    protocolVersion: { const: NATIVE_PROTOCOL_VERSION },
    capabilities: CAPABILITY_LIST_SCHEMA,
    limits: {
      type: "object",
      additionalProperties: false,
      required: [
        "frameBytes",
        "snapshotBytes",
        "deltaBytes",
        "actionResultBytes",
        "errorMessageCharacters",
        "surfaces",
        "actionsPerSurface",
      ],
      properties: Object.fromEntries(
        Object.entries(NATIVE_PROTOCOL_LIMITS).map(([name, value]) => [
          name,
          { const: value },
        ]),
      ),
    },
  },
} as const;

const PROTOCOL_ERROR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "kind", "requestId", "code", "message"],
  properties: {
    schemaVersion: { const: NATIVE_PROTOCOL_SCHEMA_VERSION },
    kind: { const: "protocol-error" },
    requestId: {
      anyOf: [
        { type: "string", pattern: OPAQUE_ID_PATTERN },
        { type: "null" },
      ],
    },
    code: {
      enum: [
        "invalid_message",
        "missing_required_capability",
        "no_compatible_version",
      ],
    },
    message: {
      type: "string",
      minLength: 1,
      maxLength: NATIVE_PROTOCOL_LIMITS.errorMessageCharacters,
    },
  },
} as const;

export const NATIVE_PROTOCOL_HANDSHAKE_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://dual-surface-ui.dev/schema/native/native-protocol-handshake-0.1.json",
  title: "Dual Surface UI Native Protocol Handshake 0.1",
  oneOf: [CLIENT_HELLO_SCHEMA, SERVER_HELLO_SCHEMA, PROTOCOL_ERROR_SCHEMA],
} as const;

export const NATIVE_PROTOCOL_CLIENT_HELLO_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://dual-surface-ui.dev/schema/native/native-protocol-client-hello-0.1.json",
  title: "Dual Surface UI Native Protocol Client Hello 0.1",
  ...CLIENT_HELLO_SCHEMA,
} as const;
