import { NATIVE_PROTOCOL_LIMITS } from "./schema.js";
import { captureAndValidateNativeProtocolMessage } from "./message-validation.js";
import type { NativeProtocolMessage } from "./types.js";

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const MAX_DEPTH = 64;
const MAX_NODES = 100_000;
const MAX_PROPERTIES = 4_096;
const MAX_STRING_LENGTH = 8_192;

const invalid = (): never => {
  throw new TypeError("Invalid native protocol frame");
};

const isWhitespace = (code: number): boolean =>
  code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
const isDigit = (code: number): boolean => code >= 0x30 && code <= 0x39;
const isNonZeroDigit = (code: number): boolean => code >= 0x31 && code <= 0x39;
const isHex = (code: number): boolean =>
  isDigit(code) ||
  (code >= 0x41 && code <= 0x46) ||
  (code >= 0x61 && code <= 0x66);

const assertWellFormedString = (value: string): void => {
  if (value.length > MAX_STRING_LENGTH) invalid();
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) invalid();
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      invalid();
    }
  }
};

class JsonFrameScanner {
  readonly #text: string;
  #index = 0;
  #nodes = 0;

  constructor(text: string) {
    this.#text = text;
  }

  scan(): void {
    this.#skipWhitespace();
    this.#value(0);
    this.#skipWhitespace();
    if (this.#index !== this.#text.length) invalid();
  }

  #skipWhitespace(): void {
    while (isWhitespace(this.#text.charCodeAt(this.#index))) this.#index += 1;
  }

  #value(depth: number): void {
    this.#nodes += 1;
    if (this.#nodes > MAX_NODES || depth > MAX_DEPTH) invalid();
    const code = this.#text.charCodeAt(this.#index);
    if (code === 0x7b) return this.#object(depth + 1);
    if (code === 0x5b) return this.#array(depth + 1);
    if (code === 0x22) {
      this.#string();
      return;
    }
    if (code === 0x74) return this.#literal("true");
    if (code === 0x66) return this.#literal("false");
    if (code === 0x6e) return this.#literal("null");
    if (code === 0x2d || isDigit(code)) return this.#number();
    invalid();
  }

  #object(depth: number): void {
    this.#index += 1;
    this.#skipWhitespace();
    if (this.#text.charCodeAt(this.#index) === 0x7d) {
      this.#index += 1;
      return;
    }
    const keys = new Set<string>();
    let properties = 0;
    while (true) {
      if (this.#text.charCodeAt(this.#index) !== 0x22) invalid();
      const key = this.#string();
      properties += 1;
      if (properties > MAX_PROPERTIES || keys.has(key)) invalid();
      keys.add(key);
      this.#skipWhitespace();
      if (this.#text.charCodeAt(this.#index) !== 0x3a) invalid();
      this.#index += 1;
      this.#skipWhitespace();
      this.#value(depth);
      this.#skipWhitespace();
      const delimiter = this.#text.charCodeAt(this.#index);
      if (delimiter === 0x7d) {
        this.#index += 1;
        return;
      }
      if (delimiter !== 0x2c) invalid();
      this.#index += 1;
      this.#skipWhitespace();
    }
  }

  #array(depth: number): void {
    this.#index += 1;
    this.#skipWhitespace();
    if (this.#text.charCodeAt(this.#index) === 0x5d) {
      this.#index += 1;
      return;
    }
    let items = 0;
    while (true) {
      items += 1;
      if (items > MAX_NODES) invalid();
      this.#value(depth);
      this.#skipWhitespace();
      const delimiter = this.#text.charCodeAt(this.#index);
      if (delimiter === 0x5d) {
        this.#index += 1;
        return;
      }
      if (delimiter !== 0x2c) invalid();
      this.#index += 1;
      this.#skipWhitespace();
    }
  }

  #string(): string {
    const start = this.#index;
    this.#index += 1;
    while (this.#index < this.#text.length) {
      const code = this.#text.charCodeAt(this.#index);
      if (code === 0x22) {
        this.#index += 1;
        let decoded: unknown;
        try {
          decoded = JSON.parse(this.#text.slice(start, this.#index));
        } catch {
          return invalid();
        }
        if (typeof decoded !== "string") invalid();
        const value = decoded as string;
        assertWellFormedString(value);
        return value;
      }
      if (code <= 0x1f) invalid();
      if (code === 0x5c) {
        this.#index += 1;
        const escape = this.#text.charCodeAt(this.#index);
        if (escape === 0x75) {
          for (let offset = 1; offset <= 4; offset += 1) {
            if (!isHex(this.#text.charCodeAt(this.#index + offset))) invalid();
          }
          this.#index += 5;
          continue;
        }
        if (![0x22, 0x5c, 0x2f, 0x62, 0x66, 0x6e, 0x72, 0x74].includes(escape)) {
          invalid();
        }
      }
      this.#index += 1;
    }
    return invalid();
  }

  #literal(expected: string): void {
    if (this.#text.slice(this.#index, this.#index + expected.length) !== expected) {
      invalid();
    }
    this.#index += expected.length;
  }

  #number(): void {
    const start = this.#index;
    if (this.#text.charCodeAt(this.#index) === 0x2d) this.#index += 1;
    const first = this.#text.charCodeAt(this.#index);
    if (first === 0x30) {
      this.#index += 1;
      if (isDigit(this.#text.charCodeAt(this.#index))) invalid();
    } else if (isNonZeroDigit(first)) {
      while (isDigit(this.#text.charCodeAt(this.#index))) this.#index += 1;
    } else {
      invalid();
    }
    if (this.#text.charCodeAt(this.#index) === 0x2e) {
      this.#index += 1;
      if (!isDigit(this.#text.charCodeAt(this.#index))) invalid();
      while (isDigit(this.#text.charCodeAt(this.#index))) this.#index += 1;
    }
    const exponent = this.#text.charCodeAt(this.#index);
    if (exponent === 0x65 || exponent === 0x45) {
      this.#index += 1;
      const sign = this.#text.charCodeAt(this.#index);
      if (sign === 0x2b || sign === 0x2d) this.#index += 1;
      if (!isDigit(this.#text.charCodeAt(this.#index))) invalid();
      while (isDigit(this.#text.charCodeAt(this.#index))) this.#index += 1;
    }
    if (!Number.isFinite(Number(this.#text.slice(start, this.#index)))) invalid();
  }
}

export function parseNativeProtocolFrame(bytes: Uint8Array): NativeProtocolMessage {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength === 0 ||
    bytes.byteLength > NATIVE_PROTOCOL_LIMITS.frameBytes ||
    (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
  ) invalid();
  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch {
    return invalid();
  }
  try {
    new JsonFrameScanner(text).scan();
    return captureAndValidateNativeProtocolMessage(JSON.parse(text));
  } catch {
    return invalid();
  }
}
