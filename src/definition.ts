import type {
  AgentActionDefinition,
  AgentActionSnapshot,
  AgentElementDefinition,
  AgentIdempotency,
  AgentRisk,
} from "./types.js";
import { preflightActionSchemas } from "./validation.js";
import { capturePortableSchema } from "./portable-schema.js";
import {
  AgentInputValidationError,
  AgentOutputValidationError,
} from "./errors.js";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const RISKS = new Set<AgentRisk>([
  "read",
  "write",
  "consequential",
  "destructive",
  "credential",
]);
const IDEMPOTENCY = new Set<AgentIdempotency>([
  "none",
  "keyed",
  "safe-retry",
]);
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_ACTION_NAME_LENGTH = 64;
const MAX_ACTIONS = 64;
const MAX_CONDITIONS = 32;
const MAX_SCHEMA_DEPTH = 20;
const MAX_SCHEMA_NODES = 1_000;
const MAX_SCHEMA_LENGTH = 32_768;
const ELEMENT_KEYS = new Set(["id", "description", "actions"]);
const ACTION_KEYS = new Set([
  "description",
  "risk",
  "inputSchema",
  "outputSchema",
  "preconditions",
  "effects",
  "requiresConfirmation",
  "idempotency",
  "handler",
  "webMcpName",
]);

interface CapturedAction {
  definition: AgentActionDefinition;
  webMcpName?: string;
}

export interface CapturedDomainExposure {
  action: string;
  name: string;
  risk: AgentRisk;
}

export interface CapturedDomainElement {
  definition: AgentElementDefinition;
  exposures: readonly CapturedDomainExposure[];
}

function invalidElement(): never {
  throw new TypeError("Invalid agent element definition");
}

function invalidAction(): never {
  throw new TypeError("Invalid agent action definition");
}

function invalidSchema(): never {
  throw new TypeError("Invalid agent action schema");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function dataEntries(
  value: Record<string, unknown>,
  invalid: () => never,
): Array<[string, unknown]> {
  const entries: Array<[string, unknown]> = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol") return invalid();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) return invalid();
    entries.push([key, descriptor.value]);
  }
  return entries;
}

function registeredDataProperty(
  value: object,
  key: string,
  invalid: () => never,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return undefined;
  if (!("value" in descriptor) || !descriptor.enumerable) return invalid();
  return descriptor.value;
}

function registeredEntries(
  value: object,
  invalid: () => never,
): Array<[string, unknown]> {
  const entries: Array<[string, unknown]> = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable) continue;
    if (!("value" in descriptor)) return invalid();
    entries.push([key, descriptor.value]);
  }
  return entries;
}

function cloneRegisteredAction(value: object): AgentActionDefinition {
  const clone: Record<string, unknown> = Object.create(null);
  const seen = new WeakMap<object, object>([[value, clone]]);
  for (const [key, item] of registeredEntries(value, invalidAction)) {
    Object.defineProperty(clone, key, {
      configurable: true,
      enumerable: true,
      value: cloneRegisteredMetadata(item, seen),
      writable: true,
    });
  }
  return clone as AgentActionDefinition;
}

export function cloneRegisteredMetadata<T>(
  value: T,
  seen = new WeakMap<object, object>(),
): T {
  if (Array.isArray(value)) {
    const existing = seen.get(value);
    if (existing) return existing as T;
    const clone: unknown[] = [];
    seen.set(value, clone);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor) {
        clone.push(undefined);
        continue;
      }
      if (!("value" in descriptor)) return invalidSchema();
      clone.push(cloneRegisteredMetadata(descriptor.value, seen));
    }
    return clone as T;
  }
  if (value && typeof value === "object") {
    const existing = seen.get(value);
    if (existing) return existing as T;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;
    const clone = Object.create(prototype) as Record<string, unknown>;
    seen.set(value, clone);
    for (const [key, item] of registeredEntries(value, invalidSchema)) {
      Object.defineProperty(clone, key, {
        configurable: true,
        enumerable: true,
        value: cloneRegisteredMetadata(item, seen),
        writable: true,
      });
    }
    return clone as T;
  }
  return value;
}

