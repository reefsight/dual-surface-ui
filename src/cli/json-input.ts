import type { CanonicalJson } from "../delta/canonical.js";

export const MAX_CLI_INPUT_BYTES = 8_388_608;
export const MAX_CLI_JSON_DEPTH = 64;
export const MAX_CLI_JSON_NODES = 250_000;
export const MAX_CLI_JSON_PROPERTIES = 100_000;
export const MAX_CLI_JSON_STRING_LENGTH = 32_768;
export const MAX_CLI_JSON_CHARACTERS = 8_388_608;

export type CliJsonInputRejectReason =
  | "input_too_large"
  | "invalid_utf8"
  | "invalid_json"
  | "duplicate_key"
  | "budget_exceeded"
  | "secret_detected";

export interface CliJsonInputBudget {
  readonly maxBytes?: number;
  readonly maxDepth?: number;
  readonly maxNodes?: number;
  readonly maxProperties?: number;
  readonly maxStringLength?: number;
  readonly maxCharacters?: number;
}

export class CliJsonInputError extends TypeError {
  readonly reason: CliJsonInputRejectReason;

  constructor(reason: CliJsonInputRejectReason) {
    super("Invalid CLI JSON input");
    this.name = "CliJsonInputError";
    this.reason = reason;
  }
}

interface ResolvedBudget {
  readonly maxBytes: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxProperties: number;
  readonly maxStringLength: number;
  readonly maxCharacters: number;
}

const reject = (reason: CliJsonInputRejectReason): never => {
  throw new CliJsonInputError(reason);
};

const budgetValue = (value: number | undefined, fallback: number): number => {
  const resolved = value ?? fallback;
  if (
    !Number.isSafeInteger(resolved) ||
    resolved < 0 ||
    resolved > fallback
  ) {
    reject("budget_exceeded");
  }
  return resolved;
};

const resolveBudget = (budget: CliJsonInputBudget): ResolvedBudget => ({
  maxBytes: budgetValue(budget.maxBytes, MAX_CLI_INPUT_BYTES),
  maxDepth: budgetValue(budget.maxDepth, MAX_CLI_JSON_DEPTH),
  maxNodes: budgetValue(budget.maxNodes, MAX_CLI_JSON_NODES),
  maxProperties: budgetValue(budget.maxProperties, MAX_CLI_JSON_PROPERTIES),
  maxStringLength: budgetValue(
    budget.maxStringLength,
    MAX_CLI_JSON_STRING_LENGTH,
  ),
  maxCharacters: budgetValue(budget.maxCharacters, MAX_CLI_JSON_CHARACTERS),
});

const hasUtf8Bom = (bytes: Uint8Array): boolean =>
  bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;

const isWhitespace = (character: string | undefined): boolean =>
  character === " " || character === "\t" || character === "\n" || character === "\r";

const isDigit = (character: string | undefined): boolean =>
  character !== undefined && character >= "0" && character <= "9";

const assertScalarString = (value: string): void => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) reject("invalid_json");
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      reject("invalid_json");
    }
  }
};

class StrictJsonParser {
  readonly #text: string;
  readonly #budget: ResolvedBudget;
  #index = 0;
  #nodes = 0;
  #properties = 0;
  #characters = 0;

  constructor(text: string, budget: ResolvedBudget) {
    this.#text = text;
    this.#budget = budget;
  }

  parse(): CanonicalJson {
    this.#skipWhitespace();
    const value = this.#parseValue(0);
    this.#skipWhitespace();
    if (this.#index !== this.#text.length) reject("invalid_json");
    return value;
  }

  #parseValue(depth: number): CanonicalJson {
    if (depth > this.#budget.maxDepth || ++this.#nodes > this.#budget.maxNodes) {
      reject("budget_exceeded");
    }
    const character = this.#text[this.#index];
    if (character === '"') return this.#parseString();
    if (character === "{") return this.#parseObject(depth);
    if (character === "[") return this.#parseArray(depth);
    if (character === "t") return this.#parseLiteral("true", true);
    if (character === "f") return this.#parseLiteral("false", false);
    if (character === "n") return this.#parseLiteral("null", null);
    if (character === "-" || isDigit(character)) return this.#parseNumber();
    return reject("invalid_json");
  }

