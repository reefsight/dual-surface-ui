import type { AgentSnapshot } from "../types.js";
import {
  DeltaCaptureError,
  descriptorSafeCaptureJson,
  type CanonicalJson,
} from "../delta/canonical.js";
import {
  DeltaValidationError,
  captureAndValidateDelta,
  captureAndValidateSnapshot,
} from "../delta/validation.js";
import type { AgentSnapshotDelta } from "../delta/types.js";
import {
  AgentTraceValidationError,
  captureAndValidateAgentRuntimeTrace,
  type AgentRuntimeTrace,
} from "../trace/index.js";
import {
  captureAgentReplayFixture,
  type AgentReplayFixture,
} from "../replay/index.js";
import {
  containsSecretSentinel,
  isSensitiveKey,
} from "../internal/secret-detection.js";
import {
  AgentEvaluationValidationError,
  captureAndValidateAgentEvaluationDefinition,
  captureAndValidateAgentEvaluationResult,
} from "./evaluation.js";
import type {
  AgentCliDigest,
  AgentEvaluationDefinition,
  AgentEvaluationResult,
} from "./types.js";
import type {
  AgentCliArtifactType,
  AgentCliInspectData,
  AgentCliInvalidReason,
} from "./output.js";
import type { AgentCliArtifactTypeOption } from "./args.js";

const ARTIFACT_DIGEST_DOMAIN = "dual-surface-ui:cli-artifact:0.1\0";
const encoder = new TextEncoder();

export type AgentCliArtifact =
  | { readonly artifactType: "snapshot"; readonly artifact: AgentSnapshot }
  | { readonly artifactType: "delta"; readonly artifact: AgentSnapshotDelta }
  | { readonly artifactType: "trace"; readonly artifact: AgentRuntimeTrace }
  | { readonly artifactType: "replay-fixture"; readonly artifact: AgentReplayFixture }
  | { readonly artifactType: "evaluation-definition"; readonly artifact: AgentEvaluationDefinition }
  | { readonly artifactType: "evaluation-result"; readonly artifact: AgentEvaluationResult };

export class AgentCliArtifactError extends TypeError {
  readonly reason: AgentCliInvalidReason;
  readonly artifactType?: AgentCliArtifactType;

  constructor(
    reason: AgentCliInvalidReason,
    artifactType?: AgentCliArtifactType,
  ) {
    super("CLI artifact validation failed");
    this.name = "AgentCliArtifactError";
    this.reason = reason;
    if (artifactType !== undefined) this.artifactType = artifactType;
  }
}

const fail = (
  reason: AgentCliInvalidReason,
  artifactType?: AgentCliArtifactType,
): never => {
  throw new AgentCliArtifactError(reason, artifactType);
};

const scanSecrets = (
  value: CanonicalJson,
  allowedDigestPaths: ReadonlySet<string>,
  path: readonly string[] = [],
): void => {
  if (typeof value === "string") {
    if (
      allowedDigestPaths.has(path.join(".")) &&
      /^sha256:[a-f0-9]{64}$/.test(value)
    ) return;
    if (containsSecretSentinel(value)) fail("secret_detected");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      scanSecrets(item, allowedDigestPaths, [...path, "*"]);
    }
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (isSensitiveKey(key)) fail("secret_detected");
    scanSecrets(item, allowedDigestPaths, [...path, key]);
  }
};

const captureInput = (value: unknown): CanonicalJson => {
  try {
    const captured = descriptorSafeCaptureJson(value, {
      maxDepth: 64,
      maxNodes: 250_000,
      maxCharacters: 8_388_608,
      maxStringLength: 32_768,
      maxPropertiesPerObject: 4_096,
    });
    return captured;
  } catch (error) {
    if (error instanceof AgentCliArtifactError) throw error;
    if (error instanceof DeltaCaptureError && error.reason === "budget_exceeded") {
      return fail("budget_exceeded");
    }
    return fail("invalid_artifact");
  }
};

const detectedType = (value: CanonicalJson): AgentCliArtifactType | undefined => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const kind = Object.getOwnPropertyDescriptor(value, "kind")?.value;
  if (kind === "agent-snapshot-delta") return "delta";
  if (kind === "agent-runtime-trace") return "trace";
  if (kind === "agent-replay-fixture") return "replay-fixture";
  if (kind === "agent-evaluation-definition") return "evaluation-definition";
  if (kind === "agent-evaluation-result") return "evaluation-result";
  if (kind === undefined) return "snapshot";
  return undefined;
};

const mapValidationError = (
  error: unknown,
  artifactType: AgentCliArtifactType,
): never => {
  if (error instanceof AgentCliArtifactError) throw error;
  if (error instanceof AgentEvaluationValidationError) {
    return fail(error.reason, artifactType);
  }
  if (error instanceof AgentTraceValidationError) {
    return fail("invalid_artifact", artifactType);
  }
  if (error instanceof DeltaCaptureError || error instanceof DeltaValidationError) {
    const reason = error.reason === "budget_exceeded"
      ? "budget_exceeded"
      : error.reason === "base_digest_mismatch" ||
          error.reason === "target_digest_mismatch"
        ? "digest_mismatch"
        : "invalid_artifact";
    return fail(reason, artifactType);
  }
  return fail("invalid_artifact", artifactType);
};

