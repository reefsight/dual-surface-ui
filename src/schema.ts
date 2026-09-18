export const AGENT_CONTRACT_SCHEMA_VERSION = "0.1" as const;

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
  $defs: {
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
  },
} as const;
