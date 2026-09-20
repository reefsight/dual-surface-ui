import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsModule, { type FormatsPlugin } from "ajv-formats";

import { AGENT_SNAPSHOT_SCHEMA } from "../schema.js";
import { AGENT_SNAPSHOT_DELTA_SCHEMA } from "../delta/schema.js";
import type { AgentReplayResult } from "../replay/index.js";
import type {
  AgentSnapshotDelta,
  AgentSnapshotDeltaResyncReason,
} from "../delta/index.js";
import {
  descriptorSafeCaptureJson,
  type CanonicalJson,
} from "../delta/canonical.js";
import {
  containsSecretSentinel,
  isSensitiveKey,
} from "../internal/secret-detection.js";
import type {
  AgentCliDigest,
  AgentCliJson,
  AgentEvaluationResult,
} from "./types.js";
import { AGENT_EVALUATION_RESULT_SCHEMA } from "./evaluation-schema.js";
import { captureAndValidateAgentEvaluationResult } from "./evaluation.js";
import {
  AGENT_CLI_ERROR_SCHEMA,
  AGENT_CLI_EVENT_SCHEMA,
  AGENT_CLI_RESULT_SCHEMA,
} from "./output-schema.js";

const addFormats = addFormatsModule as unknown as FormatsPlugin;
const outputAjv = new Ajv2020({ allErrors: true, strict: true });
addFormats(outputAjv);
outputAjv.addSchema(AGENT_SNAPSHOT_SCHEMA);
outputAjv.addSchema(AGENT_SNAPSHOT_DELTA_SCHEMA);
outputAjv.addSchema(AGENT_EVALUATION_RESULT_SCHEMA);
const validateResult = outputAjv.compile(
  AGENT_CLI_RESULT_SCHEMA,
) as ValidateFunction<AgentCliResultEnvelope>;
const validateEvent = outputAjv.compile(
  AGENT_CLI_EVENT_SCHEMA,
) as ValidateFunction<AgentCliEvent>;
const validateError = outputAjv.compile(
  AGENT_CLI_ERROR_SCHEMA,
) as ValidateFunction<AgentCliError>;

export type AgentCliArtifactType =
  | "snapshot"
  | "delta"
  | "trace"
  | "replay-fixture"
  | "evaluation-definition"
  | "evaluation-result";

export type AgentCliInvalidReason =
  | "invalid_artifact"
  | "digest_mismatch"
  | "budget_exceeded"
  | "secret_detected";

export type AgentCliInspectData =
  | {
      readonly artifactType: "snapshot";
      readonly schemaVersion: "0.1";
      readonly digest: AgentCliDigest;
      readonly counts: {
        readonly nodes: number;
        readonly actions: number;
        readonly capabilities: number;
      };
    }
  | {
      readonly artifactType: "delta";
      readonly schemaVersion: "0.1";
      readonly digest: AgentCliDigest;
      readonly counts: {
        readonly nodeUpserts: number;
        readonly removedNodeIds: number;
      };
    }
  | {
      readonly artifactType: "trace";
      readonly schemaVersion: "0.1";
      readonly digest: AgentCliDigest;
      readonly counts: {
        readonly records: number;
        readonly operations: number;
      };
    }
  | {
      readonly artifactType: "replay-fixture";
      readonly schemaVersion: "0.1";
      readonly digest: AgentCliDigest;
      readonly counts: { readonly steps: number };
    }
  | {
      readonly artifactType: "evaluation-definition";
      readonly schemaVersion: "0.1";
      readonly digest: AgentCliDigest;
      readonly counts: {
        readonly cases: number;
        readonly dimensions: number;
      };
    }
  | {
      readonly artifactType: "evaluation-result";
      readonly schemaVersion: "0.1";
      readonly digest: AgentCliDigest;
      readonly counts: {
        readonly cases: number;
        readonly dimensions: number;
        readonly environmentErrors: number;
      };
    };

