import {
  ProtocolError,
  ProtocolErrorCode,
  ResourceNotFoundError,
  Server,
  type CallToolResult,
  type ListResourcesResult,
  type ListToolsResult,
  type ReadResourceResult,
  type ServerContext,
  type Tool,
} from "@modelcontextprotocol/server";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsModule, { type FormatsPlugin } from "ajv-formats";

import {
  AGENT_FAILURE_MESSAGES,
  type AgentFailureCode,
} from "../errors.js";
import { AGENT_SNAPSHOT_SCHEMA } from "../schema.js";
import { preflightActionSchemas } from "../validation.js";
import type {
  AgentActionFailureResult,
  AgentActionSnapshot,
  AgentJsonValue,
  AgentSnapshot,
} from "../types.js";
import {
  captureMcpSchema,
  createMcpOutputSchema,
  createMcpTool,
} from "./schema.js";
import type {
  AgentSurfaceMcpServer,
  McpAccessOperation,
  McpProjectedActionFailure,
  McpProjectedActionOutcome,
  McpServerOptions,
  McpSurface,
  McpToolBinding,
} from "./types.js";

export type * from "./types.js";

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9._~-]{1,128}$/;
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~-]{1,128}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_BINDINGS = 128;
const MAX_SNAPSHOT_BYTES = 1_048_576;
const MAX_ACTION_RESULT_BYTES = 262_144;
const MAX_TOOL_CATALOG_BYTES = 262_144;
const MAX_REVISION_LENGTH = 128;

interface ResolvedBinding {
  action: AgentActionSnapshot;
  binding: McpToolBinding;
}

interface ParsedEnvelope {
  valid: boolean;
  revision: string;
  input?: unknown;
  idempotencyKey?: string;
}

const snapshotAjv = new Ajv2020({ allErrors: true, strict: true });
const addFormats = addFormatsModule as unknown as FormatsPlugin;
addFormats(snapshotAjv);
const validateSnapshot = snapshotAjv.compile(
  AGENT_SNAPSHOT_SCHEMA,
) as ValidateFunction<AgentSnapshot>;

function invalidConfiguration(message: string): never {
  throw new TypeError(message);
}

function validateOptions(options: McpServerOptions): void {
  if (
    !OPAQUE_ID_PATTERN.test(options.serverName) ||
    !options.serverVersion ||
    options.serverVersion.length > 64 ||
    CONTROL_CHARACTER_PATTERN.test(options.serverVersion)
  ) {
    return invalidConfiguration("Invalid MCP server identity");
  }
  if (!OPAQUE_ID_PATTERN.test(options.surfaceRef)) {
    return invalidConfiguration("MCP surfaceRef must be an opaque URL-safe identifier");
  }
  if (!OPAQUE_ID_PATTERN.test(options.principalRef)) {
    return invalidConfiguration("MCP principalRef must be an opaque URL-safe identifier");
  }
  if (typeof options.authorize !== "function") {
    return invalidConfiguration("MCP exporter requires an authorization callback");
  }
  if (
    !Array.isArray(options.bindings) ||
    options.bindings.length === 0 ||
    options.bindings.length > MAX_BINDINGS
  ) {
    return invalidConfiguration("MCP exporter requires 1-128 explicit bindings");
  }
  const names = new Set<string>();
  const targets = new Set<string>();
  for (const binding of options.bindings) {
    if (!TOOL_NAME_PATTERN.test(binding.name)) {
      return invalidConfiguration("Invalid MCP tool name");
    }
    if (
      !binding.description ||
      binding.description.length > MAX_DESCRIPTION_LENGTH ||
      CONTROL_CHARACTER_PATTERN.test(binding.description)
    ) {
      return invalidConfiguration("Invalid trusted MCP tool description");
    }
    if (
      !binding.elementId ||
      binding.elementId.length > 128 ||
      CONTROL_CHARACTER_PATTERN.test(binding.elementId) ||
      !binding.action ||
      binding.action.length > 64 ||
      CONTROL_CHARACTER_PATTERN.test(binding.action)
    ) {
      return invalidConfiguration("Invalid MCP tool target");
    }
    if (
      binding.projectOutput !== undefined &&
      typeof binding.projectOutput !== "function"
    ) {
      return invalidConfiguration("Invalid MCP output projection");
    }
    const target = `${binding.elementId}\u0000${binding.action}`;
    if (names.has(binding.name) || targets.has(target)) {
      return invalidConfiguration("Duplicate MCP tool binding");
    }
    names.add(binding.name);
    targets.add(target);
  }
}

