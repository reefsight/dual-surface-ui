import {
  AGENT_ACTION_REQUEST_SCHEMA,
  AGENT_SNAPSHOT_SCHEMA,
} from "../schema.js";
import { AGENT_AUDIT_EVENT_NAMES, AGENT_AUDIT_OUTCOMES } from "../audit.js";
import { AGENT_FAILURE_CODES } from "../errors.js";

export const AGENT_REPLAY_FIXTURE_SCHEMA_VERSION = "0.1" as const;
export const AGENT_REPLAY_FIXTURE_KIND = "agent-replay-fixture" as const;
export const AGENT_REPLAY_LIMITS = Object.freeze({
  steps: 128,
  valueBytes: 32_768,
  fixtureBytes: 2_097_152,
  differences: 256,
} as const);

const snapshotRef = AGENT_SNAPSHOT_SCHEMA.$id;
const requestRef = AGENT_ACTION_REQUEST_SCHEMA.$id;
const digest = { type: "string", pattern: "^sha256:[a-f0-9]{64}$" } as const;
const revisionReference = { type: "string", pattern: "^revision-[1-9][0-9]*$" } as const;
const actionReference = { type: "string", pattern: "^action-[1-9][0-9]*$" } as const;

const expectedEvent = {
  type: "object",
  additionalProperties: false,
  required: ["event", "outcome", "sequence", "revisionRef"],
  properties: {
    event: { enum: AGENT_AUDIT_EVENT_NAMES },
    outcome: { enum: AGENT_AUDIT_OUTCOMES },
    sequence: { type: "integer", minimum: 1 },
    revisionRef: revisionReference,
    actionRef: actionReference,
  },
} as const;

export const AGENT_REPLAY_FIXTURE_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://dual-surface-ui.dev/schema/agent-replay-fixture-0.1.json",
  title: "Dual Surface UI Synthetic Replay Fixture",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "kind",
    "fixtureId",
    "surfaceId",
    "environment",
    "initialSnapshot",
    "steps",
    "expectedFinalSnapshot",
    "fixtureDigest",
  ],
  properties: {
    schemaVersion: { const: AGENT_REPLAY_FIXTURE_SCHEMA_VERSION },
    kind: { const: AGENT_REPLAY_FIXTURE_KIND },
    fixtureId: { type: "string", pattern: "^[A-Za-z0-9._~-]{1,128}$" },
    surfaceId: { type: "string", pattern: "^[A-Za-z0-9._~-]{1,128}$" },
    environment: {
      type: "object",
      additionalProperties: false,
      required: ["origin", "generation"],
      properties: {
        origin: { type: "string", maxLength: 2_048 },
        generation: { type: "string", pattern: "^[A-Za-z0-9._~-]{1,128}$" },
        principal: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: {
            id: { type: "string", pattern: "^[A-Za-z0-9._~-]{1,128}$" },
            roles: {
              type: "array",
              uniqueItems: true,
              maxItems: 64,
              items: { type: "string", pattern: "^[A-Za-z0-9._~-]{1,128}$" },
            },
          },
        },
      },
    },
    initialSnapshot: { $ref: snapshotRef },
    steps: {
      type: "array",
      maxItems: AGENT_REPLAY_LIMITS.steps,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["request", "controls", "expected"],
        properties: {
          request: { $ref: requestRef },
          controls: {
            type: "object",
            additionalProperties: false,
            required: ["policy", "execution"],
            properties: {
              policy: { enum: ["allow", "deny", "require_confirmation"] },
              confirmation: { type: "boolean" },
              preconditions: {
                type: "object",
                additionalProperties: { type: "boolean" },
              },
              effects: {
                type: "object",
                additionalProperties: { type: "boolean" },
              },
              verification: { type: "boolean" },
              execution: {
                oneOf: [
                  {
                    type: "object",
                    additionalProperties: false,
                    required: ["kind", "nextSnapshot"],
                    properties: {
                      kind: { const: "transition" },
                      nextSnapshot: { $ref: snapshotRef },
                      output: {},
                    },
                  },
                  {
                    type: "object",
                    additionalProperties: false,
                    required: ["kind"],
                    properties: { kind: { const: "throw" } },
                  },
                ],
              },
            },
          },
          expected: {
            type: "object",
            additionalProperties: false,
            required: ["outcome", "lifecycle"],
            properties: {
              outcome: {
                oneOf: [
                  {
                    type: "object",
                    additionalProperties: false,
                    required: ["status", "revisionRef"],
                    properties: { status: { const: "succeeded" }, revisionRef: revisionReference },
                  },
                  {
                    type: "object",
                    additionalProperties: false,
                    required: ["status", "code"],
                    properties: { status: { const: "failed" }, code: { enum: AGENT_FAILURE_CODES } },
                  },
                ],
              },
              lifecycle: { type: "array", maxItems: 32, items: expectedEvent },
            },
          },
        },
      },
    },
    expectedFinalSnapshot: { $ref: snapshotRef },
    fixtureDigest: digest,
  },
} as const;
