export type AgentRisk =
  | "read"
  | "write"
  | "consequential"
  | "destructive"
  | "credential";

export type AgentIdempotency = "none" | "keyed" | "safe-retry";

export interface AgentActionDefinition {
  description?: string;
  risk?: AgentRisk;
  handler?: (input: unknown, element: Element) => void | Promise<void>;
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
  elementId: string;
  action: string;
  input?: unknown;
}

export interface AgentAuthorizationRequest extends AgentActionRequest {
  risk: AgentRisk;
  element: AgentElementSnapshot;
}

export interface AgentSurfaceOptions {
  root?: ParentNode;
  surfaceId?: string;
  authorize?: (
    request: AgentAuthorizationRequest,
  ) => boolean | Promise<boolean>;
}
