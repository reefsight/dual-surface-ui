import { AGENT_SNAPSHOT_SCHEMA } from "../schema.js";

export const AGENT_SNAPSHOT_DELTA_SCHEMA_VERSION = "0.1" as const;
export const AGENT_SNAPSHOT_DELTA_KIND = "agent-snapshot-delta" as const;

export const AGENT_SNAPSHOT_DELTA_LIMITS = Object.freeze({
  snapshotNodes: 4_096,
  deltaOperations: 512,
  actionsPerNode: 64,
  totalActions: 1_024,
  capabilities: 256,
  snapshotBytes: 1_048_576,
  deltaBytes: 1_048_576,
  depth: 64,
  stringLength: 8_192,
  propertiesPerObject: 4_096,
} as const);

const DIGEST_PATTERN = "^sha256:[a-f0-9]{64}$";
const SNAPSHOT_NODE_REF = `${AGENT_SNAPSHOT_SCHEMA.$id}#/$defs/node`;

export const AGENT_SNAPSHOT_DELTA_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://dual-surface-ui.dev/schema/agent-snapshot-delta-0.1.json",
  title: "Dual Surface UI Agent Snapshot Delta",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "kind",
    "surfaceId",
    "baseRevision",
    "revision",
    "baseDigest",
    "targetDigest",
    "target",
    "nodeUpserts",
    "removedNodeIds",
  ],
  properties: {
    schemaVersion: { const: AGENT_SNAPSHOT_DELTA_SCHEMA_VERSION },
    kind: { const: AGENT_SNAPSHOT_DELTA_KIND },
    surfaceId: { type: "string", minLength: 1 },
    baseRevision: { type: "string", minLength: 1 },
    revision: { type: "string", minLength: 1 },
    baseDigest: { type: "string", pattern: DIGEST_PATTERN },
    targetDigest: { type: "string", pattern: DIGEST_PATTERN },
    target: {
      type: "object",
      additionalProperties: false,
      required: [
        "title",
        "url",
        "generatedAt",
        "focusedElementId",
        "capabilities",
      ],
      properties: {
        title: { type: "string" },
        url: { type: "string" },
        generatedAt: { type: "string", format: "date-time" },
        focusedElementId: {
          anyOf: [
            { type: "string", minLength: 1 },
            { type: "null" },
          ],
        },
        capabilities: {
          type: "array",
          maxItems: AGENT_SNAPSHOT_DELTA_LIMITS.capabilities,
          uniqueItems: true,
          items: { type: "string", minLength: 1 },
        },
      },
    },
    nodeUpserts: {
      type: "array",
      maxItems: AGENT_SNAPSHOT_DELTA_LIMITS.deltaOperations,
      items: { $ref: SNAPSHOT_NODE_REF },
    },
    removedNodeIds: {
      type: "array",
      maxItems: AGENT_SNAPSHOT_DELTA_LIMITS.deltaOperations,
      uniqueItems: true,
      items: { type: "string", minLength: 1 },
    },
  },
} as const;
