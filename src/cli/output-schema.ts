import { AGENT_SNAPSHOT_DELTA_SCHEMA } from "../delta/schema.js";
import { AGENT_AUDIT_EVENT_NAMES, AGENT_AUDIT_OUTCOMES } from "../audit.js";
import { AGENT_FAILURE_CODES } from "../errors.js";
import { AGENT_REPLAY_LIMITS } from "../replay/schema.js";
import { AGENT_EVALUATION_RESULT_SCHEMA } from "./evaluation-schema.js";

export const AGENT_CLI_OUTPUT_SCHEMA_VERSION = "0.1" as const;
export const AGENT_CLI_RESULT_KIND = "agent-cli-result" as const;
export const AGENT_CLI_EVENT_KIND = "agent-cli-event" as const;
export const AGENT_CLI_ERROR_KIND = "agent-cli-error" as const;

const digest = { type: "string", pattern: "^sha256:[a-f0-9]{64}$" } as const;
const artifactType = {
  enum: [
    "snapshot",
    "delta",
    "trace",
    "replay-fixture",
    "evaluation-definition",
    "evaluation-result",
  ],
} as const;
const invalidReason = {
  enum: [
    "invalid_artifact",
    "digest_mismatch",
    "budget_exceeded",
    "secret_detected",
  ],
} as const;
const resyncReason = {
  enum: [
    "invalid_base",
    "invalid_target",
    "invalid_delta",
    "surface_mismatch",
    "base_revision_mismatch",
    "base_digest_mismatch",
    "target_digest_mismatch",
    "revision_collision",
    "budget_exceeded",
  ],
} as const;

const strictObject = (
  required: readonly string[],
  properties: Readonly<Record<string, unknown>>,
) => ({ type: "object", additionalProperties: false, required, properties }) as const;

const inspectCounts = {
  snapshot: strictObject(["nodes", "actions", "capabilities"], {
    nodes: { type: "integer", minimum: 0 },
    actions: { type: "integer", minimum: 0 },
    capabilities: { type: "integer", minimum: 0 },
  }),
  delta: strictObject(["nodeUpserts", "removedNodeIds"], {
    nodeUpserts: { type: "integer", minimum: 0 },
    removedNodeIds: { type: "integer", minimum: 0 },
  }),
  trace: strictObject(["records", "operations"], {
    records: { type: "integer", minimum: 0 },
    operations: { type: "integer", minimum: 0 },
  }),
  "replay-fixture": strictObject(["steps"], {
    steps: { type: "integer", minimum: 0 },
  }),
  "evaluation-definition": strictObject(["cases", "dimensions"], {
    cases: { type: "integer", minimum: 0 },
    dimensions: { type: "integer", minimum: 0 },
  }),
  "evaluation-result": strictObject(
    ["cases", "dimensions", "environmentErrors"],
    {
      cases: { type: "integer", minimum: 0 },
      dimensions: { type: "integer", minimum: 0 },
      environmentErrors: { type: "integer", minimum: 0 },
    },
  ),
} as const;

const inspectData = {
  oneOf: Object.entries(inspectCounts).map(([type, counts]) =>
    strictObject(["artifactType", "schemaVersion", "digest", "counts"], {
      artifactType: { const: type },
      schemaVersion: { const: AGENT_CLI_OUTPUT_SCHEMA_VERSION },
      digest,
      counts,
    })
  ),
} as const;

const invalidData = strictObject(["reason"], {
  artifactType,
  reason: invalidReason,
});
const validateInvalidData = strictObject(["valid", "reason"], {
  artifactType,
  valid: { const: false },
  reason: invalidReason,
});

const replayObservedOutcome = {
  oneOf: [
    strictObject(["operation", "status", "revisionRef"], {
      operation: { type: "integer", minimum: 1 },
      status: { const: "succeeded" },
      revisionRef: { type: "string", pattern: "^revision-[1-9][0-9]*$" },
    }),
    strictObject(["operation", "status", "code"], {
      operation: { type: "integer", minimum: 1 },
      status: { const: "failed" },
      code: { enum: AGENT_FAILURE_CODES },
    }),
  ],
} as const;

