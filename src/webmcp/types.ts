import type {
  AgentActionOutcome,
  AgentActionRequest,
  AgentSnapshot,
} from "../types.js";

export interface WebMcpToolAnnotations {
  readOnlyHint?: boolean;
  consequentialHint?: boolean;
  untrustedContentHint?: boolean;
}

export interface WebMcpExecuteContext {
  signal?: AbortSignal;
}

export interface WebMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: WebMcpToolAnnotations;
  execute: (
    input: unknown,
    context?: WebMcpExecuteContext,
  ) => AgentActionOutcome | Promise<AgentActionOutcome>;
}

export interface WebMcpModelContext {
  registerTool(
    tool: WebMcpTool,
    options: { signal: AbortSignal },
  ): void | Promise<void>;
}

export interface WebMcpSurface {
  snapshot(): AgentSnapshot;
  performSafe(request: AgentActionRequest): Promise<AgentActionOutcome>;
}

export interface WebMcpToolBinding {
  /** Stable developer-owned WebMCP tool name. Never derive this from DOM text. */
  name: string;
  /** Trusted developer-owned description. Never interpolate page content. */
  description: string;
  elementId: string;
  action: string;
}

export interface WebMcpExportOptions {
  bindings: readonly WebMcpToolBinding[];
  /** Test/compatibility seam. Production callers should use document.modelContext. */
  modelContext?: WebMcpModelContext;
  document?: Document;
}

export interface WebMcpExportHandle {
  readonly supported: boolean;
  readonly toolNames: readonly string[];
  refresh(): Promise<void>;
  dispose(): void;
}