function resolveBinding(
  snapshot: AgentSnapshot,
  binding: McpToolBinding,
): ResolvedBinding | undefined {
  const node = snapshot.nodes.find((candidate) => candidate.id === binding.elementId);
  const action = node?.actions.find((candidate) => candidate.name === binding.action);
  if (!action || action.risk === "credential") return undefined;
  if (action.inputSchema) captureMcpSchema(action.inputSchema);
  if (action.outputSchema) {
    captureMcpSchema(action.outputSchema);
    if (!binding.projectOutput) {
      return invalidConfiguration(
        "MCP actions with output require a trusted output projection",
      );
    }
  }
  preflightActionSchemas(action);
  return { action, binding };
}

function preflightBindings(
  snapshot: AgentSnapshot,
  bindings: readonly McpToolBinding[],
): void {
  for (const binding of bindings) {
    if (!resolveBinding(snapshot, binding)) {
      return invalidConfiguration("MCP binding targets an unavailable or credential action");
    }
  }
}

function sanitizeSnapshotUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.origin;
    }
    if (url.protocol === "about:" && url.pathname === "blank") {
      return "about:blank";
    }
    return `${url.protocol}//redacted`;
  } catch {
    return "redacted:";
  }
}

function projectSnapshot(
  snapshot: AgentSnapshot,
  surfaceRef: string,
): { snapshot: AgentSnapshot; text: string } {
  let clone: AgentSnapshot;
  try {
    clone = JSON.parse(JSON.stringify({
      ...snapshot,
      surfaceId: surfaceRef,
      title: "Agent surface",
      url: sanitizeSnapshotUrl(snapshot.url),
      focusedElementId: undefined,
      nodes: snapshot.nodes.map((node) => {
        if (node.state.sensitive) {
          return {
            id: node.id,
            role: node.role,
            name: "Sensitive field",
            state: {
              sensitive: true,
              ...(node.state.valuePresent === undefined
                ? {}
                : { valuePresent: node.state.valuePresent }),
            },
            actions: [],
            ...(node.bounds === undefined ? {} : { bounds: node.bounds }),
          };
        }
        return {
          ...node,
          actions: node.actions.filter((action) => action.risk !== "credential"),
        };
      }),
    })) as AgentSnapshot;
  } catch {
    throw new TypeError("MCP snapshot is invalid");
  }
  if (!validateSnapshot(clone)) {
    throw new TypeError("MCP snapshot is invalid");
  }
  const text = JSON.stringify(clone);
  if (new TextEncoder().encode(text).byteLength > MAX_SNAPSHOT_BYTES) {
    throw new RangeError("MCP snapshot exceeds the serialization budget");
  }
  return { snapshot: clone, text };
}

function captureSnapshot(surface: McpSurface): AgentSnapshot {
  try {
    const snapshot = surface.snapshot();
    if (!validateSnapshot(snapshot) || !isSafeRevision(snapshot.revision)) {
      throw new TypeError();
    }
    return snapshot;
  } catch {
    throw new ProtocolError(
      ProtocolErrorCode.InternalError,
      "The agent surface snapshot is unavailable",
    );
  }
}

