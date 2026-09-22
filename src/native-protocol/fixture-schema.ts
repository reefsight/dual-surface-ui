const EXPECTED_SCHEMA = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["status", "kind"],
      properties: {
        status: { const: "accepted" },
        kind: { type: "string", minLength: 1, maxLength: 64 },
        code: { type: "string", minLength: 1, maxLength: 64 },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["status", "error"],
      properties: {
        status: { const: "rejected" },
        error: { const: "Invalid native protocol frame" },
      },
    },
  ],
} as const;

const CASE_BASE = {
  id: { type: "string", pattern: "^[a-z0-9-]{1,96}$" },
  expected: EXPECTED_SCHEMA,
} as const;

export const NATIVE_PROTOCOL_FIXTURE_CORPUS_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://dual-surface-ui.dev/schema/native/native-protocol-fixture-corpus-0.1.json",
  title: "Dual Surface UI Native Protocol Fixture Corpus 0.1",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "kind", "cases"],
  properties: {
    schemaVersion: { const: "0.1" },
    kind: { const: "native-protocol-fixture-corpus" },
    cases: {
      type: "array",
      minItems: 1,
      maxItems: 256,
      items: {
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["id", "encoding", "payload", "expected"],
            properties: {
              ...CASE_BASE,
              encoding: { enum: ["utf8", "hex"] },
              payload: { type: "string", minLength: 1, maxLength: 1_048_576 },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: [
              "id",
              "encoding",
              "prefix",
              "unit",
              "count",
              "suffix",
              "expected",
            ],
            properties: {
              ...CASE_BASE,
              encoding: { const: "repeat-utf8" },
              prefix: { type: "string", maxLength: 8_192 },
              unit: { type: "string", minLength: 1, maxLength: 8 },
              count: { type: "integer", minimum: 1, maximum: 2_097_152 },
              suffix: { type: "string", maxLength: 8_192 },
            },
          },
        ],
      },
    },
  },
} as const;

const SESSION_STATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "phase", "sessionRef", "capabilities", "activeRequests",
    "completedRequests", "surfaces", "lastEventSequence", "catalogStale",
  ],
  properties: {
    phase: { enum: ["awaiting-client-hello", "awaiting-server-hello", "active", "closed"] },
    sessionRef: { type: ["string", "null"] },
    capabilities: { type: "array", uniqueItems: true, items: { type: "string" } },
    activeRequests: { type: "integer", minimum: 0, maximum: 128 },
    completedRequests: { type: "integer", minimum: 0, maximum: 4_096 },
    surfaces: { type: "integer", minimum: 0, maximum: 128 },
    lastEventSequence: { type: "integer", minimum: 0, maximum: 9_007_199_254_740_991 },
    catalogStale: { type: "boolean" },
  },
} as const;

export const NATIVE_PROTOCOL_SESSION_FIXTURE_CORPUS_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://dual-surface-ui.dev/schema/native/native-protocol-session-fixture-corpus-0.1.json",
  title: "Dual Surface UI Native Protocol Session Fixture Corpus 0.1",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "kind", "cases"],
  properties: {
    schemaVersion: { const: "0.1" },
    kind: { const: "native-protocol-session-fixture-corpus" },
    cases: {
      type: "array",
      minItems: 1,
      maxItems: 256,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "messages", "expected"],
        properties: {
          id: { type: "string", pattern: "^[a-z0-9-]{1,96}$" },
          messages: {
            type: "array",
            minItems: 1,
            maxItems: 512,
            items: { type: "object" },
          },
          expected: {
            oneOf: [
              {
                type: "object",
                additionalProperties: false,
                required: ["status", "state"],
                properties: { status: { const: "accepted" }, state: SESSION_STATE_SCHEMA },
              },
              {
                type: "object",
                additionalProperties: false,
                required: ["status", "code", "failedAt", "state"],
                properties: {
                  status: { const: "rejected" },
                  code: { type: "string", minLength: 1, maxLength: 64 },
                  failedAt: { type: "integer", minimum: 0, maximum: 511 },
                  state: SESSION_STATE_SCHEMA,
                },
              },
            ],
          },
        },
      },
    },
  },
} as const;