const replayEvent = strictObject(
  ["event", "outcome", "sequence", "revisionRef", "operation"],
  {
    event: { enum: AGENT_AUDIT_EVENT_NAMES },
    outcome: { enum: AGENT_AUDIT_OUTCOMES },
    sequence: { type: "integer", minimum: 1 },
    revisionRef: { type: "string", pattern: "^revision-[1-9][0-9]*$" },
    actionRef: { type: "string", pattern: "^action-[1-9][0-9]*$" },
    operation: { type: "integer", minimum: 1 },
  },
);

const replayResultData = {
  oneOf: [
    strictObject(
      ["status", "fixtureId", "outcomes", "lifecycle", "finalSnapshotDigest"],
      {
        status: { const: "matched" },
        fixtureId: { type: "string", pattern: "^[A-Za-z0-9._~-]{1,128}$" },
        outcomes: {
          type: "array",
          maxItems: AGENT_REPLAY_LIMITS.steps,
          items: replayObservedOutcome,
        },
        lifecycle: {
          type: "array",
          maxItems: AGENT_REPLAY_LIMITS.steps * 32,
          items: replayEvent,
        },
        finalSnapshotDigest: digest,
      },
    ),
    strictObject(["status", "fixtureId", "differences"], {
      status: { const: "mismatch" },
      fixtureId: { type: "string", pattern: "^[A-Za-z0-9._~-]{1,128}$" },
      differences: {
        type: "array",
        maxItems: AGENT_REPLAY_LIMITS.differences,
        items: strictObject(["path"], {
          path: { enum: ["outcome", "lifecycle", "final_snapshot"] },
          operation: { type: "integer", minimum: 1 },
          index: { type: "integer", minimum: 0 },
        }),
      },
    }),
    strictObject(["status", "reason"], {
      status: { const: "rejected" },
      reason: {
        enum: [
          "invalid_fixture",
          "fixture_digest_mismatch",
          "surface_mismatch",
          "budget_exceeded",
          "secret_detected",
        ],
      },
    }),
  ],
} as const;

const commandResultBranches = [
  { command: "inspect", status: "completed", data: inspectData },
  { command: "inspect", status: "invalid", data: invalidData },
  {
    command: "validate",
    status: "valid",
    data: strictObject(["artifactType", "valid", "digest"], {
      artifactType,
      valid: { const: true },
      digest,
    }),
  },
  { command: "validate", status: "invalid", data: validateInvalidData },
  {
    command: "diff",
    status: "delta",
    data: strictObject(["delta"], {
      delta: { $ref: AGENT_SNAPSHOT_DELTA_SCHEMA.$id },
    }),
  },
  { command: "diff", status: "no_change", data: strictObject([], {}) },
  {
    command: "diff",
    status: "resync_required",
    data: strictObject(["reason"], { reason: resyncReason }),
  },
  {
    command: "record",
    status: "complete",
    data: strictObject(
      [
        "artifactType",
        "digest",
        "recordCount",
        "operationCount",
        "outputWritten",
      ],
      {
        artifactType: { const: "trace" },
        digest,
        recordCount: { type: "integer", minimum: 0 },
        operationCount: { type: "integer", minimum: 0 },
        outputWritten: { const: true },
      },
    ),
  },
  ...(["matched", "mismatch", "rejected"] as const).map((status) => ({
    command: "replay",
    status,
    data: {
      allOf: [
        replayResultData,
        { type: "object", properties: { status: { const: status } } },
      ],
    },
  })),
  ...(["complete", "incomplete"] as const).map((status) => ({
    command: "evaluate",
    status,
    data: strictObject(["result"], {
      result: {
        allOf: [
          { $ref: AGENT_EVALUATION_RESULT_SCHEMA.$id },
          { type: "object", properties: { status: { const: status } } },
        ],
      },
    }),
  })),
  { command: "evaluate", status: "invalid", data: invalidData },
] as const;

const resultBranch = (
  branch: (typeof commandResultBranches)[number],
) => strictObject(["schemaVersion", "kind", "command", "status", "data"], {
  schemaVersion: { const: AGENT_CLI_OUTPUT_SCHEMA_VERSION },
  kind: { const: AGENT_CLI_RESULT_KIND },
  command: { const: branch.command },
  status: { const: branch.status },
  data: branch.data,
});

