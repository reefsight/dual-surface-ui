import type { AuthInfo, Server } from "@modelcontextprotocol/server";

import type {
  AgentActionOutcome,
  AgentActionRequest,
  AgentJsonValue,
  AgentSnapshot,
} from "../types.js";
import type { AgentFailureDetail } from "../errors.js";

export interface McpSurface {
  snapshot(): AgentSnapshot;
  performSafe(request: AgentActionRequest): Promise<AgentActionOutcome>;
}

export interface McpToolBinding {
  /** Stable developer-owned MCP tool name. Never derive this from page text. */
  name: string;
  /** Trusted developer-owned description. Never interpolate page content. */
  description: string;
  elementId: string;
  action: string;
  /**
   * Required for actions with an output schema. This trusted boundary decides
   * which verified business output is safe to expose to an MCP caller.
   */
  projectOutput?: (output: AgentJsonValue) => AgentJsonValue;
}

export type McpAccessOperation =
  | "resources.list"
  | "resources.read"
  | "tools.list"
  | "tools.call";

export interface McpAccessRequest {
  operation: McpAccessOperation;
  /** Opaque public reference configured by the trusted host. */
  surfaceRef: string;
  /** Trusted, host-owned identity this dedicated exporter is bound to. */
  principalRef: string;
  /** Present only for tools/call. It is not an identity or authority signal. */
  toolName?: string;
  /** Validated transport authentication only; client metadata is never exposed. */
  authInfo?: AuthInfo;
}

export interface McpServerOptions {
  serverName: string;
  serverVersion: string;
  /** Opaque URL-safe external reference; never use a page URL or principal. */
  surfaceRef: string;
  /** Opaque identity for the one trusted principal served by this instance. */
  principalRef: string;
  bindings: readonly McpToolBinding[];
  authorize(request: McpAccessRequest): boolean | Promise<boolean>;
}

export interface McpProjectedActionSuccess {
  schemaVersion: "0.1";
  surfaceRef: string;
  previousRevision: string;
  revision: string;
  status: "succeeded";
  action: string;
  targetId: string;
  targetPresent: boolean;
  output?: AgentJsonValue;
}

export interface McpProjectedActionFailure {
  schemaVersion: "0.1";
  surfaceRef: string;
  revision: string;
  status: "failed";
  error: AgentFailureDetail;
}

export type McpProjectedActionOutcome =
  | McpProjectedActionSuccess
  | McpProjectedActionFailure;

export interface AgentSurfaceMcpServer {
  readonly server: Server;
  readonly snapshotUri: string;
  readonly toolNames: readonly string[];
  dispose(): Promise<void>;
}
