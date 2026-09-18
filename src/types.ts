import type { AgentFailureDetail } from "./errors.js";
import type { AgentAuditEvent } from "./audit.js";

export type AgentRisk =
  | "read"
  | "write"
  | "consequential"
  | "destructive"
  | "credential";

export type AgentIdempotency = "none" | "keyed" | "safe-retry";

export type AgentJsonValue =
  | null
  | boolean
  | number
  | string
  | AgentJsonValue[]
  | { [key: string]: AgentJsonValue };

export interface AgentActionDefinition {
  description?: string;
  risk?: AgentRisk;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  preconditions?: string[];
  effects?: string[];
  requiresConfirmation?: boolean;
  idempotency?: AgentIdempotency;
  handler?: (input: unknown, element: Element) => unknown | Promise<unknown>;
}

export interface AgentElementDefinition {
  id: string;
  description?: string;
  actions?: Record<string, AgentActionDefinition>;
}

export interface AgentActionSnapshot {
  name: string;
  description?: string;
  risk: AgentRisk;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  preconditions?: string[];
  effects?: string[];
  requiresConfirmation?: boolean;
  idempotency?: AgentIdempotency;
}

export interface AgentElementState {
  disabled?: boolean;
  checked?: boolean;
  expanded?: boolean;
  selected?: boolean;
  value?: string;
  valuePresent?: boolean;
  sensitive?: boolean;
}

export interface AgentBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AgentElementSnapshot {
  id: string;
  role: string;
  name: string;
  description?: string;
  state: AgentElementState;
  actions: AgentActionSnapshot[];
  bounds?: AgentBounds;
}

export interface AgentSnapshot {
  schemaVersion: "0.1";
  surfaceId: string;
  revision: string;
  title: string;
  url: string;
  generatedAt: string;
  focusedElementId?: string;
  capabilities: string[];
  nodes: AgentElementSnapshot[];
}

export interface AgentActionRequest {
  surfaceId: string;
  revision: string;
  elementId: string;
  action: string;
  input?: unknown;
  idempotencyKey?: string;
}

export interface AgentActionResult {
  schemaVersion: "0.1";
  surfaceId: string;
  previousRevision: string;
  revision: string;
  status: "succeeded";
  action: string;
  targetId: string;
  targetPresent: boolean;
  node?: AgentElementSnapshot;
  output?: AgentJsonValue;
}

export interface AgentActionFailureResult {
  schemaVersion: "0.1";
  surfaceId: string;
  revision: string;
  status: "failed";
  error: AgentFailureDetail;
}

export type AgentActionOutcome = AgentActionResult | AgentActionFailureResult;

export interface AgentAuthorizationRequest extends AgentActionRequest {
  risk: AgentRisk;
  element: AgentElementSnapshot;
}

export interface AgentPrincipal {
  id: string;
  roles?: string[];
}

export type AgentPolicyOutcome =
  | "allow"
  | "deny"
  | "require_confirmation";

export interface AgentPolicyDecision {
  outcome: AgentPolicyOutcome;
  reason?: string;
}

export interface AgentPolicyRequest extends AgentAuthorizationRequest {
  origin: string;
  principal?: AgentPrincipal;
}

export interface AgentConfirmationRequest extends AgentPolicyRequest {
  decision: AgentPolicyDecision;
}

export interface AgentPreconditionRequest extends AgentPolicyRequest {
  precondition: string;
  snapshot: AgentSnapshot;
}

export interface AgentEffectVerificationRequest extends AgentPolicyRequest {
  effect: string;
  before: AgentSnapshot;
  after: AgentSnapshot;
}

export interface AgentSurfaceOptions {
  root?: ParentNode;
  surfaceId?: string;
  idempotencyCacheSize?: number;
  onAudit?: (event: AgentAuditEvent) => unknown;
  createCorrelationId?: () => string;
  getPrincipal?: () =>
    | AgentPrincipal
    | undefined
    | Promise<AgentPrincipal | undefined>;
  policy?: (
    request: AgentPolicyRequest,
  ) => AgentPolicyDecision | Promise<AgentPolicyDecision>;
  confirm?: (
    request: AgentConfirmationRequest,
  ) => boolean | Promise<boolean>;
  checkPrecondition?: (
    request: AgentPreconditionRequest,
  ) => boolean | Promise<boolean>;
  verifyEffect?: (
    request: AgentEffectVerificationRequest,
  ) => boolean | Promise<boolean>;
  authorize?: (
    request: AgentAuthorizationRequest,
  ) => boolean | Promise<boolean>;
}