export const AGENT_CLI_RESULT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://dual-surface-ui.dev/schema/agent-cli-result-0.1.json",
  title: "Dual Surface UI CLI Result",
  oneOf: commandResultBranches.map(resultBranch),
} as const;

const singleResultBranches = commandResultBranches.filter(
  (branch) => branch.command !== "evaluate" || branch.status === "invalid",
);

const evaluationCase = {
  $ref: `${AGENT_EVALUATION_RESULT_SCHEMA.$id}#/properties/cases/items`,
} as const;
const evaluationSummary = strictObject(
  [
    "schemaVersion",
    "kind",
    "suiteId",
    "definitionDigest",
    "driverId",
    "status",
    "caseCount",
    "dimensionCount",
    "dimensions",
    "environmentErrors",
  ],
  {
    schemaVersion: { const: "0.1" },
    kind: { const: "agent-evaluation-result" },
    suiteId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" },
    definitionDigest: digest,
    driverId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" },
    status: { enum: ["complete", "incomplete"] },
    caseCount: AGENT_EVALUATION_RESULT_SCHEMA.properties.caseCount,
    dimensionCount: AGENT_EVALUATION_RESULT_SCHEMA.properties.dimensionCount,
    dimensions: AGENT_EVALUATION_RESULT_SCHEMA.properties.dimensions,
    environmentErrors: { type: "integer", minimum: 0 },
  },
);

export const AGENT_CLI_EVENT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://dual-surface-ui.dev/schema/agent-cli-event-0.1.json",
  title: "Dual Surface UI CLI NDJSON Event",
  oneOf: [
    ...singleResultBranches.map((branch) =>
      strictObject(
        ["schemaVersion", "kind", "command", "sequence", "type", "data"],
        {
          schemaVersion: { const: AGENT_CLI_OUTPUT_SCHEMA_VERSION },
          kind: { const: AGENT_CLI_EVENT_KIND },
          command: { const: branch.command },
          sequence: { const: 0 },
          type: { const: "result" },
          data: strictObject(["status", "data"], {
            status: { const: branch.status },
            data: branch.data,
          }),
        },
      )
    ),
    strictObject(
      ["schemaVersion", "kind", "command", "sequence", "type", "data"],
      {
        schemaVersion: { const: AGENT_CLI_OUTPUT_SCHEMA_VERSION },
        kind: { const: AGENT_CLI_EVENT_KIND },
        command: { const: "evaluate" },
        sequence: { type: "integer", minimum: 0 },
        type: { const: "case" },
        data: evaluationCase,
      },
    ),
    strictObject(
      ["schemaVersion", "kind", "command", "sequence", "type", "data"],
      {
        schemaVersion: { const: AGENT_CLI_OUTPUT_SCHEMA_VERSION },
        kind: { const: AGENT_CLI_EVENT_KIND },
        command: { const: "evaluate" },
        sequence: { type: "integer", minimum: 0 },
        type: { const: "summary" },
        data: evaluationSummary,
      },
    ),
  ],
} as const;

const errorCommands = {
  enum: ["inspect", "validate", "diff", "record", "replay", "evaluate"],
} as const;
const errorPairs = [
  ["usage", "Invalid command line."],
  ["input_io", "Unable to read input."],
  ["output_io", "Unable to write output."],
  ["driver_error", "Trusted driver failed."],
  ["cancelled", "Operation cancelled."],
  ["internal_error", "Internal error."],
] as const;

export const AGENT_CLI_ERROR_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://dual-surface-ui.dev/schema/agent-cli-error-0.1.json",
  title: "Dual Surface UI CLI Error",
  oneOf: errorPairs.map(([code, message]) =>
    strictObject(["schemaVersion", "kind", "code", "message"], {
      schemaVersion: { const: AGENT_CLI_OUTPUT_SCHEMA_VERSION },
      kind: { const: AGENT_CLI_ERROR_KIND },
      command: errorCommands,
      code: { const: code },
      message: { const: message },
    })
  ),
} as const;
