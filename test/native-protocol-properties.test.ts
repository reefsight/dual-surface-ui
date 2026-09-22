import { describe, expect, it } from "vitest";

import {
  createNativeProtocolFixtureCorpus,
  decodeNativeProtocolFixtureCase,
} from "../scripts/native-protocol-fixture-corpus.mjs";
import {
  NATIVE_PROTOCOL_LIMITS,
  parseNativeProtocolFrame,
} from "../src/native-protocol/index.js";

const encoder = new TextEncoder();
const encode = (value: unknown): Uint8Array => encoder.encode(JSON.stringify(value));

const reorder = (value: unknown, seed: number): unknown => {
  if (Array.isArray(value)) return value.map((item, index) => reorder(item, seed + index + 1));
  if (value === null || typeof value !== "object") return value;
  const entries = Object.entries(value as Record<string, unknown>);
  entries.sort(([left], [right]) => {
    const leftScore = [...left].reduce((score, character) => (score * 33 + character.charCodeAt(0) + seed) >>> 0, seed);
    const rightScore = [...right].reduce((score, character) => (score * 33 + character.charCodeAt(0) + seed) >>> 0, seed);
    return leftScore - rightScore || left.localeCompare(right);
  });
  return Object.fromEntries(entries.map(([key, item], index) => [key, reorder(item, seed + index + 17)]));
};

const acceptedMessages = createNativeProtocolFixtureCorpus().cases
  .filter((fixture) => fixture.expected.status === "accepted")
  .map((fixture) => ({
    id: fixture.id,
    message: JSON.parse(new TextDecoder().decode(decodeNativeProtocolFixtureCase(fixture))) as Record<string, unknown>,
  }));

const message = (id: string): Record<string, unknown> => {
  const fixture = acceptedMessages.find((entry) => entry.id === id);
  if (!fixture) throw new Error(`Missing fixture ${id}`);
  return structuredClone(fixture.message);
};

describe("native protocol deterministic properties", () => {
  it("accepts every valid message across deterministic key-order permutations", () => {
    for (const fixture of acceptedMessages) {
      for (const seed of [1, 17, 257, 65_537]) {
        expect(parseNativeProtocolFrame(encode(reorder(fixture.message, seed))), `${fixture.id}:${seed}`)
          .toEqual(fixture.message);
      }
    }
  });

  it("does not inherit permissive JSON.parse duplicate-key behavior", () => {
    const duplicate = "{\"schemaVersion\":\"0.1\",\"kind\":\"surface-list-request\",\"requestId\":\"r1\",\"sessionRef\":\"s1\",\"sessionRef\":\"s2\"}";
    expect(JSON.parse(duplicate)).toMatchObject({ sessionRef: "s2" });
    expect(() => parseNativeProtocolFrame(encoder.encode(duplicate))).toThrow("Invalid native protocol frame");
  });

  it("rejects confused-deputy authority fields under deterministic mutation", () => {
    for (const [field, value] of Object.entries({
      principal: { id: "caller" },
      processId: 42,
      windowHandle: "0x1234",
      osUser: "caller",
      policy: "allow",
      confirmation: true,
      risk: "destructive",
      expectedEffects: ["write"],
    })) {
      expect(() => parseNativeProtocolFrame(encode({ ...message("action-request"), [field]: value })), field)
        .toThrow("Invalid native protocol frame");
    }
  });

  it("preserves inert injection text but rejects caller-controlled error text", () => {
    const catalog = message("surface-list-response");
    const injection = "</script><img src=x onerror=alert(1)> ${process.env.SECRET}";
    const surfaces = structuredClone(catalog.surfaces) as Array<Record<string, unknown>>;
    surfaces[0]!.title = injection;
    const captured = parseNativeProtocolFrame(encode({ ...catalog, surfaces }));
    expect(captured.kind).toBe("surface-list-response");
    if (captured.kind !== "surface-list-response") throw new Error("Unexpected message kind");
    expect(captured.surfaces[0]?.title).toBe(injection);

    expect(() => parseNativeProtocolFrame(encode({
      ...message("request-error-internal-error"),
      message: "OS error: token=secret-sentinel",
    }))).toThrow("Invalid native protocol frame");
  });

  it("enforces exact integer and allocation boundaries", () => {
    const event = message("event-catalog-changed");
    expect(parseNativeProtocolFrame(encode({ ...event, sequence: Number.MAX_SAFE_INTEGER })).kind).toBe("event");
    for (const sequence of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => parseNativeProtocolFrame(encode({ ...event, sequence })), String(sequence))
        .toThrow("Invalid native protocol frame");
    }
    expect(() => parseNativeProtocolFrame(new Uint8Array(NATIVE_PROTOCOL_LIMITS.frameBytes + 1)))
      .toThrow("Invalid native protocol frame");
  });

  it("rejects secret extraction from sensitive snapshot state", () => {
    const response = message("snapshot-response");
    const snapshot = structuredClone(response.snapshot) as Record<string, unknown>;
    const nodes = structuredClone(snapshot.nodes) as Array<Record<string, unknown>>;
    nodes[0]!.state = { sensitive: true, value: "secret-sentinel" };
    snapshot.nodes = nodes;
    expect(() => parseNativeProtocolFrame(encode({ ...response, snapshot })))
      .toThrow("Invalid native protocol frame");
  });
});
