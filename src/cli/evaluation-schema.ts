export const AGENT_EVALUATION_SCHEMA_VERSION = "0.1" as const;
export const AGENT_EVALUATION_DEFINITION_KIND =
  "agent-evaluation-definition" as const;
export const AGENT_EVALUATION_RESULT_KIND = "agent-evaluation-result" as const;

export const AGENT_EVALUATION_LIMITS = Object.freeze({
  dimensions: 32,
  cases: 256,
  caseBytes: 32_768,
  artifactBytes: 8_388_608,
  captureDepth: 32,
  captureNodes: 262_144,
  stringLength: 32_768,
  propertiesPerObject: 1_024,
} as const);

const identifier = {
  type: "string",
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
} as const;
const digest = { type: "string", pattern: "^sha256:[a-f0-9]{64}$" } as const;
const jsonValue = { $ref: "#/$defs/jsonValue" } as const;

const jsonDefinitions = {
  jsonValue: {
    oneOf: [
      { type: "null" },
      { type: "boolean" },
      { type: "number" },
      { type: "string", maxLength: AGENT_EVALUATION_LIMITS.stringLength },
      {
        type: "array",
        maxItems: AGENT_EVALUATION_LIMITS.captureNodes,
        items: jsonValue,
      },
      {
        type: "object",
        maxProperties: AGENT_EVALUATION_LIMITS.propertiesPerObject,
        additionalProperties: jsonValue,
      },
    ],
  },
} as const;

export const AGENT_EVALUATION_DEFINITION_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://dual-surface-ui.dev/schema/agent-evaluation-definition-0.1.json",
  $comment:
    "Ordering, expected-dimension parity, budgets, secret scanning, and definitionDigest verification require captureAndValidateAgentEvaluationDefinition.",
  title: "Dual Surface UI Deterministic Evaluation Definition",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "kind",
    "suiteId",
    "dimensions",
    "cases",
    "definitionDigest",
  ],
  properties: {
    schemaVersion: { const: AGENT_EVALUATION_SCHEMA_VERSION },
    kind: { const: AGENT_EVALUATION_DEFINITION_KIND },
    suiteId: identifier,
    dimensions: {
      type: "array",
      minItems: 1,
      maxItems: AGENT_EVALUATION_LIMITS.dimensions,
      uniqueItems: true,
      items: identifier,
    },
    cases: {
      type: "array",
      minItems: 1,
      maxItems: AGENT_EVALUATION_LIMITS.cases,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["caseId", "input", "expected"],
        properties: {
          caseId: identifier,
          input: jsonValue,
          expected: {
            type: "object",
            maxProperties: AGENT_EVALUATION_LIMITS.dimensions,
            additionalProperties: jsonValue,
          },
        },
      },
    },
    definitionDigest: digest,
  },
  $defs: jsonDefinitions,
} as const;

const score = {
  type: "object",
  additionalProperties: false,
  required: ["dimension", "earned", "possible"],
  properties: {
    dimension: identifier,
    earned: { enum: [0, 1] },
    possible: { const: 1 },
  },
} as const;

export const AGENT_EVALUATION_RESULT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://dual-surface-ui.dev/schema/agent-evaluation-result-0.1.json",
  $comment:
    "Ordering, dimension parity, aggregate consistency, budgets, and secret scanning require captureAndValidateAgentEvaluationResult.",
  title: "Dual Surface UI Deterministic Evaluation Result",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "kind",
    "suiteId",
    "definitionDigest",
    "driverId",
    "status",
    "caseCount",
    "dimensionCount",
    "cases",
    "dimensions",
    "environmentErrors",
  ],
  properties: {
    schemaVersion: { const: AGENT_EVALUATION_SCHEMA_VERSION },
    kind: { const: AGENT_EVALUATION_RESULT_KIND },
    suiteId: identifier,
    definitionDigest: digest,
    driverId: identifier,
    status: { enum: ["complete", "incomplete"] },
    caseCount: { type: "integer", minimum: 1, maximum: AGENT_EVALUATION_LIMITS.cases },
    dimensionCount: {
      type: "integer",
      minimum: 1,
      maximum: AGENT_EVALUATION_LIMITS.dimensions,
    },
    cases: {
      type: "array",
      minItems: 1,
      maxItems: AGENT_EVALUATION_LIMITS.cases,
      items: {
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["caseId", "status", "scores"],
            properties: {
              caseId: identifier,
              status: { const: "scored" },
              scores: {
                type: "array",
                minItems: 1,
                maxItems: AGENT_EVALUATION_LIMITS.dimensions,
                items: score,
              },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["caseId", "status", "code"],
            properties: {
              caseId: identifier,
              status: { const: "environment_error" },
              code: { const: "environment_unavailable" },
            },
          },
        ],
      },
    },
    dimensions: {
      type: "array",
      minItems: 1,
      maxItems: AGENT_EVALUATION_LIMITS.dimensions,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["dimension", "earned", "possible", "unscored"],
        properties: {
          dimension: identifier,
          earned: { type: "integer", minimum: 0 },
          possible: { type: "integer", minimum: 0 },
          unscored: { type: "integer", minimum: 0 },
        },
      },
    },
    environmentErrors: { type: "integer", minimum: 0 },
  },
} as const;
