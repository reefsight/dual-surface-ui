import type { AgentSnapshotDelta, AgentSnapshotDeltaDigest } from "../delta/types.js";
import type {
  AgentActionOutcome,
  AgentJsonValue,
  AgentSnapshot,
} from "../types.js";

export type NativeProtocolVersion = "0.1";

export type NativeProtocolCapability =
  | "actions"
  | "cancellation"
  | "deltas"
  | "events"
  | "snapshots"
  | "surface-catalog";

export interface NativeProtocolClientHello {
  readonly schemaVersion: "0.1";
  readonly kind: "client-hello";
  readonly requestId: string;
  readonly supportedVersions: readonly NativeProtocolVersion[];
  readonly capabilities: readonly NativeProtocolCapability[];
  readonly requiredCapabilities: readonly NativeProtocolCapability[];
}

export interface NativeProtocolLimits {
  readonly frameBytes: number;
  readonly snapshotBytes: number;
  readonly deltaBytes: number;
  readonly actionResultBytes: number;
  readonly errorMessageCharacters: number;
  readonly surfaces: number;
  readonly actionsPerSurface: number;
}

export interface NativeProtocolServerHello {
  readonly schemaVersion: "0.1";
  readonly kind: "server-hello";
  readonly requestId: string;
  readonly sessionRef: string;
  readonly protocolVersion: NativeProtocolVersion;
  readonly capabilities: readonly NativeProtocolCapability[];
  readonly limits: NativeProtocolLimits;
}

export type NativeProtocolErrorCode =
  | "invalid_message"
  | "missing_required_capability"
  | "no_compatible_version";

export interface NativeProtocolError {
  readonly schemaVersion: "0.1";
  readonly kind: "protocol-error";
  readonly requestId: string | null;
  readonly code: NativeProtocolErrorCode;
  readonly message: string;
}

export type NativeProtocolHandshakeMessage =
  | NativeProtocolClientHello
  | NativeProtocolServerHello
  | NativeProtocolError;

export interface NativeProtocolSurfaceEntry {
  readonly surfaceRef: string;
  readonly revision: string;
  readonly title: string;
  readonly application: string;
  readonly capabilities: readonly NativeProtocolCapability[];
  readonly actionCount: number;
}

export interface NativeProtocolSurfaceListRequest {
  readonly schemaVersion: "0.1";
  readonly kind: "surface-list-request";
  readonly requestId: string;
  readonly sessionRef: string;
}

export interface NativeProtocolSurfaceListResponse {
  readonly schemaVersion: "0.1";
  readonly kind: "surface-list-response";
  readonly requestId: string;
  readonly sessionRef: string;
  readonly surfaces: readonly NativeProtocolSurfaceEntry[];
}

export interface NativeProtocolSnapshotRequest {
  readonly schemaVersion: "0.1";
  readonly kind: "snapshot-request";
  readonly requestId: string;
  readonly sessionRef: string;
  readonly surfaceRef: string;
}

export interface NativeProtocolSnapshotResponse {
  readonly schemaVersion: "0.1";
  readonly kind: "snapshot-response";
  readonly requestId: string;
  readonly sessionRef: string;
  readonly surfaceRef: string;
  readonly snapshot: AgentSnapshot;
}

export interface NativeProtocolDeltaRequest {
  readonly schemaVersion: "0.1";
  readonly kind: "delta-request";
  readonly requestId: string;
  readonly sessionRef: string;
  readonly surfaceRef: string;
  readonly baseRevision: string;
  readonly baseDigest: AgentSnapshotDeltaDigest;
}

export interface NativeProtocolDeltaResponse {
  readonly schemaVersion: "0.1";
  readonly kind: "delta-response";
  readonly requestId: string;
  readonly sessionRef: string;
  readonly surfaceRef: string;
  readonly delta: AgentSnapshotDelta;
}

export type NativeProtocolDataMessage =
  | NativeProtocolSurfaceListRequest
  | NativeProtocolSurfaceListResponse
  | NativeProtocolSnapshotRequest
  | NativeProtocolSnapshotResponse
  | NativeProtocolDeltaRequest
  | NativeProtocolDeltaResponse;

