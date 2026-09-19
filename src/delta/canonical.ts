import type {
  AgentActionSnapshot,
  AgentBounds,
  AgentElementSnapshot,
  AgentElementState,
  AgentIdempotency,
  AgentRisk,
  AgentSnapshot,
} from "../types.js";
import { capturePortableSchema } from "../portable-schema.js";

export const MAX_DELTA_SNAPSHOT_NODES = 4_096;
export const MAX_DELTA_OPERATIONS = 512;
export const MAX_DELTA_ACTIONS_PER_NODE = 64;
export const MAX_DELTA_TOTAL_ACTIONS = 1_024;
export const MAX_DELTA_CAPABILITIES = 256;
export const MAX_DELTA_SNAPSHOT_BYTES = 1_048_576;
export const MAX_DELTA_BYTES = 1_048_576;
export const MAX_DELTA_SCHEMA_DEPTH = 20;
export const MAX_DELTA_SCHEMA_NODES = 1_000;
export const MAX_DELTA_SCHEMA_BYTES = 32_768;

const MAX_CAPTURE_DEPTH = 64;
const MAX_CAPTURE_NODES = 100_000;
const MAX_CAPTURE_CHARACTERS = 1_048_576;
const MAX_STRING_LENGTH = 8_192;
const MAX_PROPERTIES_PER_OBJECT = 4_096;
const MAX_CONDITIONS_PER_ACTION = 256;

export type CanonicalJson =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJson[]
  | { readonly [key: string]: CanonicalJson };

export type ReadonlyDeep<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly ReadonlyDeep<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: ReadonlyDeep<T[Key]> }
      : T;

export interface DescriptorCaptureBudget {
  readonly maxDepth?: number;
  readonly maxNodes?: number;
  readonly maxCharacters?: number;
  readonly maxStringLength?: number;
  readonly maxPropertiesPerObject?: number;
}

export class DeltaCaptureError extends TypeError {
  readonly reason: "invalid" | "budget_exceeded";

  constructor(reason: "invalid" | "budget_exceeded" = "invalid") {
    super("Invalid delta input");
    this.name = "DeltaCaptureError";
    this.reason = reason;
  }
}

function invalid(): never {
  throw new DeltaCaptureError();
}

function budgetExceeded(): never {
  throw new DeltaCaptureError("budget_exceeded");
}

const compareCodeUnits = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const utf8Length = (value: string): number => new TextEncoder().encode(value).byteLength;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasIntrinsicPrototype = (
  prototype: object | null,
  name: "Object" | "Array",
): boolean => {
  if (prototype === null) return name === "Object";
  const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor");
  if (
    !constructor ||
    !("value" in constructor) ||
    typeof constructor.value !== "function" ||
    constructor.value.name !== name
  ) return false;
  const parent = Object.getPrototypeOf(prototype);
  return name === "Object"
    ? parent === null
    : hasIntrinsicPrototype(parent, "Object");
};

const assertBudgetValue = (value: number | undefined, fallback: number): number => {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 0) invalid();
  return result;
};

/**
 * Captures untrusted JSON-shaped input without reading properties through
 * ordinary property access. The result is detached, recursively key-sorted,
 * and deeply frozen.
 */
