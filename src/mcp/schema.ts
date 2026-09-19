import type { Tool } from "@modelcontextprotocol/server";

import { capturePortableSchema } from "../portable-schema.js";
import type { AgentActionSnapshot } from "../types.js";
import type { McpToolBinding } from "./types.js";

const IDEMPOTENCY_KEY_PATTERN = "^[A-Za-z0-9._~-]{1,128}$";
const REVISION_PATTERN = "^[^\\u0000-\\u001F\\u007F]{1,128}$";

export function captureMcpSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const captured = capturePortableSchema(schema);
  const pending: unknown[] = [captured];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }
    for (const [key, nested] of Object.entries(value)) {
      if (key.toLowerCase() === "x-mcp-header") {
        throw new TypeError("MCP schemas cannot contain transport-only keywords");
      }
      pending.push(nested);
    }
  }
  return captured;
}

export function createMcpInputSchema(
  action: AgentActionSnapshot,
): Tool["inputSchema"] {
  const properties: Record<string, unknown> = {
    revision: { type: "string", pattern: REVISION_PATTERN },
  };
  const required = ["revision"];
  if (action.inputSchema) {
    properties.input = captureMcpSchema(action.inputSchema);
    required.push("input");
  }
  if (action.idempotency === "keyed") {
    properties.idempotencyKey = {
      type: "string",
      pattern: IDEMPOTENCY_KEY_PATTERN,
    };
    required.push("idempotencyKey");
  }
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required,
  } as Tool["inputSchema"];
}

export function createMcpOutputSchema(
  surfaceRef: string,
  binding: McpToolBinding,
  action: AgentActionSnapshot,
): NonNullable<Tool["outputSchema"]> {
  const properties: Record<string, unknown> = {
    schemaVersion: { const: "0.1" },
    surfaceRef: { const: surfaceRef },
    previousRevision: { type: "string", pattern: REVISION_PATTERN },
    revision: { type: "string", pattern: REVISION_PATTERN },
    status: { const: "succeeded" },
    action: { const: binding.action },
    targetId: { const: binding.elementId },
    targetPresent: { type: "boolean" },
  };
  if (action.outputSchema) {
    properties.output = captureMcpSchema(action.outputSchema);
  }
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required: [
      "schemaVersion",
      "surfaceRef",
      "previousRevision",
      "revision",
      "status",
      "action",
      "targetId",
      "targetPresent",
      ...(action.outputSchema ? ["output"] : []),
    ],
  } as NonNullable<Tool["outputSchema"]>;
}

export function createMcpTool(
  surfaceRef: string,
  binding: McpToolBinding,
  action: AgentActionSnapshot,
): Tool {
  return {
    name: binding.name,
    description: binding.description,
    inputSchema: createMcpInputSchema(action),
    outputSchema: createMcpOutputSchema(surfaceRef, binding, action),
    annotations: {
      readOnlyHint: action.risk === "read",
      destructiveHint: action.risk === "destructive",
      idempotentHint: action.idempotency === "safe-retry",
      openWorldHint: true,
    },
  };
}
