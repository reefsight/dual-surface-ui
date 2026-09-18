import type {
  AgentActionFailureResult,
  AgentActionSnapshot,
  AgentSnapshot,
} from "../types.js";
import type {
  WebMcpExportHandle,
  WebMcpExportOptions,
  WebMcpModelContext,
  WebMcpSurface,
  WebMcpTool,
  WebMcpToolBinding,
} from "./types.js";

export type * from "./types.js";
export * from "./declarative.js";

const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~-]{1,128}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_SCHEMA_DEPTH = 20;
const MAX_SCHEMA_NODES = 1_000;
const MAX_SCHEMA_LENGTH = 32_768;

interface ModelContextDocument extends Document {
  modelContext?: WebMcpModelContext;
}

interface ResolvedBinding {
  binding: WebMcpToolBinding;
  action: AgentActionSnapshot;
}

interface RegistrationBatch {
  controllers: AbortController[];
  toolNames: string[];
}

const activeSurfaces = new WeakMap<WebMcpModelContext, WeakSet<object>>();

function resolveModelContext(
  options: WebMcpExportOptions,
): WebMcpModelContext | undefined {
  if (options.modelContext) return options.modelContext;
  const targetDocument = options.document ?? globalThis.document;
  const context = (targetDocument as ModelContextDocument | undefined)
    ?.modelContext;
  return context && typeof context.registerTool === "function"
    ? context
    : undefined;
}

export function isWebMcpImperativeSupported(
  targetDocument: Document | undefined = globalThis.document,
): boolean {
  const context = (targetDocument as ModelContextDocument | undefined)
    ?.modelContext;
  return !!context && typeof context.registerTool === "function";
}

function validateTrustedBinding(binding: WebMcpToolBinding): void {
  if (!TOOL_NAME_PATTERN.test(binding.name)) {
    throw new TypeError(
      `Invalid WebMCP tool name "${binding.name}"; expected 1-128 ASCII letters, digits, _, -, or .`,
    );
  }
  if (
    binding.description.length === 0 ||
    binding.description.length > MAX_DESCRIPTION_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(binding.description)
  ) {
    throw new TypeError(
      `Invalid trusted description for WebMCP tool "${binding.name}"`,
    );
  }
  if (!binding.elementId || !binding.action) {
    throw new TypeError(
      `WebMCP tool "${binding.name}" requires an elementId and action`,
    );
  }
}

function invalidPortableSchema(): never {
  throw new TypeError("WebMCP inputSchema must be portable JSON Schema");
}

function clonePortableSchemaValue(
  value: unknown,
  depth: number,
  stack: Set<object>,
  budget: { nodes: number },
): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return invalidPortableSchema();
    return value;
  }
  if (typeof value !== "object" || depth > MAX_SCHEMA_DEPTH) {
    return invalidPortableSchema();
  }
  if (stack.has(value)) return invalidPortableSchema();
  budget.nodes += 1;
  if (budget.nodes > MAX_SCHEMA_NODES) return invalidPortableSchema();
  stack.add(value);

  let clone: unknown;
  if (Array.isArray(value)) {
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.some(
        (key) =>
          typeof key === "symbol" ||
          (key !== "length" && !/^(0|[1-9]\d*)$/.test(key)),
      )
    ) {
      return invalidPortableSchema();
    }
    const items: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) return invalidPortableSchema();
      items.push(
        clonePortableSchemaValue(value[index], depth + 1, stack, budget),
      );
    }
    clone = items;
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return invalidPortableSchema();
    }
    const record: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === "symbol" || key === "$ref" || key === "$dynamicRef") {
        return invalidPortableSchema();
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        return invalidPortableSchema();
      }
      record[key] = clonePortableSchemaValue(
        descriptor.value,
        depth + 1,
        stack,
        budget,
      );
    }
    clone = record;
  }
  stack.delete(value);
  return clone;
}

function cloneSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const clone = clonePortableSchemaValue(
    schema,
    0,
    new Set(),
    { nodes: 0 },
  );
  if (!clone || Array.isArray(clone) || typeof clone !== "object") {
    return invalidPortableSchema();
  }
  if (JSON.stringify(clone).length > MAX_SCHEMA_LENGTH) {
    return invalidPortableSchema();
  }
  return clone as Record<string, unknown>;
}