function parseEnvelope(
  value: unknown,
  action: AgentActionSnapshot,
): ParsedEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, revision: "unavailable" };
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(["revision"]);
  if (action.inputSchema) allowed.add("input");
  if (action.idempotency === "keyed") allowed.add("idempotencyKey");
  const revision = isSafeRevision(record.revision)
    ? record.revision
    : "unavailable";
  if (
    revision === "unavailable" ||
    Object.keys(record).some((key) => !allowed.has(key)) ||
    (action.inputSchema ? !("input" in record) : "input" in record)
  ) {
    return { valid: false, revision };
  }
  if (action.idempotency === "keyed") {
    if (
      typeof record.idempotencyKey !== "string" ||
      !IDEMPOTENCY_KEY_PATTERN.test(record.idempotencyKey)
    ) {
      return { valid: false, revision };
    }
  }
  return {
    valid: true,
    revision,
    ...(action.inputSchema ? { input: record.input } : {}),
    ...(action.idempotency === "keyed"
      ? { idempotencyKey: record.idempotencyKey as string }
      : {}),
  };
}

function isSafeRevision(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_REVISION_LENGTH &&
    !CONTROL_CHARACTER_PATTERN.test(value);
}

function failureOutcome(
  surfaceRef: string,
  revision: string,
  code: AgentFailureCode,
): McpProjectedActionFailure {
  return {
    schemaVersion: "0.1",
    surfaceRef,
    revision,
    status: "failed",
    error: { code, message: AGENT_FAILURE_MESSAGES[code] },
  };
}

function failureResult(failure: McpProjectedActionFailure): CallToolResult {
  return {
    content: [{ type: "text", text: `Action failed: ${failure.error.code}` }],
    structuredContent: { ...failure },
    isError: true,
  };
}

function projectOutcome(
  outcome: Awaited<ReturnType<McpSurface["performSafe"]>>,
  surfaceRef: string,
  internalSurfaceId: string,
  fallbackRevision: string,
  resolved: ResolvedBinding,
): McpProjectedActionOutcome {
  if (outcome.status === "failed") {
    const code = outcome.error?.code;
    if (
      outcome.schemaVersion !== "0.1" ||
      outcome.surfaceId !== internalSurfaceId ||
      typeof code !== "string" ||
      !Object.hasOwn(AGENT_FAILURE_MESSAGES, code)
    ) {
      return failureOutcome(surfaceRef, fallbackRevision, "internal_error");
    }
    return {
      schemaVersion: "0.1",
      surfaceRef,
      revision: isSafeRevision(outcome.revision)
        ? outcome.revision
        : fallbackRevision,
      status: "failed",
      error: {
        code,
        message: AGENT_FAILURE_MESSAGES[code],
      },
    };
  }
  if (
    outcome.schemaVersion !== "0.1" ||
    outcome.surfaceId !== internalSurfaceId ||
    outcome.action !== resolved.binding.action ||
    outcome.targetId !== resolved.binding.elementId ||
    typeof outcome.targetPresent !== "boolean" ||
    !isSafeRevision(outcome.previousRevision) ||
    !isSafeRevision(outcome.revision)
  ) {
    return failureOutcome(surfaceRef, fallbackRevision, "internal_error");
  }
  let output: AgentJsonValue | undefined;
  if (resolved.action.outputSchema) {
    if (outcome.output === undefined) {
      return failureOutcome(surfaceRef, fallbackRevision, "internal_error");
    }
    try {
      output = resolved.binding.projectOutput!(outcome.output);
      const validator = snapshotAjv.compile(captureMcpSchema(resolved.action.outputSchema));
      if (!validator(output)) {
        return failureOutcome(surfaceRef, fallbackRevision, "internal_error");
      }
    } catch {
      return failureOutcome(surfaceRef, fallbackRevision, "internal_error");
    }
  }
  const projected: McpProjectedActionOutcome = {
    schemaVersion: "0.1",
    surfaceRef,
    previousRevision: outcome.previousRevision,
    revision: outcome.revision,
    status: "succeeded",
    action: outcome.action,
    targetId: outcome.targetId,
    targetPresent: outcome.targetPresent,
    ...(resolved.action.outputSchema ? { output: output! } : {}),
  };
  try {
    const validateProjected = snapshotAjv.compile(
      createMcpOutputSchema(
        surfaceRef,
        resolved.binding,
        resolved.action,
      ) as never,
    );
    if (!validateProjected(projected)) {
      return failureOutcome(surfaceRef, fallbackRevision, "internal_error");
    }
    if (
      new TextEncoder().encode(JSON.stringify(projected)).byteLength >
      MAX_ACTION_RESULT_BYTES
    ) {
      return failureOutcome(surfaceRef, fallbackRevision, "internal_error");
    }
  } catch {
    return failureOutcome(surfaceRef, fallbackRevision, "internal_error");
  }
  return projected;
}

