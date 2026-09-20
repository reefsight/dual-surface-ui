import { describe, expect, it } from "vitest";

import {
  CliJsonInputError,
  MAX_CLI_INPUT_BYTES,
  parseCliJsonInput,
  type CliJsonInputRejectReason,
} from "../src/cli/json-input.js";

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);

const expectReason = (
  source: Uint8Array | string,
  reason: CliJsonInputRejectReason,
  budget?: Parameters<typeof parseCliJsonInput>[1],
): void => {
  try {
    parseCliJsonInput(typeof source === "string" ? encode(source) : source, budget);
    throw new Error("expected input rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(CliJsonInputError);
    expect(error).toMatchObject({
      message: "Invalid CLI JSON input",
      reason,
    });
    if (typeof source === "string" && source.length > 0) {
      expect(String(error)).not.toContain(source);
    }
  }
};

describe("strict CLI JSON input", () => {
  it("returns detached frozen plain JSON with null-prototype objects", () => {
    const value = parseCliJsonInput(encode('{"array":[true,null,-0,1.25e2],"object":{"safe":"value"}}'));
    expect(value).toEqual({
      array: [true, null, 0, 125],
      object: { safe: "value" },
    });
    expect(Object.isFrozen(value)).toBe(true);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("expected object");
    }
    expect(Object.getPrototypeOf(value)).toBeNull();
    const array = value.array;
    const object = value.object;
    expect(Array.isArray(array) && Object.isFrozen(array)).toBe(true);
    expect(
      typeof object === "object" &&
      object !== null &&
      !Array.isArray(object) &&
      Object.getPrototypeOf(object) === null &&
      Object.isFrozen(object),
    ).toBe(true);
  });

  it("accepts surrounding JSON whitespace but exactly one value", () => {
    expect(parseCliJsonInput(encode(" \r\n\t[1,2] \n"))).toEqual([1, 2]);
    expectReason("{} {}", "invalid_json");
    expectReason("", "invalid_json");
    expectReason("[1,]", "invalid_json");
    expectReason('{"a":1,}', "invalid_json");
  });

  it("rejects malformed number, string, escape, and surrogate forms", () => {
    for (const source of [
      "01",
      "1.",
      "1e",
      "1e9999",
      '"unterminated',
      '"bad\\xescape"',
      '"\\uD800"',
      '"\\uDC00"',
    ]) {
      expectReason(source, "invalid_json");
    }
  });

  it("rejects invalid UTF-8 and byte-order marks", () => {
    expectReason(new Uint8Array([0xc3, 0x28]), "invalid_utf8");
    expectReason(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]), "invalid_utf8");
  });

  it("rejects decoded duplicate keys including escaped aliases", () => {
    expectReason('{"same":1,"same":2}', "duplicate_key");
    expectReason('{"same":1,"s\\u0061me":2}', "duplicate_key");
  });

  it.each(["__proto__", "prototype", "constructor"])(
    "preserves prototype-like key %s as inert own data",
    (key) => {
      const value = parseCliJsonInput(encode(`{"nested":{"${key}":true}}`));
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("expected object");
      }
      const nested = value.nested;
      if (typeof nested !== "object" || nested === null || Array.isArray(nested)) {
        throw new Error("expected nested object");
      }
      expect(Object.getPrototypeOf(nested)).toBeNull();
      expect(Object.hasOwn(nested, key)).toBe(true);
      expect(Object.getOwnPropertyDescriptor(nested, key)).toMatchObject({
        value: true,
        enumerable: true,
        writable: false,
        configurable: false,
      });
      expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    },
  );

  it("keeps parsing separate from artifact-aware secret validation", () => {
    expect(parseCliJsonInput(encode('{"password":"ordinary-value"}'))).toEqual({
      password: "ordinary-value",
    });
    expect(parseCliJsonInput(encode('{"note":"ghp_12345678901234567890"}')))
      .toEqual({ note: "ghp_12345678901234567890" });
  });

  it("enforces the global byte ceiling before decoding", () => {
    expect(parseCliJsonInput(encode("{}"), { maxBytes: 2 })).toEqual({});
    expectReason(encode(" {}"), "input_too_large", { maxBytes: 2 });
    const oversized = new Uint8Array(MAX_CLI_INPUT_BYTES + 1);
    expectReason(oversized, "input_too_large");
  });

  it("enforces depth, node, property, and string budgets", () => {
    expect(parseCliJsonInput(encode('{"a":{"b":true}}'), { maxDepth: 2 })).toEqual({
      a: { b: true },
    });
    expectReason('{"a":{"b":true}}', "budget_exceeded", { maxDepth: 1 });
    expectReason("[1,2]", "budget_exceeded", { maxNodes: 2 });
    expectReason('{"a":1,"b":2}', "budget_exceeded", { maxProperties: 1 });
    expectReason('{"abc":"d"}', "budget_exceeded", { maxStringLength: 2 });
    expectReason('{"a":"bc"}', "budget_exceeded", { maxCharacters: 2 });
  });

  it("rejects invalid budget configuration without reflecting it", () => {
    expectReason("{}", "budget_exceeded", { maxDepth: -1 });
    expectReason("{}", "budget_exceeded", { maxNodes: Number.NaN });
    expectReason("{}", "budget_exceeded", { maxBytes: MAX_CLI_INPUT_BYTES + 1 });
  });
});