function envelopeSchema(action: AgentActionSnapshot): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  if (action.inputSchema) {
    properties.input = cloneSchema(action.inputSchema);
    required.push("input");
  }
  if (action.idempotency === "keyed") {
    properties.idempotencyKey = {
      type: "string",
      pattern: "^[A-Za-z0-9._~-]{1,128}$",
    };
    required.push("idempotencyKey");
  }
  return {
    type: "object",
    additionalProperties: false,
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

function resolveBindings(
  snapshot: AgentSnapshot,
  bindings: readonly WebMcpToolBinding[],
): ResolvedBinding[] {
  const names = new Set<string>();
  const targets = new Set<string>();
  return bindings.map((binding) => {
    validateTrustedBinding(binding);
    if (names.has(binding.name)) {
      throw new TypeError(`Duplicate WebMCP tool name "${binding.name}"`);
    }
    names.add(binding.name);
    const target = `${binding.elementId}\u0000${binding.action}`;
    if (targets.has(target)) {
      throw new TypeError(
        `Duplicate WebMCP binding for "${binding.elementId}.${binding.action}"`,
      );
    }
    targets.add(target);
    const node = snapshot.nodes.find((item) => item.id === binding.elementId);
    const action = node?.actions.find((item) => item.name === binding.action);
    if (!action) {
      throw new TypeError(
        `WebMCP binding "${binding.name}" targets an unavailable action`,
      );
    }
    if (action.risk === "credential") {
      throw new TypeError(
        `WebMCP binding "${binding.name}" cannot export a credential action`,
      );
    }
    if (action.inputSchema) cloneSchema(action.inputSchema);
    return { binding, action };
  });
}

function invalidInput(
  snapshot: AgentSnapshot,
): AgentActionFailureResult {
  return {
    schemaVersion: "0.1",
    surfaceId: snapshot.surfaceId,
    revision: snapshot.revision,
    status: "failed",
    error: {
      code: "invalid_input",
      message: "The WebMCP tool input is invalid",
    },
  };
}

function parseEnvelope(
  input: unknown,
  action: AgentActionSnapshot,
): { valid: true; input?: unknown; idempotencyKey?: string } | { valid: false } {
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input)
  ) {
    return { valid: false };
  }
  const record = input as Record<string, unknown>;
  const allowed = new Set<string>();
  if (action.inputSchema) allowed.add("input");
  if (action.idempotency === "keyed") allowed.add("idempotencyKey");
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    return { valid: false };
  }
  if (action.inputSchema && !("input" in record)) return { valid: false };
  if (action.idempotency === "keyed") {
    if (
      typeof record.idempotencyKey !== "string" ||
      !IDEMPOTENCY_KEY_PATTERN.test(record.idempotencyKey)
    ) {
      return { valid: false };
    }
  }
  return {
    valid: true,
    ...(action.inputSchema ? { input: record.input } : {}),
    ...(action.idempotency === "keyed"
      ? { idempotencyKey: record.idempotencyKey as string }
      : {}),
  };
}

function abortError(): DOMException {
  return new DOMException("The WebMCP invocation was aborted", "AbortError");
}

function createTool(
  surface: WebMcpSurface,
  snapshot: AgentSnapshot,
  resolved: ResolvedBinding,
): WebMcpTool {
  const { binding, action } = resolved;
  return {
    name: binding.name,
    description: binding.description,
    inputSchema: envelopeSchema(action),
    annotations: {
      readOnlyHint: action.risk === "read",
      consequentialHint:
        action.risk !== "read" ||
        action.requiresConfirmation === true,
      untrustedContentHint: true,
    },
    async execute(input, context) {
      if (context?.signal?.aborted) throw abortError();
      const envelope = parseEnvelope(input, action);
      if (!envelope.valid) return invalidInput(snapshot);
      return surface.performSafe({
        surfaceId: snapshot.surfaceId,
        revision: snapshot.revision,
        elementId: binding.elementId,
        action: binding.action,
        ...(action.inputSchema ? { input: envelope.input } : {}),
        ...(envelope.idempotencyKey
          ? { idempotencyKey: envelope.idempotencyKey }
          : {}),
      });
    },
  };
}

function abortBatch(batch: RegistrationBatch): void {
  for (const controller of batch.controllers) controller.abort();
}

async function populateBatch(
  context: WebMcpModelContext,
  surface: WebMcpSurface,
  bindings: readonly WebMcpToolBinding[],
  batch: RegistrationBatch,
): Promise<void> {
  const snapshot = surface.snapshot();
  const resolved = resolveBindings(snapshot, bindings);
  try {
    for (const item of resolved) {
      const controller = new AbortController();
      batch.controllers.push(controller);
      await context.registerTool(createTool(surface, snapshot, item), {
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        throw abortError();
      }
      batch.toolNames.push(item.binding.name);
    }
  } catch (error) {
    abortBatch(batch);
    batch.controllers.length = 0;
    batch.toolNames.length = 0;
    throw error;
  }
}

function unsupportedHandle(): WebMcpExportHandle {
  return {
    supported: false,
    toolNames: Object.freeze([]),
    async refresh() {},
    dispose() {},
  };
}

export async function exportAgentSurfaceToWebMcp(
  surface: WebMcpSurface,
  options: WebMcpExportOptions,
): Promise<WebMcpExportHandle> {
  const context = resolveModelContext(options);
  if (!context) return unsupportedHandle();
  const bindings = options.bindings.map((binding) => ({ ...binding }));

  let surfaces = activeSurfaces.get(context);
  if (!surfaces) {
    surfaces = new WeakSet<object>();
    activeSurfaces.set(context, surfaces);
  }
  const surfaceKey = surface as object;
  if (surfaces.has(surfaceKey)) {
    throw new TypeError("This surface already has an active WebMCP exporter");
  }
  surfaces.add(surfaceKey);

  let disposed = false;
  let batch: RegistrationBatch = { controllers: [], toolNames: [] };
  try {
    await populateBatch(context, surface, bindings, batch);
  } catch (error) {
    surfaces.delete(surfaceKey);
    throw error;
  }
  let queue = Promise.resolve();

  const handle: WebMcpExportHandle = {
    supported: true,
    get toolNames() {
      return Object.freeze([...batch.toolNames]);
    },
    refresh() {
      const operation = queue.then(async () => {
        if (disposed) throw new TypeError("The WebMCP exporter is disposed");
        abortBatch(batch);
        batch = { controllers: [], toolNames: [] };
        await populateBatch(context, surface, bindings, batch);
      });
      queue = operation.catch(() => {});
      return operation;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      abortBatch(batch);
      batch = { controllers: [], toolNames: [] };
      surfaces.delete(surfaceKey);
    },
  };
  return handle;
}