export type AgentCliCommandResult =
  | {
      readonly command: "inspect";
      readonly status: "completed";
      readonly data: AgentCliInspectData;
    }
  | {
      readonly command: "inspect";
      readonly status: "invalid";
      readonly data: {
        readonly artifactType?: AgentCliArtifactType;
        readonly reason: AgentCliInvalidReason;
      };
    }
  | {
      readonly command: "validate";
      readonly status: "valid";
      readonly data: {
        readonly artifactType: AgentCliArtifactType;
        readonly valid: true;
        readonly digest: AgentCliDigest;
      };
    }
  | {
      readonly command: "validate";
      readonly status: "invalid";
      readonly data: {
        readonly artifactType?: AgentCliArtifactType;
        readonly valid: false;
        readonly reason: AgentCliInvalidReason;
      };
    }
  | {
      readonly command: "diff";
      readonly status: "delta";
      readonly data: { readonly delta: AgentSnapshotDelta };
    }
  | {
      readonly command: "diff";
      readonly status: "no_change";
      readonly data: Readonly<Record<string, never>>;
    }
  | {
      readonly command: "diff";
      readonly status: "resync_required";
      readonly data: { readonly reason: AgentSnapshotDeltaResyncReason };
    }
  | {
      readonly command: "record";
      readonly status: "complete";
      readonly data: {
        readonly artifactType: "trace";
        readonly digest: AgentCliDigest;
        readonly recordCount: number;
        readonly operationCount: number;
        readonly outputWritten: true;
      };
    }
  | {
      readonly command: "replay";
      readonly status: "matched";
      readonly data: Extract<AgentReplayResult, { status: "matched" }>;
    }
  | {
      readonly command: "replay";
      readonly status: "mismatch";
      readonly data: Extract<AgentReplayResult, { status: "mismatch" }>;
    }
  | {
      readonly command: "replay";
      readonly status: "rejected";
      readonly data: Extract<AgentReplayResult, { status: "rejected" }>;
    }
  | {
      readonly command: "evaluate";
      readonly status: "complete" | "incomplete";
      readonly data: { readonly result: AgentEvaluationResult };
    }
  | {
      readonly command: "evaluate";
      readonly status: "invalid";
      readonly data: {
        readonly artifactType?: AgentCliArtifactType;
        readonly reason: AgentCliInvalidReason;
      };
    };

export type AgentCliResultEnvelope = AgentCliCommandResult & {
  readonly schemaVersion: "0.1";
  readonly kind: "agent-cli-result";
};

export type AgentCliNonEvaluationResult = Exclude<
  AgentCliCommandResult,
  { command: "evaluate" }
>;

export type AgentCliSingleResult = Exclude<
  AgentCliCommandResult,
  { command: "evaluate"; status: "complete" | "incomplete" }
>;

export type AgentCliResultEvent<
  Result extends AgentCliSingleResult = AgentCliSingleResult,
> = Result extends AgentCliSingleResult
  ? {
      readonly schemaVersion: "0.1";
      readonly kind: "agent-cli-event";
      readonly command: Result["command"];
      readonly sequence: 0;
      readonly type: "result";
      readonly data: {
        readonly status: Result["status"];
        readonly data: Result["data"];
      };
    }
  : never;

export type AgentCliEvent =
  | AgentCliResultEvent<AgentCliSingleResult>
  | {
      readonly schemaVersion: "0.1";
      readonly kind: "agent-cli-event";
      readonly command: "evaluate";
      readonly sequence: number;
      readonly type: "case";
      readonly data: AgentEvaluationResult["cases"][number];
    }
  | {
      readonly schemaVersion: "0.1";
      readonly kind: "agent-cli-event";
      readonly command: "evaluate";
      readonly sequence: number;
      readonly type: "summary";
      readonly data: Omit<AgentEvaluationResult, "cases">;
    };

export const AGENT_CLI_ERROR_MESSAGES = Object.freeze({
  usage: "Invalid command line.",
  input_io: "Unable to read input.",
  output_io: "Unable to write output.",
  driver_error: "Trusted driver failed.",
  cancelled: "Operation cancelled.",
  internal_error: "Internal error.",
} as const);

export type AgentCliErrorCode = keyof typeof AGENT_CLI_ERROR_MESSAGES;
export type AgentCliError = {
  readonly [Code in AgentCliErrorCode]: {
    readonly schemaVersion: "0.1";
    readonly kind: "agent-cli-error";
    readonly command?: AgentCliCommandResult["command"];
    readonly code: Code;
    readonly message: (typeof AGENT_CLI_ERROR_MESSAGES)[Code];
  };
}[AgentCliErrorCode];

export type AgentCliSerializableOutput =
  | AgentCliResultEnvelope
  | AgentCliEvent
  | AgentCliError;

const VALIDATED_DIGEST_PATHS = new Set([
  "data.digest",
  "data.delta.baseDigest",
  "data.delta.targetDigest",
  "data.finalSnapshotDigest",
  "data.result.definitionDigest",
  "data.data.digest",
  "data.data.delta.baseDigest",
  "data.data.delta.targetDigest",
  "data.data.finalSnapshotDigest",
  "data.definitionDigest",
]);
const VALIDATED_SECRET_REASON_PATHS = new Set([
  "data.reason",
  "data.data.reason",
]);