export function captureRegisteredElementDefinition(
  definition: AgentElementDefinition,
): AgentElementDefinition {
  try {
    if (!definition || typeof definition !== "object") return invalidElement();
    const id = registeredDataProperty(definition, "id", invalidElement);
    const description = registeredDataProperty(
      definition,
      "description",
      invalidElement,
    );
    const sourceActions = registeredDataProperty(
      definition,
      "actions",
      invalidElement,
    );
    let actions: Record<string, AgentActionDefinition> | undefined;
    if (sourceActions !== undefined) {
      if (!sourceActions || typeof sourceActions !== "object") {
        return invalidElement();
      }
      actions = Object.create(null);
      for (const [name, sourceAction] of registeredEntries(
        sourceActions,
        invalidAction,
      )) {
        if (!sourceAction || typeof sourceAction !== "object") {
          return invalidAction();
        }
        const cloned = cloneRegisteredAction(sourceAction);
        Object.defineProperty(actions, name, {
          configurable: true,
          enumerable: true,
          value: cloned,
          writable: true,
        });
      }
    }
    return {
      id: id as string,
      ...(description !== undefined
        ? { description: description as string }
        : {}),
      ...(actions ? { actions } : {}),
    };
  } catch (error) {
    if (
      error instanceof TypeError &&
      (error.message === "Invalid agent element definition" ||
        error.message === "Invalid agent action definition" ||
        error.message === "Invalid agent action schema")
    ) {
      throw error;
    }
    return invalidElement();
  }
}

function cloneJsonValue(
  value: unknown,
  depth: number,
  stack: Set<object>,
  budget: { nodes: number; characters: number },
): unknown {
  budget.nodes += 1;
  if (budget.nodes > MAX_SCHEMA_NODES || depth > MAX_SCHEMA_DEPTH) {
    return invalidSchema();
  }
  if (
    value === null ||
    typeof value === "boolean"
  ) {
    consumeCharacters(budget, value === null ? 4 : value ? 4 : 5);
    return value;
  }
  if (typeof value === "string") {
    consumeCharacters(budget, jsonStringLength(value));
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return invalidSchema();
    consumeCharacters(budget, String(value).length);
    return value;
  }
  if (typeof value !== "object") return invalidSchema();
  if (stack.has(value)) return invalidSchema();
  stack.add(value);

  let clone: unknown;
  if (Array.isArray(value)) {
    consumeCharacters(budget, 2 + Math.max(0, value.length - 1));
    if (
      Reflect.ownKeys(value).some(
        (key) =>
          typeof key === "symbol" ||
          (key !== "length" && !/^(0|[1-9]\d*)$/.test(key)),
      )
    ) {
      return invalidSchema();
    }
    const items: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        return invalidSchema();
      }
      items.push(
        cloneJsonValue(descriptor.value, depth + 1, stack, budget),
      );
    }
    clone = items;
  } else {
    if (!isPlainRecord(value)) return invalidSchema();
    const record: Record<string, unknown> = Object.create(null);
    const entries = dataEntries(value, invalidSchema);
    consumeCharacters(budget, 2 + Math.max(0, entries.length - 1));
    for (const [key, item] of entries) {
      consumeCharacters(budget, jsonStringLength(key) + 1);
      Object.defineProperty(record, key, {
        configurable: true,
        enumerable: true,
        value: cloneJsonValue(item, depth + 1, stack, budget),
        writable: true,
      });
    }
    clone = record;
  }
  stack.delete(value);
  return clone;
}

function jsonStringLength(value: string): number {
  let length = 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    length += code === 0x22 || code === 0x5c ? 2 : code <= 0x1f ? 6 : 1;
  }
  return length;
}

