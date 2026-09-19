import type { AgentElementSnapshot, AgentSnapshot } from "../types.js";
import {
  deepFreezeJson,
  digestCanonicalSnapshot,
} from "./canonical.js";
import type {
  AgentSnapshotDelta,
  AgentSnapshotDeltaCreateResult,
  AgentSnapshotDeltaResyncReason,
} from "./types.js";
import {
  assertDeltaWithinBudget,
  captureAndValidateDelta,
  captureAndValidateSnapshot,
  deltaValidationReason,
} from "./validation.js";

const nodesById = (
  snapshot: AgentSnapshot,
): ReadonlyMap<string, AgentElementSnapshot> =>
  new Map(snapshot.nodes.map((node) => [node.id, node]));

const sameNode = (
  left: AgentElementSnapshot,
  right: AgentElementSnapshot,
): boolean => JSON.stringify(left) === JSON.stringify(right);

const sameSnapshotExceptGeneratedAt = (
  left: AgentSnapshot,
  right: AgentSnapshot,
): boolean => {
  const { generatedAt: _leftGeneratedAt, ...leftState } = left;
  const { generatedAt: _rightGeneratedAt, ...rightState } = right;
  return JSON.stringify(leftState) === JSON.stringify(rightState);
};

const compareCodeUnits = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const resync = (
  reason: AgentSnapshotDeltaResyncReason,
): AgentSnapshotDeltaCreateResult => ({ status: "resync_required", reason });

const reasonFrom = (
  error: unknown,
  fallback: AgentSnapshotDeltaResyncReason,
): AgentSnapshotDeltaResyncReason => deltaValidationReason(error) ?? fallback;

const captureSnapshot = (
  value: unknown,
  failureReason: "invalid_base" | "invalid_target",
): AgentSnapshot | AgentSnapshotDeltaCreateResult => {
  try {
    return captureAndValidateSnapshot(value);
  } catch (error) {
    const reason = reasonFrom(error, failureReason);
    return resync(
      reason === "invalid_base" ||
        reason === "invalid_target" ||
        reason === "budget_exceeded"
        ? reason
        : failureReason,
    );
  }
};

const isCreateFailure = (
  value: AgentSnapshot | AgentSnapshotDeltaCreateResult,
): value is AgentSnapshotDeltaCreateResult => "status" in value;

/**
 * Creates a complete-metadata, full-node delta bound to the exact canonical
 * base and target snapshots. Inputs are captured before comparison and are
 * never retained in the returned value.
 */
export const createAgentSnapshotDelta = async (
  baseValue: unknown,
  targetValue: unknown,
): Promise<AgentSnapshotDeltaCreateResult> => {
  const base = captureSnapshot(baseValue, "invalid_base");
  if (isCreateFailure(base)) {
    return base;
  }

  const target = captureSnapshot(targetValue, "invalid_target");
  if (isCreateFailure(target)) {
    return target;
  }

  if (base.surfaceId !== target.surfaceId) {
    return resync("surface_mismatch");
  }

  if (base.revision === target.revision) {
    return sameSnapshotExceptGeneratedAt(base, target)
      ? { status: "no_change" }
      : resync("revision_collision");
  }

  const baseNodes = nodesById(base);
  const targetNodes = nodesById(target);
  const removedNodeIds = [...baseNodes.keys()]
    .filter((id) => !targetNodes.has(id))
    .sort(compareCodeUnits);
  const nodeUpserts = [...targetNodes.values()]
    .filter((node) => {
      const previous = baseNodes.get(node.id);
      return previous === undefined || !sameNode(previous, node);
    })
    .sort((left, right) => compareCodeUnits(left.id, right.id));

  try {
    const [baseDigest, targetDigest] = await Promise.all([
      digestCanonicalSnapshot(base),
      digestCanonicalSnapshot(target),
    ]);
    const candidate: AgentSnapshotDelta = {
      schemaVersion: "0.1",
      kind: "agent-snapshot-delta",
      surfaceId: target.surfaceId,
      baseRevision: base.revision,
      revision: target.revision,
      baseDigest,
      targetDigest,
      target: {
        title: target.title,
        url: target.url,
        generatedAt: target.generatedAt,
        focusedElementId: target.focusedElementId ?? null,
        capabilities: [...target.capabilities],
      },
      nodeUpserts,
      removedNodeIds,
    };
    const delta = captureAndValidateDelta(candidate);
    assertDeltaWithinBudget(delta);
    return { status: "delta", delta: deepFreezeJson(delta) };
  } catch (error) {
    return resync(reasonFrom(error, "invalid_delta"));
  }
};