export const descriptorSafeCaptureJson = (
  value: unknown,
  budget: DescriptorCaptureBudget = {},
): CanonicalJson => {
  const maxDepth = assertBudgetValue(budget.maxDepth, MAX_CAPTURE_DEPTH);
  const maxNodes = assertBudgetValue(budget.maxNodes, MAX_CAPTURE_NODES);
  const maxCharacters = assertBudgetValue(
    budget.maxCharacters,
    MAX_CAPTURE_CHARACTERS,
  );
  const maxStringLength = assertBudgetValue(
    budget.maxStringLength,
    MAX_STRING_LENGTH,
  );
  const maxPropertiesPerObject = assertBudgetValue(
    budget.maxPropertiesPerObject,
    MAX_PROPERTIES_PER_OBJECT,
  );
  let nodes = 0;
  let characters = 0;
  const ancestors = new Set<object>();

  const countString = (text: string): string => {
    if (text.length > maxStringLength) budgetExceeded();
    characters += text.length;
    if (characters > maxCharacters) budgetExceeded();
    return text;
  };

  const capture = (current: unknown, depth: number): CanonicalJson => {
    if (depth > maxDepth || ++nodes > maxNodes) budgetExceeded();
    if (
      current === null ||
      typeof current === "boolean" ||
      typeof current === "string"
    ) {
      return typeof current === "string" ? countString(current) : current;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) invalid();
      return Object.is(current, -0) ? 0 : current;
    }
    if (typeof current !== "object") invalid();
    if (ancestors.has(current)) invalid();
    ancestors.add(current);
    try {
      const keys = Reflect.ownKeys(current);
      if (keys.some((key) => typeof key === "symbol")) invalid();

      if (Array.isArray(current)) {
        if (!hasIntrinsicPrototype(Object.getPrototypeOf(current), "Array")) invalid();
        const lengthDescriptor = Object.getOwnPropertyDescriptor(current, "length");
        if (
          !lengthDescriptor ||
          !("value" in lengthDescriptor) ||
          !Number.isSafeInteger(lengthDescriptor.value) ||
          lengthDescriptor.value < 0
        ) {
          invalid();
        }
        if (lengthDescriptor.value > maxNodes) budgetExceeded();
        if (keys.length !== lengthDescriptor.value + 1) invalid();
        const result: CanonicalJson[] = [];
        for (let index = 0; index < lengthDescriptor.value; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
          if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) invalid();
          result.push(capture(descriptor.value, depth + 1));
        }
        return Object.freeze(result);
      }

      const prototype = Object.getPrototypeOf(current);
      if (!hasIntrinsicPrototype(prototype, "Object")) invalid();
      if (keys.length > maxPropertiesPerObject) budgetExceeded();
      const stringKeys = keys as string[];
      const result: Record<string, CanonicalJson> = Object.create(null) as Record<
        string,
        CanonicalJson
      >;
      for (const key of stringKeys.sort(compareCodeUnits)) {
        countString(key);
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) invalid();
        Object.defineProperty(result, key, {
          value: capture(descriptor.value, depth + 1),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return Object.freeze(result);
    } finally {
      ancestors.delete(current);
    }
  };

  return capture(value, 0);
};

/** Deep-freezes descriptor-safe data without invoking accessors. */
export const deepFreeze = <T>(value: T): ReadonlyDeep<T> => {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return value as ReadonlyDeep<T>;
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) deepFreeze(descriptor.value);
  }
  return Object.freeze(value) as ReadonlyDeep<T>;
};

export const deepFreezeJson = <T>(value: T): T => deepFreeze(value) as T;

const assertOnlyKeys = (record: Record<string, unknown>, allowed: readonly string[]): void => {
  const allowedSet = new Set(allowed);
  if (Object.keys(record).some((key) => !allowedSet.has(key))) invalid();
};

const required = (record: Record<string, unknown>, key: string): unknown => {
  if (!Object.hasOwn(record, key)) invalid();
  return record[key];
};

const optional = (record: Record<string, unknown>, key: string): unknown =>
  Object.hasOwn(record, key) ? record[key] : undefined;

const stringValue = (
  value: unknown,
  options: { readonly nonEmpty?: boolean; readonly max?: number } = {},
): string => {
  if (typeof value !== "string") invalid();
  if (options.nonEmpty === true && value.length === 0) invalid();
  if (value.length > (options.max ?? MAX_STRING_LENGTH)) budgetExceeded();
  return value;
};

const optionalBoolean = (value: unknown): boolean | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") invalid();
  return value;
};

const finiteNumber = (value: unknown, nonNegative = false): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || (nonNegative && value < 0)) {
    invalid();
  }
  return Object.is(value, -0) ? 0 : value;
};

const recordValue = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) invalid();
  return value;
};

const arrayValue = (value: unknown): readonly unknown[] => {
  if (!Array.isArray(value)) invalid();
  return value;
};

const uniqueSortedStrings = (
  value: unknown,
  limit: number,
): string[] => {
  const source = arrayValue(value);
  if (source.length > limit) budgetExceeded();
  const result = source.map((entry) => stringValue(entry, { nonEmpty: true }));
  if (new Set(result).size !== result.length) invalid();
  return result.sort(compareCodeUnits);
};

