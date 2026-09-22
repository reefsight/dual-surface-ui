import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import {
  NATIVE_PROTOCOL_HANDSHAKE_SCHEMA,
  NATIVE_PROTOCOL_LIMITS,
  negotiateNativeProtocol,
  type NativeProtocolClientHello,
} from "../src/native-protocol/index.js";

const hello = (
  overrides: Partial<NativeProtocolClientHello> = {},
): NativeProtocolClientHello => ({
  schemaVersion: "0.1",
  kind: "client-hello",
  requestId: "request-1",
  supportedVersions: ["0.1"],
  capabilities: ["actions", "snapshots", "surface-catalog"],
  requiredCapabilities: ["snapshots", "surface-catalog"],
  ...overrides,
});

const options = {
  sessionRef: "session-1",
  capabilities: ["surface-catalog", "snapshots", "deltas"] as const,
};

describe("native protocol negotiation", () => {
  it("selects the exact version and deterministic capability intersection", () => {
    const result = negotiateNativeProtocol(hello(), options);
    expect(result).toEqual({
      status: "accepted",
      message: {
        schemaVersion: "0.1",
        kind: "server-hello",
        requestId: "request-1",
        sessionRef: "session-1",
        protocolVersion: "0.1",
        capabilities: ["snapshots", "surface-catalog"],
        limits: NATIVE_PROTOCOL_LIMITS,
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.message)).toBe(true);
  });

  it("fails closed without exposing a session when versions do not overlap", () => {
    const result = negotiateNativeProtocol(
      { ...hello(), supportedVersions: ["9.9"] },
      options,
    );
    expect(result).toEqual({
      status: "rejected",
      message: {
        schemaVersion: "0.1",
        kind: "protocol-error",
        requestId: "request-1",
        code: "no_compatible_version",
        message: "No compatible native protocol version",
      },
    });
    expect("sessionRef" in result.message).toBe(false);
  });

  it("rejects an unavailable required capability without catalog disclosure", () => {
    const result = negotiateNativeProtocol(
      hello({
        capabilities: ["actions", "snapshots", "surface-catalog"],
        requiredCapabilities: ["actions"],
      }),
      options,
    );
    expect(result.status).toBe("rejected");
    expect(result.message).toMatchObject({
      requestId: "request-1",
      code: "missing_required_capability",
    });
    expect("capabilities" in result.message).toBe(false);
  });

  it.each([
    { ...hello(), extra: true },
    { ...hello(), requestId: "has space" },
    { ...hello(), capabilities: ["snapshots", "snapshots"] },
    Object.defineProperty({}, "kind", { enumerable: true, get: () => "client-hello" }),
  ])("normalizes malformed or accessor-bearing input to a fixed error", (input) => {
    expect(negotiateNativeProtocol(input, options)).toEqual({
      status: "rejected",
      message: {
        schemaVersion: "0.1",
        kind: "protocol-error",
        requestId: null,
        code: "invalid_message",
        message: "Invalid native protocol message",
      },
    });
  });

  it("retains a validated request ID for semantic inconsistencies", () => {
    expect(negotiateNativeProtocol(
      { ...hello(), requiredCapabilities: ["events"] },
      options,
    )).toEqual({
      status: "rejected",
      message: {
        schemaVersion: "0.1",
        kind: "protocol-error",
        requestId: "request-1",
        code: "invalid_message",
        message: "Invalid native protocol message",
      },
    });
  });

  it("captures and validates trusted server options without invoking accessors", () => {
    const invalid = Object.defineProperty({}, "sessionRef", {
      enumerable: true,
      get: () => "session-1",
    });
    expect(() => negotiateNativeProtocol(hello(), invalid as never)).toThrow(
      "Invalid native protocol negotiation options",
    );
    expect(() => negotiateNativeProtocol(hello(), {
      ...options,
      capabilities: ["snapshots", "snapshots"],
    })).toThrow("Invalid native protocol negotiation options");
  });

  it("publishes a strict schema that validates accepted and rejected messages", () => {
    const validate = new Ajv2020({ strict: true }).compile(
      NATIVE_PROTOCOL_HANDSHAKE_SCHEMA,
    );
    const accepted = negotiateNativeProtocol(hello(), options);
    const rejected = negotiateNativeProtocol(
      { ...hello(), supportedVersions: ["9.9"] },
      options,
    );
    expect(validate(hello())).toBe(true);
    expect(validate(accepted.message)).toBe(true);
    expect(validate(rejected.message)).toBe(true);
    expect(validate({ ...accepted.message, processId: 42 })).toBe(false);
  });
});