function consumeCharacters(
  budget: { characters: number },
  amount: number,
): void {
  budget.characters += amount;
  if (budget.characters > MAX_SCHEMA_LENGTH) return invalidSchema();
}

export function captureAgentSchema(value: unknown): Record<string, unknown> {
  try {
    if (!isPlainRecord(value)) return invalidSchema();
    const clone = cloneJsonValue(value, 0, new Set(), {
      nodes: 0,
      characters: 0,
    });
    if (!isPlainRecord(clone)) return invalidSchema();
    if (JSON.stringify(clone).length > MAX_SCHEMA_LENGTH) {
      return invalidSchema();
    }
    return clone;
  } catch (error) {
    if (
      error instanceof TypeError &&
      error.message === "Invalid agent action schema"
    ) {
      throw error;
    }
    return invalidSchema();
  }
}

function cloneIdentifiers(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_CONDITIONS) {
    return invalidAction();
  }
  if (
    Reflect.ownKeys(value).some(
      (key) =>
        typeof key === "symbol" ||
        (key !== "length" && !/^(0|[1-9]\d*)$/.test(key)),
    )
  ) {
    return invalidAction();
  }
  const identifiers: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      return invalidAction();
    }
    const item = descriptor.value;
    if (typeof item !== "string" || !IDENTIFIER_PATTERN.test(item)) {
      return invalidAction();
    }
    identifiers.push(item);
  }
  if (new Set(identifiers).size !== identifiers.length) return invalidAction();
  return identifiers;
}

function optionalDescription(
  value: unknown,
  required: boolean,
): string | undefined {
  if (value === undefined && !required) return undefined;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    (required && value.trim().length === 0) ||
    value.length > MAX_DESCRIPTION_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return invalidAction();
  }
  return value;
}

function captureAction(
  name: string,
  value: unknown,
  strictDomain: boolean,
): CapturedAction {
  if (!isPlainRecord(value)) return invalidAction();
  const fields = new Map(dataEntries(value, invalidAction));
  if (
    strictDomain &&
    [...fields.keys()].some((key) => !ACTION_KEYS.has(key))
  ) {
    return invalidAction();
  }
  const field = (key: string): unknown => fields.get(key);
  if (
    name.length === 0 ||
    name.length > MAX_ACTION_NAME_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(name) ||
    (strictDomain && !IDENTIFIER_PATTERN.test(name))
  ) {
    return invalidAction();
  }

  const description = optionalDescription(
    field("description"),
    strictDomain,
  );
  const risk = field("risk");
  if (
    (risk !== undefined &&
      (typeof risk !== "string" || !RISKS.has(risk as AgentRisk))) ||
    (strictDomain && risk === undefined)
  ) {
    return invalidAction();
  }
  const idempotency = field("idempotency");
  if (
    idempotency !== undefined &&
    (typeof idempotency !== "string" ||
      !IDEMPOTENCY.has(idempotency as AgentIdempotency))
  ) {
    return invalidAction();
  }
  const confirmation = field("requiresConfirmation");
  if (confirmation !== undefined && typeof confirmation !== "boolean") {
    return invalidAction();
  }
  const handler = field("handler");
  if (handler !== undefined && typeof handler !== "function") {
    return invalidAction();
  }
  if (strictDomain && typeof handler !== "function") return invalidAction();

  const preconditions = cloneIdentifiers(field("preconditions"));
  const effects = cloneIdentifiers(field("effects"));
  if (strictDomain && risk !== "read" && (!effects || effects.length === 0)) {
    return invalidAction();
  }
  if (
    strictDomain &&
    (risk === "consequential" || risk === "destructive") &&
    confirmation !== true
  ) {
    return invalidAction();
  }

  const webMcpName = field("webMcpName");
  if (
    webMcpName !== undefined &&
    (!strictDomain ||
      typeof webMcpName !== "string" ||
      !TOOL_NAME_PATTERN.test(webMcpName))
  ) {
    return invalidAction();
  }

  const inputSchemaValue = field("inputSchema");
  const outputSchemaValue = field("outputSchema");
  const action: AgentActionDefinition = {
    ...(description !== undefined ? { description } : {}),
    ...(risk !== undefined ? { risk: risk as AgentRisk } : {}),
    ...(inputSchemaValue !== undefined
      ? { inputSchema: captureAgentSchema(inputSchemaValue) }
      : {}),
    ...(outputSchemaValue !== undefined
      ? { outputSchema: captureAgentSchema(outputSchemaValue) }
      : {}),
    ...(preconditions ? { preconditions } : {}),
    ...(effects ? { effects } : {}),
    ...(confirmation !== undefined
      ? { requiresConfirmation: confirmation }
      : {}),
    ...(idempotency !== undefined
      ? { idempotency: idempotency as AgentIdempotency }
      : {}),
    ...(typeof handler === "function"
      ? {
          handler:
            handler as NonNullable<AgentActionDefinition["handler"]>,
        }
      : {}),
  };
  preflightActionSchemas({
    ...action,
    name,
    risk: action.risk ?? "write",
  } as AgentActionSnapshot);
  if (typeof webMcpName === "string" && action.inputSchema) {
    capturePortableSchema(action.inputSchema);
  }
  return {
    definition: action,
    ...(typeof webMcpName === "string" ? { webMcpName } : {}),
  };
}

