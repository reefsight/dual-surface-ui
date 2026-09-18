import {
  AGENT_FAILURE_CODES,
  AGENT_FAILURE_MESSAGES,
} from "./errors.js";
import {
  AGENT_AUDIT_EVENT_NAMES,
  AGENT_AUDIT_OUTCOMES,
} from "./audit.js";

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
    idempotencyKey: {
      type: "string",
      pattern: "^[A-Za-z0-9._~-]{1,128}$",
    },
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
    output: {},
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

export const AGENT_ACTION_FAILURE_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://dual-surface-ui.dev/schema/agent-action-failure-0.1.json",
  title: "Dual Surface UI Agent Action Failure",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "surfaceId", "revision", "status", "error"],
  properties: {
    schemaVersion: { const: AGENT_CONTRACT_SCHEMA_VERSION },
    surfaceId: { type: "string", minLength: 1 },
    revision: { type: "string", minLength: 1 },
    status: { const: "failed" },
    error: {
      oneOf: AGENT_FAILURE_CODES.map((code) => ({
        type: "object",
        additionalProperties: false,
        required: ["code", "message"],
        properties: {
          code: { const: code },
          message: { const: AGENT_FAILURE_MESSAGES[code] },
        },
      })),
    },
  },
} as const;

export const AGENT_AUDIT_EVENT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://dual-surface-ui.dev/schema/agent-audit-event-0.1.json",
  title: "Dual Surface UI Agent Audit Event",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "event",
    "correlationId",
    "surfaceId",
    "revision",
    "sequence",
    "timestamp",
    "durationMs",
    "outcome",
  ],
  properties: {
    schemaVersion: { const: AGENT_CONTRACT_SCHEMA_VERSION },
    event: { enum: AGENT_AUDIT_EVENT_NAMES },
    correlationId: {
      type: "string",
      pattern: "^[A-Za-z0-9._~-]{1,128}$",
    },
    surfaceId: {
      type: "string",
      pattern: "^[A-Za-z0-9._~-]{1,128}$",
    },
    revision: { type: "string", minLength: 1 },
    sequence: { type: "integer", minimum: 1 },
    timestamp: { type: "string", format: "date-time" },
    durationMs: { type: "number", minimum: 0 },
    outcome: { enum: AGENT_AUDIT_OUTCOMES },
    action: { type: "string", minLength: 1, maxLength: 64 },
  },
  allOf: [
    {
      if: { properties: { event: { const: "surface_observed" } } },
      then: {
        properties: { outcome: { const: "observed" } },
        not: { properties: { action: {} }, required: ["action"] },
      },
    },
    {
      if: { properties: { event: { const: "action_requested" } } },
      then: {
        properties: { outcome: { const: "requested" } },
        required: ["action"],
      },
    },
    {
      if: { properties: { event: { const: "policy_decided" } } },
      then: {
        properties: {
          outcome: { enum: ["allow", "deny", "require_confirmation"] },
        },
        required: ["action"],
      },
    },
    {
      if: { properties: { event: { const: "confirmation_requested" } } },
      then: {
        properties: { outcome: { const: "requested" } },
        required: ["action"],
      },
    },
    {
      if: { properties: { event: { const: "action_started" } } },
      then: {
        properties: { outcome: { const: "started" } },
        required: ["action"],
      },
    },
    {
      if: { properties: { event: { const: "action_verified" } } },
      then: {
        properties: { outcome: { enum: ["succeeded", "replayed"] } },
        required: ["action"],
      },
    },
    {
      if: { properties: { event: { const: "action_failed" } } },
      then: { properties: { outcome: { enum: AGENT_FAILURE_CODES } } },
    },
  ],
} as const;