export interface NativeProtocolActionRequest {
  readonly schemaVersion: "0.1";
  readonly kind: "action-request";
  readonly requestId: string;
  readonly sessionRef: string;
  readonly surfaceRef: string;
  readonly revision: string;
  readonly elementId: string;
  readonly action: string;
  readonly input?: AgentJsonValue;
  readonly idempotencyKey?: string;
}

export interface NativeProtocolActionResponse {
  readonly schemaVersion: "0.1";
  readonly kind: "action-response";
  readonly requestId: string;
  readonly sessionRef: string;
  readonly surfaceRef: string;
  readonly outcome: AgentActionOutcome;
}

export interface NativeProtocolCancelRequest {
  readonly schemaVersion: "0.1";
  readonly kind: "cancel-request";
  readonly requestId: string;
  readonly sessionRef: string;
  readonly targetRequestId: string;
}

export type NativeProtocolCancellationDisposition =
  | "accepted"
  | "already-completed"
  | "not-cancellable";

export interface NativeProtocolCancelResponse {
  readonly schemaVersion: "0.1";
  readonly kind: "cancel-response";
  readonly requestId: string;
  readonly sessionRef: string;
  readonly targetRequestId: string;
  readonly disposition: NativeProtocolCancellationDisposition;
}

export type NativeProtocolRequestErrorCode =
  | "capability_not_negotiated"
  | "internal_error"
  | "invalid_message"
  | "invalid_session"
  | "permission_denied"
  | "request_cancelled"
  | "request_conflict"
  | "resource_limit"
  | "resync_required"
  | "stale_revision"
  | "surface_unavailable";

export interface NativeProtocolRequestError {
  readonly schemaVersion: "0.1";
  readonly kind: "request-error";
  readonly requestId: string;
  readonly sessionRef: string;
  readonly code: NativeProtocolRequestErrorCode;
  readonly message: string;
}

interface NativeProtocolEventBase {
  readonly schemaVersion: "0.1";
  readonly kind: "event";
  readonly sessionRef: string;
  readonly sequence: number;
}

export type NativeProtocolEvent =
  | (NativeProtocolEventBase & {
      readonly event: "catalog-changed";
    })
  | (NativeProtocolEventBase & {
      readonly event: "session-invalidated";
    })
  | (NativeProtocolEventBase & {
      readonly event: "surface-changed";
      readonly surfaceRef: string;
      readonly revision: string;
    })
  | (NativeProtocolEventBase & {
      readonly event: "surface-closed";
      readonly surfaceRef: string;
    });

export type NativeProtocolExecutionMessage =
  | NativeProtocolActionRequest
  | NativeProtocolActionResponse
  | NativeProtocolCancelRequest
  | NativeProtocolCancelResponse
  | NativeProtocolRequestError
  | NativeProtocolEvent;

export type NativeProtocolMessage =
  | NativeProtocolHandshakeMessage
  | NativeProtocolDataMessage
  | NativeProtocolExecutionMessage;

export type NativeProtocolSessionPhase =
  | "awaiting-client-hello"
  | "awaiting-server-hello"
  | "active"
  | "closed";

export interface NativeProtocolSessionState {
  readonly phase: NativeProtocolSessionPhase;
  readonly sessionRef: string | null;
  readonly capabilities: readonly NativeProtocolCapability[];
  readonly activeRequests: number;
  readonly completedRequests: number;
  readonly surfaces: number;
  readonly lastEventSequence: number;
  readonly catalogStale: boolean;
}

export interface NativeProtocolNegotiationOptions {
  readonly sessionRef: string;
  readonly capabilities: readonly NativeProtocolCapability[];
}

export type NativeProtocolNegotiationResult =
  | {
      readonly status: "accepted";
      readonly message: NativeProtocolServerHello;
    }
  | {
      readonly status: "rejected";
      readonly message: NativeProtocolError;
    };