const scanSecrets = (value: CanonicalJson, path: readonly string[] = []): void => {
  if (typeof value === "string") {
    // A schema-validated digest is machine evidence, not a payment number.
    // Exempting only a complete digest in a known digest field avoids Luhn
    // matches while retaining the shared detector for untrusted payload text.
    if (
      VALIDATED_DIGEST_PATHS.has(path.join(".")) &&
      /^sha256:[a-f0-9]{64}$/.test(value)
    ) return;
    // The schema-validated fixed reason is a classification label, not secret
    // material. Only its two exact result/event locations are exempted.
    if (
      value === "secret_detected" &&
      VALIDATED_SECRET_REASON_PATHS.has(path.join("."))
    ) return;
    if (containsSecretSentinel(value)) throw new TypeError("Invalid CLI output");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) scanSecrets(item, [...path, "*"]);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, item] of Object.entries(value)) {
    if (isSensitiveKey(key)) throw new TypeError("Invalid CLI output");
    scanSecrets(item, [...path, key]);
  }
};

const validateCapturedOutput = (value: CanonicalJson): void => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Invalid CLI output");
  }
  const kind = (value as Readonly<Record<string, CanonicalJson>>).kind;
  const valid = kind === "agent-cli-result"
    ? validateResult(value)
    : kind === "agent-cli-event"
      ? validateEvent(value)
      : kind === "agent-cli-error"
        ? validateError(value)
        : false;
  if (!valid) throw new TypeError("Invalid CLI output");
  if (
    kind === "agent-cli-result" &&
    (value as Readonly<Record<string, CanonicalJson>>).command === "evaluate" &&
    (value as Readonly<Record<string, CanonicalJson>>).status !== "invalid"
  ) {
    const data = (value as Readonly<Record<string, CanonicalJson>>).data;
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      throw new TypeError("Invalid CLI output");
    }
    captureAndValidateAgentEvaluationResult(
      (data as Readonly<Record<string, CanonicalJson>>).result,
    );
  }
  if (
    kind === "agent-cli-event" &&
    (value as Readonly<Record<string, CanonicalJson>>).command === "evaluate" &&
    (value as Readonly<Record<string, CanonicalJson>>).type === "case"
  ) {
    const data = (value as Readonly<Record<string, CanonicalJson>>).data as
      Readonly<Record<string, CanonicalJson>>;
    if (data.status === "scored") {
      const scores = data.scores as readonly Readonly<Record<
        string,
        CanonicalJson
      >>[];
      let previous = "";
      if (scores.some((score) => {
        const dimension = score.dimension as string;
        const invalid = dimension <= previous;
        previous = dimension;
        return invalid;
      })) throw new TypeError("Invalid CLI output");
    }
  }
  if (
    kind === "agent-cli-event" &&
    (value as Readonly<Record<string, CanonicalJson>>).command === "evaluate" &&
    (value as Readonly<Record<string, CanonicalJson>>).type === "summary"
  ) {
    const data = (value as Readonly<Record<string, CanonicalJson>>).data as
      Readonly<Record<string, CanonicalJson>>;
    const caseCount = data.caseCount as number;
    const dimensionCount = data.dimensionCount as number;
    const environmentErrors = data.environmentErrors as number;
    const status = data.status;
    const dimensions = data.dimensions as readonly Readonly<Record<
      string,
      CanonicalJson
    >>[];
    const possible = caseCount - environmentErrors;
    let previous = "";
    if (
      dimensions.length !== dimensionCount ||
      environmentErrors > caseCount ||
      status !== (environmentErrors === 0 ? "complete" : "incomplete") ||
      dimensions.some((dimension) => {
        const name = dimension.dimension as string;
        const invalid =
          name <= previous ||
          dimension.possible !== possible ||
          dimension.unscored !== environmentErrors ||
          (dimension.earned as number) > possible;
        previous = name;
        return invalid;
      })
    ) throw new TypeError("Invalid CLI output");
  }
};

/** Returns exactly one canonical JSON value followed by one LF. */
export const serializeAgentCliOutput = (
  value: AgentCliSerializableOutput,
): string => {
  let captured: CanonicalJson;
  try {
    captured = descriptorSafeCaptureJson(value, {
      maxDepth: 64,
      maxNodes: 500_000,
      maxCharacters: 16_777_216,
      maxStringLength: 8_388_608,
      maxPropertiesPerObject: 4_096,
    });
    validateCapturedOutput(captured);
    scanSecrets(captured);
  } catch {
    throw new TypeError("Invalid CLI output");
  }
  return `${JSON.stringify(captured)}\n`;
};

export const createAgentCliError = <Code extends AgentCliErrorCode>(
  code: Code,
  command?: AgentCliCommandResult["command"],
): AgentCliError => Object.freeze({
  schemaVersion: "0.1",
  kind: "agent-cli-error",
  ...(command === undefined ? {} : { command }),
  code,
  message: AGENT_CLI_ERROR_MESSAGES[code],
}) as AgentCliError;

// This assertion keeps AgentCliJson tied to the serializer's accepted JSON
// domain without exporting a second, subtly different recursive JSON type.
const _agentCliJsonCompatibility: AgentCliJson = null;
void _agentCliJsonCompatibility;
