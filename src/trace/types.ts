import type {
  AgentAuditEvent,
  AgentAuditEventName,
  AgentAuditOutcome,
} from "../audit.js";

export type AgentRuntimeTraceDigest = `sha256:${string}`;

export interface AgentRuntimeTraceRecord {
  readonly index: number;
  readonly operation: number;
  readonly sequence: number;
  readonly event: AgentAuditEventName;
  readonly outcome: AgentAuditOutcome;
  readonly revisionRef: string;
  readonly previousDigest: AgentRuntimeTraceDigest;
  readonly digest: AgentRuntimeTraceDigest;
  readonly actionRef?: string;
}

export interface AgentRuntimeTrace {
  readonly schemaVersion: "0.1";
  readonly kind: "agent-runtime-trace";
  readonly sourceId: string;
  readonly recordCount: number;
  readonly operationCount: number;
  readonly headDigest: AgentRuntimeTraceDigest;
  readonly records: readonly AgentRuntimeTraceRecord[];
}

export interface AgentTraceRecorderOptions {
  readonly sourceId: string;
}

export type AgentTraceRejectionReason =
  | "invalid_event"
  | "invalid_order"
  | "surface_mismatch"
  | "secret_detected"
  | "budget_exceeded"
  | "already_finished"
  | "integrity_failure";

export type AgentTraceFinishResult =
  | { readonly status: "complete"; readonly trace: AgentRuntimeTrace }
  | { readonly status: "rejected"; readonly reason: AgentTraceRejectionReason };

export interface AgentTraceRecorder {
  readonly record: (event: AgentAuditEvent) => void;
  readonly finish: () => Promise<AgentTraceFinishResult>;
}
