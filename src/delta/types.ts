import type { AgentElementSnapshot, AgentSnapshot } from "../types.js";

export type AgentSnapshotDeltaDigest = `sha256:${string}`;

export interface AgentSnapshotDeltaTarget {
  readonly title: string;
  readonly url: string;
  readonly generatedAt: string;
  readonly focusedElementId: string | null;
  readonly capabilities: readonly string[];
}

export interface AgentSnapshotDelta {
  readonly schemaVersion: "0.1";
  readonly kind: "agent-snapshot-delta";
  readonly surfaceId: string;
  readonly baseRevision: string;
  readonly revision: string;
  readonly baseDigest: AgentSnapshotDeltaDigest;
  readonly targetDigest: AgentSnapshotDeltaDigest;
  readonly target: AgentSnapshotDeltaTarget;
  readonly nodeUpserts: readonly AgentElementSnapshot[];
  readonly removedNodeIds: readonly string[];
}

export type AgentSnapshotDeltaResyncReason =
  | "invalid_base"
  | "invalid_target"
  | "invalid_delta"
  | "surface_mismatch"
  | "base_revision_mismatch"
  | "base_digest_mismatch"
  | "target_digest_mismatch"
  | "revision_collision"
  | "budget_exceeded";

export type AgentSnapshotDeltaCreateResult =
  | { readonly status: "delta"; readonly delta: AgentSnapshotDelta }
  | { readonly status: "no_change" }
  | {
    readonly status: "resync_required";
    readonly reason: AgentSnapshotDeltaResyncReason;
  };

export type AgentSnapshotDeltaApplyResult =
  | { readonly status: "applied"; readonly snapshot: AgentSnapshot }
  | {
    readonly status: "resync_required";
    readonly reason: AgentSnapshotDeltaResyncReason;
  };
