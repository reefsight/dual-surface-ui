import { capturePortableSchema } from "../portable-schema.js";
import type { AgentActionSnapshot } from "../types.js";
import type {
  WebMcpToolBinding,
  WebMcpToolDescriptor,
} from "./types.js";

function freezeJson(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  for (const item of Object.values(value)) freezeJson(item);
  Object.freeze(value);
}

export function createWebMcpToolDescriptor(
  binding: WebMcpToolBinding,
  action: AgentActionSnapshot,
): WebMcpToolDescriptor {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  if (action.inputSchema) {
    properties.input = capturePortableSchema(action.inputSchema);
    required.push("input");
  }
  if (action.idempotency === "keyed") {
    properties.idempotencyKey = {
      type: "string",
      pattern: "^[A-Za-z0-9._~-]{1,128}$",
    };
    required.push("idempotencyKey");
  }
  const inputSchema = {
    type: "object",
    additionalProperties: false,
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
  freezeJson(inputSchema);
  return Object.freeze({
    name: binding.name,
    description: binding.description,
    inputSchema,
    annotations: Object.freeze({
      readOnlyHint: action.risk === "read",
      consequentialHint:
        action.risk !== "read" || action.requiresConfirmation === true,
      untrustedContentHint: true,
    }),
  });
}
