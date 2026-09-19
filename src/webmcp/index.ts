import type {
  AgentActionFailureResult,
  AgentActionSnapshot,
  AgentSnapshot,
} from "../types.js";
import type {
  InstrumentedWebMcpExportHandle,
  WebMcpExportOptions,
  WebMcpModelContext,
  WebMcpSurface,
  WebMcpTool,
  WebMcpToolBinding,
  WebMcpToolDescriptor,
  WebMcpToolRegistrationObservation,
} from "./types.js";
import { capturePortableSchema } from "../portable-schema.js";
import { createWebMcpToolDescriptor } from "./descriptor.js";

export type * from "./types.js";
export * from "./declarative.js";

const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~-]{1,128}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const MAX_DESCRIPTION_LENGTH = 500;

interface ModelContextDocument extends Document {
  modelContext?: WebMcpModelContext;
}

interface ResolvedBinding {
  binding: WebMcpToolBinding;
  action: AgentActionSnapshot;
}

interface RegistrationBatch {
  generation: number;
  controllers: AbortController[];
  toolNames: string[];
  toolDescriptors: WebMcpToolDescriptor[];
  toolObservations: WebMcpToolRegistrationObservation[];
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
    if (action.inputSchema) capturePortableSchema(action.inputSchema);
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
  descriptor: WebMcpToolDescriptor,
): WebMcpTool {
  const { binding, action } = resolved;
  return {
    ...descriptor,
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
      const descriptor = createWebMcpToolDescriptor(item.binding, item.action);
      const tool = createTool(surface, snapshot, item, descriptor);
      await context.registerTool(tool, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        throw abortError();
      }
      batch.toolNames.push(item.binding.name);
      batch.toolDescriptors.push(descriptor);
      batch.toolObservations.push(Object.freeze({
        descriptor,
        elementId: item.binding.elementId,
        action: item.binding.action,
        surfaceId: snapshot.surfaceId,
        revision: snapshot.revision,
        generation: batch.generation,
      }));
    }
  } catch (error) {
    abortBatch(batch);
    batch.controllers.length = 0;
    batch.toolNames.length = 0;
    batch.toolDescriptors.length = 0;
    batch.toolObservations.length = 0;
    throw error;
  }
}

function unsupportedHandle(): InstrumentedWebMcpExportHandle {
  return {
    supported: false,
    toolNames: Object.freeze([]),
    toolDescriptors: Object.freeze([]),
    toolObservations: Object.freeze([]),
    async refresh() {},
    dispose() {},
  };
}

export async function exportAgentSurfaceToWebMcp(
  surface: WebMcpSurface,
  options: WebMcpExportOptions,
): Promise<InstrumentedWebMcpExportHandle> {
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
  let batch: RegistrationBatch = {
    generation: 1,
    controllers: [],
    toolNames: [],
    toolDescriptors: [],
    toolObservations: [],
  };
  try {
    await populateBatch(context, surface, bindings, batch);
  } catch (error) {
    surfaces.delete(surfaceKey);
    throw error;
  }
  let queue = Promise.resolve();

  const handle: InstrumentedWebMcpExportHandle = {
    supported: true,
    get toolNames() {
      return Object.freeze([...batch.toolNames]);
    },
    get toolDescriptors() {
      return Object.freeze([...batch.toolDescriptors]);
    },
    get toolObservations() {
      return Object.freeze([...batch.toolObservations]);
    },
    refresh() {
      const operation = queue.then(async () => {
        if (disposed) throw new TypeError("The WebMCP exporter is disposed");
        const generation = batch.generation + 1;
        abortBatch(batch);
        batch = {
          generation,
          controllers: [],
          toolNames: [],
          toolDescriptors: [],
          toolObservations: [],
        };
        await populateBatch(context, surface, bindings, batch);
      });
      queue = operation.catch(() => {});
      return operation;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      abortBatch(batch);
      batch = {
        generation: batch.generation,
        controllers: [],
        toolNames: [],
        toolDescriptors: [],
        toolObservations: [],
      };
      surfaces.delete(surfaceKey);
    },
  };
  return handle;
}
