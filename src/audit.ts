import { AGENT_FAILURE_CODES } from "./errors.js";

export const AGENT_AUDIT_EVENT_NAMES = [
  "surface_observed",
  "action_requested",
  "policy_decided",
  "confirmation_requested",
  "action_started",
  "action_verified",
  "action_failed",
] as const;

export const AGENT_AUDIT_OUTCOMES = [
  "observed",
  "requested",
  "allow",
  "deny",
  "require_confirmation",
  "started",
  "succeeded",
  "replayed",
  ...AGENT_FAILURE_CODES,
] as const;

export type AgentAuditEventName = (typeof AGENT_AUDIT_EVENT_NAMES)[number];
export type AgentAuditOutcome = (typeof AGENT_AUDIT_OUTCOMES)[number];

export interface AgentAuditEvent {
  schemaVersion: "0.1";
  event: AgentAuditEventName;
  correlationId: string;
  surfaceId: string;
  revision: string;
  sequence: number;
  timestamp: string;
  durationMs: number;
  outcome: AgentAuditOutcome;
  action?: string;
}

const AGENT_AUDIT_IDENTIFIER_PATTERN = /^[A-Za-z0-9._~-]{1,128}$/;

export function isValidAgentAuditIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" && AGENT_AUDIT_IDENTIFIER_PATTERN.test(value)
  );
}
