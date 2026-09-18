export const AGENT_CONTRACT_SCHEMA_VERSION = "0.1" as const;

const AGENT_COMMON_DEFS = {
  risk: {
    enum: [
      "read",
      "write",
      "consequential",
      "destructive",
      "credential",
    ],
  },
  state: {
    type: "object",
    additionalProperties: false,
    properties: {
      disabled: { type: "boolean" },
      checked: { type: "boolean" },
      expanded: { type: "boolean" },
      selected: { type: "boolean" },
      value: { type: "string" },
      valuePresent: { type: "boolean" },
      sensitive: { type: "boolean" },
    },
    allOf: [
      {
        if: {
          required: ["sensitive"],
          properties: { sensitive: { const: true } },
        },
        then: {
          not: {
            properties: { value: {} },
            required: ["value"],
          },
        },
      },
    ],
  },
  action: {
    type: "object",
    additionalProperties: false,
    required: ["name", "risk"],
    properties: {
      name: { type: "string", minLength: 1, maxLength: 64 },
      description: { type: "string", maxLength: 500 },
      risk: { $ref: "#/$defs/risk" },
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      preconditions: {
        type: "array",
        items: { type: "string", minLength: 1 },
        uniqueItems: true,
      },
      effects: {
        type: "array",
        items: { type: "string", minLength: 1 },
        uniqueItems: true,
      },
      requiresConfirmation: { type: "boolean" },
      idempotency: { enum: ["none", "keyed", "safe-retry"] },
    },
  },
  bounds: {
    type: "object",
    additionalProperties: false,
    required: ["x", "y", "width", "height"],
    properties: {
      x: { type: "number" },
      y: { type: "number" },
      width: { type: "number", minimum: 0 },
      height: { type: "number", minimum: 0 },
    },
  },
  node: {
    type: "object",
    additionalProperties: false,
    required: ["id", "role", "name", "state", "actions"],
    properties: {
      id: { type: "string", minLength: 1 },
      role: { type: "string", minLength: 1 },
      name: { type: "string" },
      description: { type: "string" },
      state: { $ref: "#/$defs/state" },
      actions: {
        type: "array",
        items: { $ref: "#/$defs/action" },
      },
      bounds: { $ref: "#/$defs/bounds" },
    },
  },
} as const;

export const AGENT_SNAPSHOT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://dual-surface-ui.dev/schema/agent-snapshot-0.1.json",
  title: "Dual Surface UI Agent Snapshot",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "surfaceId",
    "revision",
    "title",
    "url",
    "generatedAt",
    "capabilities",
    "nodes",
  ],
  properties: {
    schemaVersion: { const: AGENT_CONTRACT_SCHEMA_VERSION },
    surfaceId: { type: "string", minLength: 1 },
    revision: { type: "string", minLength: 1 },
    title: { type: "string" },
    url: { type: "string" },
    generatedAt: { type: "string", format: "date-time" },
    focusedElementId: { type: "string", minLength: 1 },
    capabilities: {
      type: "array",
      items: { type: "string", minLength: 1 },
      uniqueItems: true,
    },
    nodes: {
      type: "array",
      items: { $ref: "#/$defs/node" },
    },
  },
  $defs: AGENT_COMMON_DEFS,
} as const;

export const AGENT_ACTION_REQUEST_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://dual-surface-ui.dev/schema/agent-action-request-0.1.json",
  title: "Dual Surface UI Agent Action Request",
  type: "object",
  additionalProperties: false,
  required: ["surfaceId", "revision", "elementId", "action"],
  properties: {
    surfaceId: { type: "string", minLength: 1 },
    revision: { type: "string", minLength: 1 },
    elementId: { type: "string", minLength: 1 },
    action: { type: "string", minLength: 1, maxLength: 64 },
    input: {},
  },
} as const;

export const AGENT_ACTION_RESULT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://dual-surface-ui.dev/schema/agent-action-result-0.1.json",
  title: "Dual Surface UI Agent Action Result",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "surfaceId",
    "previousRevision",
    "revision",
    "status",
    "action",
    "targetId",
    "targetPresent",
  ],
  properties: {
    schemaVersion: { const: AGENT_CONTRACT_SCHEMA_VERSION },
    surfaceId: { type: "string", minLength: 1 },
    previousRevision: { type: "string", minLength: 1 },
    revision: { type: "string", minLength: 1 },
    status: { const: "succeeded" },
    action: { type: "string", minLength: 1, maxLength: 64 },
    targetId: { type: "string", minLength: 1 },
    targetPresent: { type: "boolean" },
    node: { $ref: "#/$defs/node" },
  },
  allOf: [
    {
      if: {
        required: ["targetPresent"],
        properties: { targetPresent: { const: true } },
      },
      then: {
        properties: { node: { $ref: "#/$defs/node" } },
        required: ["node"],
      },
      else: {
        not: {
          properties: { node: {} },
          required: ["node"],
        },
      },
    },
  ],
  $defs: AGENT_COMMON_DEFS,
} as const;
