import type {
  AgentActionRequest,
  AgentJsonValue,
  AgentPolicyOutcome,
  AgentPrincipal,
  AgentSnapshot,
} from "../types.js";
import type {
  AgentAuditEventName,
  AgentAuditOutcome,
} from "../audit.js";
import type { AgentFailureCode } from "../errors.js";

export type AgentReplayDigest = `sha256:${string}`;
export type AgentReplayReference = `${"revision" | "action"}-${number}`;
export type AgentReplayRevisionReference = `revision-${number}`;
export type AgentReplayActionReference = `action-${number}`;

export interface AgentReplayEnvironment {
  readonly origin: string;
  readonly generation: string;
  readonly principal?: AgentPrincipal;
}

export type AgentReplayExecution =
  | {
      readonly kind: "transition";
      readonly nextSnapshot: AgentSnapshot;
      readonly output?: AgentJsonValue;
    }
  | { readonly kind: "throw" };

export interface AgentReplayControls {
  readonly policy: AgentPolicyOutcome;
  readonly confirmation?: boolean;
  readonly preconditions?: Readonly<Record<string, boolean>>;
  readonly effects?: Readonly<Record<string, boolean>>;
  readonly verification?: boolean;
  readonly execution: AgentReplayExecution;
}

export interface AgentReplayExpectedEvent {
  readonly event: AgentAuditEventName;
  readonly outcome: AgentAuditOutcome;
  readonly sequence: number;
  readonly revisionRef: AgentReplayRevisionReference;
  readonly actionRef?: AgentReplayActionReference;
}

export type AgentReplayExpectedOutcome =
  | {
      readonly status: "succeeded";
      readonly revisionRef: AgentReplayRevisionReference;
    }
  | { readonly status: "failed"; readonly code: AgentFailureCode };

export interface AgentReplayStep {
  readonly request: AgentActionRequest;
  readonly controls: AgentReplayControls;
  readonly expected: {
    readonly outcome: AgentReplayExpectedOutcome;
    readonly lifecycle: readonly AgentReplayExpectedEvent[];
  };
}

export interface AgentReplayFixture {
  readonly schemaVersion: "0.1";
  readonly kind: "agent-replay-fixture";
  readonly fixtureId: string;
  readonly surfaceId: string;
  readonly environment: AgentReplayEnvironment;
  readonly initialSnapshot: AgentSnapshot;
  readonly steps: readonly AgentReplayStep[];
  readonly expectedFinalSnapshot: AgentSnapshot;
  readonly fixtureDigest: AgentReplayDigest;
}

export type AgentReplayRejectReason =
  | "invalid_fixture"
  | "fixture_digest_mismatch"
  | "surface_mismatch"
  | "budget_exceeded"
  | "secret_detected";

export type AgentReplayFixtureCaptureResult =
  | { readonly status: "valid"; readonly fixture: AgentReplayFixture }
  | { readonly status: "rejected"; readonly reason: AgentReplayRejectReason };

export type AgentReplayObservedOutcome =
  | {
      readonly operation: number;
      readonly status: "succeeded";
      readonly revisionRef: AgentReplayRevisionReference;
    }
  | {
      readonly operation: number;
      readonly status: "failed";
      readonly code: AgentFailureCode;
    };

export interface AgentReplayNormalizedEvent extends AgentReplayExpectedEvent {
  readonly operation: number;
}

export type AgentReplayDifferencePath =
  | "outcome"
  | "lifecycle"
  | "final_snapshot";

export interface AgentReplayDifference {
  readonly path: AgentReplayDifferencePath;
  readonly operation?: number;
  readonly index?: number;
}

export type AgentReplayResult =
  | {
      readonly status: "matched";
      readonly fixtureId: string;
      readonly outcomes: readonly AgentReplayObservedOutcome[];
      readonly lifecycle: readonly AgentReplayNormalizedEvent[];
      readonly finalSnapshotDigest: AgentReplayDigest;
    }
  | {
      readonly status: "mismatch";
      readonly fixtureId: string;
      readonly differences: readonly AgentReplayDifference[];
    }
  | { readonly status: "rejected"; readonly reason: AgentReplayRejectReason };
