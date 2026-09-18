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

export interface WebMcpDeclarativeCapabilities {
  /** General imperative WebMCP signal only; it does not prove declarative support. */
  imperative: boolean;
  submitEventExtensions: boolean;
  activeSelectors: boolean;
  declarative: "likely-supported" | "unknown";
}

export type WebMcpDeclarativeControl = HTMLInputElement | HTMLTextAreaElement;

export interface WebMcpDeclarativeFieldBinding {
  control: WebMcpDeclarativeControl;
  /** Trusted developer-owned parameter description. */
  description: string;
}

export interface WebMcpDeclarativeFormOptions {
  form: HTMLFormElement;
  /** Trusted developer-owned tool identifier; limited to the guidance budget. */
  name: string;
  /** Trusted developer-owned tool description. */
  description: string;
  fields: readonly WebMcpDeclarativeFieldBinding[];
}

export interface WebMcpDeclarativeFormHandle {
  readonly form: HTMLFormElement;
  readonly name: string;
  dispose(): void;
}
