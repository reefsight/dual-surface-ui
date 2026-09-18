const MAX_SCHEMA_DEPTH = 20;
const MAX_SCHEMA_NODES = 1_000;
const MAX_SCHEMA_LENGTH = 32_768;

function invalidPortableSchema(): never {
  throw new TypeError("WebMCP inputSchema must be portable JSON Schema");
}

function captureValue(
  value: unknown,
  depth: number,
  stack: Set<object>,
  budget: { nodes: number; characters: number },
): unknown {
  budget.nodes += 1;
  if (budget.nodes > MAX_SCHEMA_NODES || depth > MAX_SCHEMA_DEPTH) {
    return invalidPortableSchema();
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
    if (!Number.isFinite(value)) return invalidPortableSchema();
    consumeCharacters(budget, String(value).length);
    return value;
  }
  if (typeof value !== "object") return invalidPortableSchema();
  if (stack.has(value)) return invalidPortableSchema();
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
      return invalidPortableSchema();
    }
    const items: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        return invalidPortableSchema();
      }
      items.push(
        captureValue(descriptor.value, depth + 1, stack, budget),
      );
    }
    clone = items;
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return invalidPortableSchema();
    }
    const record: Record<string, unknown> = Object.create(null);
    const keys = Reflect.ownKeys(value);
    consumeCharacters(budget, 2 + Math.max(0, keys.length - 1));
    for (const key of keys) {
      if (typeof key === "symbol" || key === "$ref" || key === "$dynamicRef") {
        return invalidPortableSchema();
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        return invalidPortableSchema();
      }
      consumeCharacters(budget, jsonStringLength(key) + 1);
      Object.defineProperty(record, key, {
        configurable: true,
        enumerable: true,
        value: captureValue(descriptor.value, depth + 1, stack, budget),
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
  if (budget.characters > MAX_SCHEMA_LENGTH) return invalidPortableSchema();
}

export function capturePortableSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  let clone: unknown;
  try {
    clone = captureValue(schema, 0, new Set(), {
      nodes: 0,
      characters: 0,
    });
  } catch (error) {
    if (
      error instanceof TypeError &&
      error.message === "WebMCP inputSchema must be portable JSON Schema"
    ) {
      throw error;
    }
    return invalidPortableSchema();
  }
  if (!clone || Array.isArray(clone) || typeof clone !== "object") {
    return invalidPortableSchema();
  }
  if (JSON.stringify(clone).length > MAX_SCHEMA_LENGTH) {
    return invalidPortableSchema();
  }
  return clone as Record<string, unknown>;
}