export const captureAndValidateCliArtifact = async (
  value: unknown,
  requestedType: AgentCliArtifactTypeOption = "auto",
): Promise<AgentCliArtifact> => {
  const captured = captureInput(value);
  const inferred = detectedType(captured);
  const artifactType = requestedType === "auto" ? inferred : requestedType;
  if (!artifactType || (inferred && inferred !== artifactType)) {
    return fail("invalid_artifact", inferred);
  }

  try {
    switch (artifactType) {
      case "snapshot":
      {
        const artifact = captureAndValidateSnapshot(captured);
        scanSecrets(artifact as unknown as CanonicalJson, new Set());
        return { artifactType, artifact };
      }
      case "delta": {
        const artifact = captureAndValidateDelta(captured);
        scanSecrets(
          artifact as unknown as CanonicalJson,
          new Set(["baseDigest", "targetDigest"]),
        );
        return { artifactType, artifact };
      }
      case "trace": {
        const artifact = await captureAndValidateAgentRuntimeTrace(captured);
        scanSecrets(
          artifact as unknown as CanonicalJson,
          new Set([
            "headDigest",
            "records.*.previousDigest",
            "records.*.digest",
          ]),
        );
        return { artifactType, artifact };
      }
      case "replay-fixture": {
        const result = await captureAgentReplayFixture(captured);
        if (result.status === "rejected") {
          const reason = result.reason === "secret_detected"
            ? "secret_detected"
            : result.reason === "budget_exceeded"
              ? "budget_exceeded"
              : result.reason === "fixture_digest_mismatch"
                ? "digest_mismatch"
                : "invalid_artifact";
          return fail(reason, artifactType);
        }
        scanSecrets(
          result.fixture as unknown as CanonicalJson,
          new Set(["fixtureDigest"]),
        );
        return { artifactType, artifact: result.fixture };
      }
      case "evaluation-definition": {
        const artifact = await captureAndValidateAgentEvaluationDefinition(captured);
        scanSecrets(
          artifact as unknown as CanonicalJson,
          new Set(["definitionDigest"]),
        );
        return { artifactType, artifact };
      }
      case "evaluation-result": {
        const artifact = captureAndValidateAgentEvaluationResult(captured);
        scanSecrets(
          artifact as unknown as CanonicalJson,
          new Set(["definitionDigest"]),
        );
        return { artifactType, artifact };
      }
    }
  } catch (error) {
    return mapValidationError(error, artifactType);
  }
};

export const digestCliArtifact = async (
  artifact: AgentCliArtifact["artifact"],
): Promise<AgentCliDigest> => {
  try {
    const canonical = descriptorSafeCaptureJson(artifact, {
      maxDepth: 64,
      maxNodes: 250_000,
      maxCharacters: 8_388_608,
      maxStringLength: 32_768,
      maxPropertiesPerObject: 4_096,
    });
    const digest = await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(`${ARTIFACT_DIGEST_DOMAIN}${JSON.stringify(canonical)}`),
    );
    const hex = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    return `sha256:${hex}`;
  } catch {
    return fail("invalid_artifact");
  }
};

export const inspectCliArtifact = async (
  value: unknown,
  requestedType: AgentCliArtifactTypeOption = "auto",
): Promise<AgentCliInspectData> => {
  const captured = await captureAndValidateCliArtifact(value, requestedType);
  const digest = await digestCliArtifact(captured.artifact);
  switch (captured.artifactType) {
    case "snapshot":
      return {
        artifactType: "snapshot",
        schemaVersion: "0.1",
        digest,
        counts: {
          nodes: captured.artifact.nodes.length,
          actions: captured.artifact.nodes.reduce(
            (count, node) => count + node.actions.length,
            0,
          ),
          capabilities: captured.artifact.capabilities.length,
        },
      };
    case "delta":
      return {
        artifactType: "delta",
        schemaVersion: "0.1",
        digest,
        counts: {
          nodeUpserts: captured.artifact.nodeUpserts.length,
          removedNodeIds: captured.artifact.removedNodeIds.length,
        },
      };
    case "trace":
      return {
        artifactType: "trace",
        schemaVersion: "0.1",
        digest,
        counts: {
          records: captured.artifact.recordCount,
          operations: captured.artifact.operationCount,
        },
      };
    case "replay-fixture":
      return {
        artifactType: "replay-fixture",
        schemaVersion: "0.1",
        digest,
        counts: { steps: captured.artifact.steps.length },
      };
    case "evaluation-definition":
      return {
        artifactType: "evaluation-definition",
        schemaVersion: "0.1",
        digest,
        counts: {
          cases: captured.artifact.cases.length,
          dimensions: captured.artifact.dimensions.length,
        },
      };
    case "evaluation-result":
      return {
        artifactType: "evaluation-result",
        schemaVersion: "0.1",
        digest,
        counts: {
          cases: captured.artifact.caseCount,
          dimensions: captured.artifact.dimensionCount,
          environmentErrors: captured.artifact.environmentErrors,
        },
      };
  }
};