  #parseLiteral<T extends boolean | null>(token: string, value: T): T {
    if (this.#text.slice(this.#index, this.#index + token.length) !== token) {
      reject("invalid_json");
    }
    this.#index += token.length;
    return value;
  }

  #parseNumber(): number {
    const start = this.#index;
    if (this.#text[this.#index] === "-") this.#index += 1;
    if (this.#text[this.#index] === "0") {
      this.#index += 1;
      if (isDigit(this.#text[this.#index])) reject("invalid_json");
    } else {
      if (!isDigit(this.#text[this.#index]) || this.#text[this.#index] === "0") {
        reject("invalid_json");
      }
      while (isDigit(this.#text[this.#index])) this.#index += 1;
    }
    if (this.#text[this.#index] === ".") {
      this.#index += 1;
      if (!isDigit(this.#text[this.#index])) reject("invalid_json");
      while (isDigit(this.#text[this.#index])) this.#index += 1;
    }
    if (this.#text[this.#index] === "e" || this.#text[this.#index] === "E") {
      this.#index += 1;
      if (this.#text[this.#index] === "+" || this.#text[this.#index] === "-") {
        this.#index += 1;
      }
      if (!isDigit(this.#text[this.#index])) reject("invalid_json");
      while (isDigit(this.#text[this.#index])) this.#index += 1;
    }
    const token = this.#text.slice(start, this.#index);
    const value = Number(token);
    if (!Number.isFinite(value)) reject("invalid_json");
    return Object.is(value, -0) ? 0 : value;
  }

  #parseString(): string {
    const start = this.#index;
    this.#index += 1;
    let closed = false;
    while (this.#index < this.#text.length) {
      const character = this.#text[this.#index];
      if (character === '"') {
        this.#index += 1;
        closed = true;
        break;
      }
      if (character === "\\") {
        this.#index += 1;
        const escape = this.#text[this.#index];
        if (escape === "u") {
          const hex = this.#text.slice(this.#index + 1, this.#index + 5);
          if (!/^[0-9A-Fa-f]{4}$/.test(hex)) reject("invalid_json");
          this.#index += 5;
          continue;
        }
        if (!escape || !'"\\/bfnrt'.includes(escape)) reject("invalid_json");
        this.#index += 1;
        continue;
      }
      if (character === undefined || character.charCodeAt(0) <= 0x1f) {
        reject("invalid_json");
      }
      this.#index += 1;
    }
    if (!closed) reject("invalid_json");
    let value: string;
    try {
      value = JSON.parse(this.#text.slice(start, this.#index)) as string;
    } catch {
      return reject("invalid_json");
    }
    assertScalarString(value);
    if (value.length > this.#budget.maxStringLength) reject("budget_exceeded");
    this.#characters += value.length;
    if (this.#characters > this.#budget.maxCharacters) reject("budget_exceeded");
    return value;
  }

  #parseObject(depth: number): CanonicalJson {
    this.#index += 1;
    this.#skipWhitespace();
    const result: Record<string, CanonicalJson> = Object.create(null) as Record<
      string,
      CanonicalJson
    >;
    const keys = new Set<string>();
    if (this.#text[this.#index] === "}") {
      this.#index += 1;
      return Object.freeze(result);
    }
    while (this.#index < this.#text.length) {
      if (this.#text[this.#index] !== '"') reject("invalid_json");
      const key = this.#parseString();
      if (keys.has(key)) reject("duplicate_key");
      keys.add(key);
      this.#properties += 1;
      if (this.#properties > this.#budget.maxProperties) reject("budget_exceeded");
      this.#skipWhitespace();
      if (this.#text[this.#index] !== ":") reject("invalid_json");
      this.#index += 1;
      this.#skipWhitespace();
      const value = this.#parseValue(depth + 1);
      Object.defineProperty(result, key, {
        value,
        enumerable: true,
        writable: false,
        configurable: false,
      });
      this.#skipWhitespace();
      const separator = this.#text[this.#index];
      if (separator === "}") {
        this.#index += 1;
        return Object.freeze(result);
      }
      if (separator !== ",") reject("invalid_json");
      this.#index += 1;
      this.#skipWhitespace();
    }
    return reject("invalid_json");
  }

  #parseArray(depth: number): CanonicalJson {
    this.#index += 1;
    this.#skipWhitespace();
    const result: CanonicalJson[] = [];
    if (this.#text[this.#index] === "]") {
      this.#index += 1;
      return Object.freeze(result);
    }
    while (this.#index < this.#text.length) {
      result.push(this.#parseValue(depth + 1));
      this.#skipWhitespace();
      const separator = this.#text[this.#index];
      if (separator === "]") {
        this.#index += 1;
        return Object.freeze(result);
      }
      if (separator !== ",") reject("invalid_json");
      this.#index += 1;
      this.#skipWhitespace();
    }
    return reject("invalid_json");
  }

  #skipWhitespace(): void {
    while (isWhitespace(this.#text[this.#index])) this.#index += 1;
  }
}

/** Parses one bounded JSON value without invoking object behavior. */
export const parseCliJsonInput = (
  bytes: Uint8Array,
  budget: CliJsonInputBudget = {},
): CanonicalJson => {
  const resolved = resolveBudget(budget);
  let byteLength: number;
  try {
    byteLength = bytes.byteLength;
  } catch {
    return reject("invalid_json");
  }
  if (byteLength > resolved.maxBytes) reject("input_too_large");
  if (hasUtf8Bom(bytes)) reject("invalid_utf8");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return reject("invalid_utf8");
  }
  return new StrictJsonParser(text, resolved).parse();
};
