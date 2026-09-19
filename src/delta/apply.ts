import type { AgentElementSnapshot, AgentSnapshot } from "../types.js";
import {
  deepFreezeJson,
  digestCanonicalSnapshot,
} from "./canonical.js";
import type {
  AgentSnapshotDelta,
  AgentSnapshotDeltaApplyResult,
  AgentSnapshotDeltaResyncReason,
} from "./types.js";
import {
  assertDeltaWithinBudget,
  captureAndValidateDelta,
  captureAndValidateSnapshot,
  deltaValidationReason,
  validateDeltaSemantics,
} from "./validation.js";

const resync = (
  reason: AgentSnapshotDeltaResyncReason,
): AgentSnapshotDeltaApplyResult => ({ status: "resync_required", reason });

const reasonFrom = (
  error: unknown,
  fallback: AgentSnapshotDeltaResyncReason,
): AgentSnapshotDeltaResyncReason => deltaValidationReason(error) ?? fallback;

const captureBase = (
  value: unknown,
): AgentSnapshot | AgentSnapshotDeltaApplyResult => {
  try {
    return captureAndValidateSnapshot(value);
  } catch (error) {
    const reason = reasonFrom(error, "invalid_base");
    return resync(reason === "budget_exceeded" ? reason : "invalid_base");
  }
};

const captureDelta = (
  value: unknown,
): AgentSnapshotDelta | AgentSnapshotDeltaApplyResult => {
  try {
    const delta = captureAndValidateDelta(value);
    assertDeltaWithinBudget(delta);
    return delta;
  } catch (error) {
    return resync(reasonFrom(error, "invalid_delta"));
  }
};

const isApplyFailure = (
  value:
    | AgentSnapshot
    | AgentSnapshotDelta
    | AgentSnapshotDeltaApplyResult,
): value is AgentSnapshotDeltaApplyResult => "status" in value;

const reconstruct = (
  base: AgentSnapshot,
  delta: AgentSnapshotDelta,
): AgentSnapshot => {
  const nodes = new Map<string, AgentElementSnapshot>(
    base.nodes.map((node) => [node.id, node]),
  );
  for (const id of delta.removedNodeIds) {
    nodes.delete(id);
  }
  for (const node of delta.nodeUpserts) {
    nodes.set(node.id, node);
  }

  const snapshot: AgentSnapshot = {
    schemaVersion: "0.1",
    surfaceId: delta.surfaceId,
    revision: delta.revision,
    title: delta.target.title,
    url: delta.target.url,
    generatedAt: delta.target.generatedAt,
    capabilities: [...delta.target.capabilities],
    nodes: [...nodes.values()],
  };
  if (delta.target.focusedElementId !== null) {
    snapshot.focusedElementId = delta.target.focusedElementId;
  }
  return snapshot;
};

/**
 * Applies a delta only to the exact canonical base it names. Every failure is
 * normalized to a resynchronization result; no partial reconstruction escapes.
 */
export const applyAgentSnapshotDelta = async (
  baseValue: unknown,
  deltaValue: unknown,
): Promise<AgentSnapshotDeltaApplyResult> => {
  const base = captureBase(baseValue);
  if (isApplyFailure(base)) {
    return base;
  }

  const delta = captureDelta(deltaValue);
  if (isApplyFailure(delta)) {
    return delta;
  }

  if (base.surfaceId !== delta.surfaceId) {
    return resync("surface_mismatch");
  }
  if (base.revision !== delta.baseRevision) {
    return resync("base_revision_mismatch");
  }

  try {
    const baseDigest = await digestCanonicalSnapshot(base);
    if (baseDigest !== delta.baseDigest) {
      return resync("base_digest_mismatch");
    }
    validateDeltaSemantics(delta, base);

    const candidate = reconstruct(base, delta);
    const snapshot = captureAndValidateSnapshot(candidate);
    const targetDigest = await digestCanonicalSnapshot(snapshot);
    if (targetDigest !== delta.targetDigest) {
      return resync("target_digest_mismatch");
    }

    return { status: "applied", snapshot: deepFreezeJson(snapshot) };
  } catch (error) {
    return resync(reasonFrom(error, "invalid_delta"));
  }
};