function captureElementDefinition(
  definition: AgentElementDefinition,
  strictDomain: boolean,
): CapturedDomainElement {
  if (!isPlainRecord(definition)) return invalidElement();
  const fields = new Map(dataEntries(definition, invalidElement));
  if (
    strictDomain &&
    [...fields.keys()].some((key) => !ELEMENT_KEYS.has(key))
  ) {
    return invalidElement();
  }
  const id = fields.get("id");
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    id.length > 128 ||
    CONTROL_CHARACTER_PATTERN.test(id) ||
    (strictDomain && !IDENTIFIER_PATTERN.test(id))
  ) {
    return invalidElement();
  }
  const description = optionalDescription(
    fields.get("description"),
    false,
  );
  const actionsValue = fields.get("actions");
  if (actionsValue !== undefined && !isPlainRecord(actionsValue)) {
    return invalidElement();
  }
  if (strictDomain && actionsValue === undefined) return invalidElement();
  const actionEntries = actionsValue
    ? dataEntries(actionsValue, invalidElement)
    : [];
  if (
    actionEntries.length > MAX_ACTIONS ||
    (strictDomain && actionEntries.length === 0)
  ) {
    return invalidElement();
  }
  const actions: Record<string, AgentActionDefinition> = Object.create(null);
  const exposures: CapturedDomainExposure[] = [];
  for (const [name, value] of actionEntries) {
    const captured = captureAction(name, value, strictDomain);
    Object.defineProperty(actions, name, {
      configurable: true,
      enumerable: true,
      value: captured.definition,
      writable: true,
    });
    if (captured.webMcpName) {
      exposures.push({
        action: name,
        name: captured.webMcpName,
        risk: captured.definition.risk!,
      });
    }
  }
  return {
    definition: {
      id,
      ...(description !== undefined ? { description } : {}),
      ...(actionsValue !== undefined ? { actions } : {}),
    },
    exposures,
  };
}

export function captureDomainElementAnnotation(
  definition: AgentElementDefinition,
): CapturedDomainElement {
  try {
    return captureElementDefinition(definition, true);
  } catch (error) {
    if (
      error instanceof AgentInputValidationError ||
      error instanceof AgentOutputValidationError ||
      (error instanceof TypeError &&
        (error.message === "Invalid agent element definition" ||
          error.message === "Invalid agent action definition" ||
          error.message === "Invalid agent action schema" ||
          error.message ===
            "WebMCP inputSchema must be portable JSON Schema"))
    ) {
      throw error;
    }
    return invalidElement();
  }
}