async function authorized(
  authorize: McpServerOptions["authorize"],
  surfaceRef: string,
  principalRef: string,
  operation: McpAccessOperation,
  context: ServerContext,
  toolName?: string,
): Promise<boolean> {
  try {
    if (context.mcpReq.signal.aborted) return false;
    return await authorize({
      operation,
      surfaceRef,
      principalRef,
      ...(toolName ? { toolName } : {}),
      ...(context.http?.authInfo ? { authInfo: context.http.authInfo } : {}),
    }) === true;
  } catch {
    return false;
  }
}

export function createAgentSurfaceMcpServer(
  surface: McpSurface,
  options: McpServerOptions,
): AgentSurfaceMcpServer {
  validateOptions(options);
  const serverName = options.serverName;
  const serverVersion = options.serverVersion;
  const surfaceRef = options.surfaceRef;
  const principalRef = options.principalRef;
  const authorize = options.authorize;
  const initialSnapshot = captureSnapshot(surface);
  preflightBindings(initialSnapshot, options.bindings);
  const bindings = Object.freeze(
    options.bindings
      .map((binding) => Object.freeze({ ...binding }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  );
  const initialTools = bindings.map((binding) => {
    const resolved = resolveBinding(initialSnapshot, binding)!;
    return createMcpTool(surfaceRef, binding, resolved.action);
  });
  if (
    new TextEncoder().encode(JSON.stringify(initialTools)).byteLength >
    MAX_TOOL_CATALOG_BYTES
  ) {
    return invalidConfiguration("MCP tool catalog exceeds the serialization budget");
  }
  const snapshotUri = `dual-surface://surface/${surfaceRef}/snapshot`;
  const server = new Server(
    { name: serverName, version: serverVersion },
    {
      capabilities: { resources: {}, tools: {} },
      cacheHints: {
        "resources/list": { ttlMs: 0, cacheScope: "private" },
        "resources/read": { ttlMs: 0, cacheScope: "private" },
        "tools/list": { ttlMs: 0, cacheScope: "private" },
      },
    },
  );
  let disposed = false;
  let disposePromise: Promise<void> | undefined;

  server.setRequestHandler(
    "resources/list",
    async (_request, context): Promise<ListResourcesResult> => {
      if (
        disposed ||
        !(await authorized(
          authorize,
          surfaceRef,
          principalRef,
          "resources.list",
          context,
        )) ||
        disposed ||
        context.mcpReq.signal.aborted
      ) {
        return { resources: [], ttlMs: 0, cacheScope: "private" };
      }
      return {
        resources: [{
          uri: snapshotUri,
          name: "Current agent surface snapshot",
          description: "Current private semantic state for the authorized surface",
          mimeType: "application/json",
        }],
        ttlMs: 0,
        cacheScope: "private",
      };
    },
  );

  server.setRequestHandler(
    "resources/read",
    async (request, context): Promise<ReadResourceResult> => {
      if (
        disposed ||
        request.params.uri !== snapshotUri ||
        !(await authorized(
          authorize,
          surfaceRef,
          principalRef,
          "resources.read",
          context,
        )) ||
        disposed ||
        context.mcpReq.signal.aborted
      ) {
        throw new ResourceNotFoundError(request.params.uri, "Resource unavailable");
      }
      try {
        const projected = projectSnapshot(captureSnapshot(surface), surfaceRef);
        return {
          contents: [{
            uri: snapshotUri,
            mimeType: "application/json",
            text: projected.text,
          }],
          ttlMs: 0,
          cacheScope: "private",
        };
      } catch {
        throw new ProtocolError(
          ProtocolErrorCode.InternalError,
          "The agent surface snapshot is unavailable",
        );
      }
    },
  );

  server.setRequestHandler(
    "tools/list",
    async (_request, context): Promise<ListToolsResult> => {
      if (
        disposed ||
        !(await authorized(
          authorize,
          surfaceRef,
          principalRef,
          "tools.list",
          context,
        )) ||
        disposed ||
        context.mcpReq.signal.aborted
      ) {
        return { tools: [], ttlMs: 0, cacheScope: "private" };
      }
      const snapshot = captureSnapshot(surface);
      const tools: Tool[] = [];
      for (const binding of bindings) {
        try {
          const resolved = resolveBinding(snapshot, binding);
          if (resolved) {
            tools.push(createMcpTool(surfaceRef, binding, resolved.action));
          }
        } catch {
          // A drifted or non-portable action is unavailable, not partially exposed.
        }
      }
      if (
        new TextEncoder().encode(JSON.stringify(tools)).byteLength >
        MAX_TOOL_CATALOG_BYTES
      ) {
        throw new ProtocolError(
          ProtocolErrorCode.InternalError,
          "The MCP tool catalog is unavailable",
        );
      }
      return { tools, ttlMs: 0, cacheScope: "private" };
    },
  );

  server.setRequestHandler(
    "tools/call",
    async (request, context): Promise<CallToolResult> => {
      if (
        disposed ||
        !(await authorized(
          authorize,
          surfaceRef,
          principalRef,
          "tools.call",
          context,
          request.params.name,
        )) ||
        disposed ||
        context.mcpReq.signal.aborted
      ) {
        return failureResult(
          failureOutcome(
            surfaceRef,
            "unavailable",
            disposed ? "internal_error" : "authorization_required",
          ),
        );
      }
      const binding = bindings.find((candidate) => candidate.name === request.params.name);
      if (!binding) {
        throw new ProtocolError(ProtocolErrorCode.InvalidParams, "Tool unavailable");
      }
      const snapshot = captureSnapshot(surface);
      let resolved: ResolvedBinding | undefined;
      try {
        resolved = resolveBinding(snapshot, binding);
      } catch {
        resolved = undefined;
      }
      if (!resolved) {
        throw new ProtocolError(ProtocolErrorCode.InvalidParams, "Tool unavailable");
      }
      const envelope = parseEnvelope(request.params.arguments, resolved.action);
      if (!envelope.valid) {
        return failureResult(
          failureOutcome(surfaceRef, "unavailable", "invalid_input"),
        );
      }
      if (context.mcpReq.signal.aborted) {
        return failureResult(
          failureOutcome(surfaceRef, "unavailable", "internal_error"),
        );
      }
      let outcome: Awaited<ReturnType<McpSurface["performSafe"]>>;
      try {
        outcome = await surface.performSafe({
          surfaceId: snapshot.surfaceId,
          revision: envelope.revision,
          elementId: binding.elementId,
          action: binding.action,
          ...(resolved.action.inputSchema ? { input: envelope.input } : {}),
          ...(envelope.idempotencyKey
            ? { idempotencyKey: envelope.idempotencyKey }
            : {}),
        });
      } catch {
        outcome = {
          schemaVersion: "0.1",
          surfaceId: snapshot.surfaceId,
          revision: snapshot.revision,
          status: "failed",
          error: {
            code: "internal_error",
            message: AGENT_FAILURE_MESSAGES.internal_error,
          },
        } satisfies AgentActionFailureResult;
      }
      let projected: McpProjectedActionOutcome;
      try {
        projected = projectOutcome(
          outcome,
          surfaceRef,
          snapshot.surfaceId,
          snapshot.revision,
          resolved,
        );
      } catch {
        projected = failureOutcome(
          surfaceRef,
          snapshot.revision,
          "internal_error",
        );
      }
      if (projected.status === "failed") return failureResult(projected);
      return {
        content: [{ type: "text", text: "Action succeeded" }],
        structuredContent: { ...projected },
      };
    },
  );

  return {
    server,
    snapshotUri,
    toolNames: Object.freeze(bindings.map((binding) => binding.name)),
    async dispose() {
      if (!disposePromise) {
        disposed = true;
        disposePromise = server.close();
      }
      await disposePromise;
    },
  };
}