const validateSchemaComplexity = (schema: unknown): Record<string, unknown> => {
  const root = capturePortableSchema(recordValue(schema));
  let nodes = 0;
  const visit = (value: unknown, depth: number): void => {
    if (depth > MAX_DELTA_SCHEMA_DEPTH || ++nodes > MAX_DELTA_SCHEMA_NODES) {
      budgetExceeded();
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (isRecord(value)) {
      for (const item of Object.values(value)) visit(item, depth + 1);
    }
  };
  visit(root, 0);
  if (utf8Length(JSON.stringify(root)) > MAX_DELTA_SCHEMA_BYTES) budgetExceeded();
  return root;
};

const canonicalState = (value: unknown): AgentElementState => {
  const source = recordValue(value);
  assertOnlyKeys(source, [
    "disabled",
    "checked",
    "expanded",
    "selected",
    "value",
    "valuePresent",
    "sensitive",
  ]);
  const checked = optionalBoolean(optional(source, "checked"));
  const disabled = optionalBoolean(optional(source, "disabled"));
  const expanded = optionalBoolean(optional(source, "expanded"));
  const selected = optionalBoolean(optional(source, "selected"));
  const valueText = optional(source, "value");
  const valuePresent = optionalBoolean(optional(source, "valuePresent"));
  const sensitive = optionalBoolean(optional(source, "sensitive"));
  if (sensitive === true && valueText !== undefined) invalid();
  return {
    ...(checked !== undefined ? { checked } : {}),
    ...(disabled !== undefined ? { disabled } : {}),
    ...(expanded !== undefined ? { expanded } : {}),
    ...(selected !== undefined ? { selected } : {}),
    ...(sensitive !== undefined ? { sensitive } : {}),
    ...(valueText !== undefined ? { value: stringValue(valueText) } : {}),
    ...(valuePresent !== undefined ? { valuePresent } : {}),
  };
};

const canonicalBounds = (value: unknown): AgentBounds => {
  const source = recordValue(value);
  assertOnlyKeys(source, ["x", "y", "width", "height"]);
  return {
    x: finiteNumber(required(source, "x")),
    y: finiteNumber(required(source, "y")),
    width: finiteNumber(required(source, "width"), true),
    height: finiteNumber(required(source, "height"), true),
  };
};

const RISKS = new Set<AgentRisk>([
  "read",
  "write",
  "consequential",
  "destructive",
  "credential",
]);
const IDEMPOTENCY = new Set<AgentIdempotency>(["none", "keyed", "safe-retry"]);

const canonicalAction = (value: unknown): AgentActionSnapshot => {
  const source = recordValue(value);
  assertOnlyKeys(source, [
    "name",
    "description",
    "risk",
    "inputSchema",
    "outputSchema",
    "preconditions",
    "effects",
    "requiresConfirmation",
    "idempotency",
  ]);
  const name = stringValue(required(source, "name"), { nonEmpty: true, max: 64 });
  const risk = required(source, "risk");
  if (typeof risk !== "string" || !RISKS.has(risk as AgentRisk)) invalid();
  const description = optional(source, "description");
  const inputSchema = optional(source, "inputSchema");
  const outputSchema = optional(source, "outputSchema");
  const preconditions = optional(source, "preconditions");
  const effects = optional(source, "effects");
  const requiresConfirmation = optionalBoolean(optional(source, "requiresConfirmation"));
  const idempotency = optional(source, "idempotency");
  if (idempotency !== undefined) {
    if (typeof idempotency !== "string" || !IDEMPOTENCY.has(idempotency as AgentIdempotency)) {
      invalid();
    }
  }
  return {
    name,
    ...(description !== undefined
      ? { description: stringValue(description, { max: 500 }) }
      : {}),
    risk: risk as AgentRisk,
    ...(inputSchema !== undefined
      ? { inputSchema: validateSchemaComplexity(inputSchema) }
      : {}),
    ...(outputSchema !== undefined
      ? { outputSchema: validateSchemaComplexity(outputSchema) }
      : {}),
    ...(preconditions !== undefined
      ? {
          preconditions: uniqueSortedStrings(
            preconditions,
            MAX_CONDITIONS_PER_ACTION,
          ),
        }
      : {}),
    ...(effects !== undefined
      ? { effects: uniqueSortedStrings(effects, MAX_CONDITIONS_PER_ACTION) }
      : {}),
    ...(requiresConfirmation !== undefined ? { requiresConfirmation } : {}),
    ...(idempotency !== undefined
      ? { idempotency: idempotency as AgentIdempotency }
      : {}),
  };
};

interface ActionCounter {
  count: number;
}

const canonicalCapturedNode = (
  value: unknown,
  actionCounter: ActionCounter,
): AgentElementSnapshot => {
  const source = recordValue(value);
  assertOnlyKeys(source, ["id", "role", "name", "description", "state", "actions", "bounds"]);
  const actionsSource = arrayValue(required(source, "actions"));
  if (actionsSource.length > MAX_DELTA_ACTIONS_PER_NODE) budgetExceeded();
  actionCounter.count += actionsSource.length;
  if (actionCounter.count > MAX_DELTA_TOTAL_ACTIONS) budgetExceeded();
  const actions = actionsSource.map(canonicalAction);
  if (new Set(actions.map((action) => action.name)).size !== actions.length) invalid();
  actions.sort((left, right) => compareCodeUnits(left.name, right.name));
  const description = optional(source, "description");
  const bounds = optional(source, "bounds");
  return {
    id: stringValue(required(source, "id"), { nonEmpty: true }),
    role: stringValue(required(source, "role"), { nonEmpty: true }),
    name: stringValue(required(source, "name")),
    ...(description !== undefined ? { description: stringValue(description) } : {}),
    state: canonicalState(required(source, "state")),
    actions,
    ...(bounds !== undefined ? { bounds: canonicalBounds(bounds) } : {}),
  };
};

const canonicalSnapshots = new WeakSet<object>();
const canonicalNodes = new WeakSet<object>();

export const canonicalizeNode = (
  node: AgentElementSnapshot,
): AgentElementSnapshot => {
  if (canonicalNodes.has(node)) return node;
  const captured = descriptorSafeCaptureJson(node);
  const result = canonicalCapturedNode(captured, { count: 0 });
  deepFreeze(result);
  canonicalNodes.add(result);
  return result;
};

export const captureCanonicalSnapshot = (value: unknown): AgentSnapshot => {
  if (isRecord(value) && canonicalSnapshots.has(value)) return value as unknown as AgentSnapshot;
  const captured = descriptorSafeCaptureJson(value, {
    maxDepth: MAX_CAPTURE_DEPTH,
    maxNodes: MAX_CAPTURE_NODES,
    maxCharacters: MAX_CAPTURE_CHARACTERS,
    maxStringLength: MAX_STRING_LENGTH,
    maxPropertiesPerObject: MAX_PROPERTIES_PER_OBJECT,
  });
  const source = recordValue(captured);
  assertOnlyKeys(source, [
    "schemaVersion",
    "surfaceId",
    "revision",
    "title",
    "url",
    "generatedAt",
    "focusedElementId",
    "capabilities",
    "nodes",
  ]);
  if (required(source, "schemaVersion") !== "0.1") invalid();
  const nodesSource = arrayValue(required(source, "nodes"));
  if (nodesSource.length > MAX_DELTA_SNAPSHOT_NODES) budgetExceeded();
  const counter: ActionCounter = { count: 0 };
  const nodes = nodesSource.map((node) => canonicalCapturedNode(node, counter));
  if (new Set(nodes.map((node) => node.id)).size !== nodes.length) invalid();
  nodes.sort((left, right) => compareCodeUnits(left.id, right.id));
  const capabilities = uniqueSortedStrings(
    required(source, "capabilities"),
    MAX_DELTA_CAPABILITIES,
  );
  const focusedElementId = optional(source, "focusedElementId");
  let focused: string | undefined;
  if (focusedElementId !== undefined) {
    focused = stringValue(focusedElementId, { nonEmpty: true });
    if (!nodes.some((node) => node.id === focused)) invalid();
  }
  const result: AgentSnapshot = {
    schemaVersion: "0.1",
    surfaceId: stringValue(required(source, "surfaceId"), { nonEmpty: true }),
    revision: stringValue(required(source, "revision"), { nonEmpty: true }),
    title: stringValue(required(source, "title")),
    url: stringValue(required(source, "url")),
    generatedAt: stringValue(required(source, "generatedAt"), { nonEmpty: true }),
    ...(focused !== undefined ? { focusedElementId: focused } : {}),
    capabilities,
    nodes,
  };
  const text = JSON.stringify(result);
  if (utf8Length(text) > MAX_DELTA_SNAPSHOT_BYTES) budgetExceeded();
  deepFreeze(result);
  for (const node of nodes) canonicalNodes.add(node);
  canonicalSnapshots.add(result);
  return result;
};

export const canonicalSnapshotText = (snapshot: AgentSnapshot): string => {
  const canonical = captureCanonicalSnapshot(snapshot);
  const text = JSON.stringify(canonical);
  if (utf8Length(text) > MAX_DELTA_SNAPSHOT_BYTES) budgetExceeded();
  return text;
};

export const digestCanonicalSnapshot = async (
  snapshot: AgentSnapshot,
): Promise<`sha256:${string}`> => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) invalid();
  try {
    const digest = await subtle.digest(
      "SHA-256",
      new TextEncoder().encode(canonicalSnapshotText(snapshot)),
    );
    const hex = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    return `sha256:${hex}`;
  } catch {
    invalid();
  }
};
