import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { describe, expect, it } from "vitest";

import {
  captureAndValidateNativeProtocolDataMessage,
  captureAndValidateNativeProtocolExecutionMessage,
  NATIVE_PROTOCOL_DATA_SCHEMA,
  NATIVE_PROTOCOL_EXECUTION_SCHEMA,
  NATIVE_PROTOCOL_HANDSHAKE_SCHEMA,
  NATIVE_PROTOCOL_LIMITS,
  NATIVE_PROTOCOL_MESSAGE_SCHEMA,
  NATIVE_PROTOCOL_REQUEST_ERROR_MESSAGES,
  negotiateNativeProtocol,
  type NativeProtocolClientHello,
} from "../src/native-protocol/index.js";
import { AGENT_SNAPSHOT_DELTA_SCHEMA } from "../src/delta/schema.js";
import {
  AGENT_ACTION_FAILURE_SCHEMA,
  AGENT_ACTION_RESULT_SCHEMA,
  AGENT_SNAPSHOT_SCHEMA,
} from "../src/schema.js";

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

const digest = (character: string): `sha256:${string}` =>
  `sha256:${character.repeat(64)}`;

const node = (id = "button-1") => ({
  id,
  role: "button",
  name: "Save",
  state: {},
  actions: [{
    name: "click",
    risk: "write" as const,
    idempotency: "keyed" as const,
  }],
});

const snapshot = () => ({
  schemaVersion: "0.1" as const,
  surfaceId: "surface-1",
  revision: "revision-1",
  title: "Fixture",
  url: "app://fixture",
  generatedAt: "2026-09-22T00:00:00.000Z",
  capabilities: ["actions"],
  nodes: [node()],
});

describe("native protocol catalog and state messages", () => {
  it("captures a deterministic catalog and deeply freezes the result", () => {
    const result = captureAndValidateNativeProtocolDataMessage({
      schemaVersion: "0.1",
      kind: "surface-list-response",
      requestId: "request-2",
      sessionRef: "session-1",
      surfaces: [{
        surfaceRef: "surface-1",
        revision: "revision-1",
        title: "Fixture",
        application: "Fixture App",
        capabilities: ["actions", "snapshots"],
        actionCount: 1,
      }],
    });
    expect(result.kind).toBe("surface-list-response");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.kind === "surface-list-response" && result.surfaces)).toBe(true);
  });

  it.each([
    {
      schemaVersion: "0.1",
      kind: "surface-list-response",
      requestId: "request-2",
      sessionRef: "session-1",
      surfaces: [
        { surfaceRef: "surface-b", revision: "1", title: "B", application: "B", capabilities: [], actionCount: 0 },
        { surfaceRef: "surface-a", revision: "1", title: "A", application: "A", capabilities: [], actionCount: 0 },
      ],
    },
    {
      schemaVersion: "0.1",
      kind: "surface-list-request",
      requestId: "request-2",
      sessionRef: "session-1",
      processId: 42,
    },
  ])("rejects non-canonical catalogs and confused-deputy fields", (value) => {
    expect(() => captureAndValidateNativeProtocolDataMessage(value)).toThrow(
      "Invalid native protocol data message",
    );
  });

  it("validates a full snapshot against its opaque surface binding", () => {
    const result = captureAndValidateNativeProtocolDataMessage({
      snapshot: snapshot(),
      surfaceRef: "surface-1",
      sessionRef: "session-1",
      requestId: "request-3",
      kind: "snapshot-response",
      schemaVersion: "0.1",
    });
    expect(result.kind).toBe("snapshot-response");
  });

  it("rejects snapshot surface mismatch and sensitive value disclosure", () => {
    expect(() => captureAndValidateNativeProtocolDataMessage({
      schemaVersion: "0.1",
      kind: "snapshot-response",
      requestId: "request-3",
      sessionRef: "session-1",
      surfaceRef: "surface-other",
      snapshot: snapshot(),
    })).toThrow("Invalid native protocol data message");

    const unsafe = snapshot();
    unsafe.nodes[0]!.state = {
      sensitive: true,
      value: "secret-sentinel",
    };
    expect(() => captureAndValidateNativeProtocolDataMessage({
      schemaVersion: "0.1",
      kind: "snapshot-response",
      requestId: "request-3",
      sessionRef: "session-1",
      surfaceRef: "surface-1",
      snapshot: unsafe,
    })).toThrow("Invalid native protocol data message");
  });

  it("enforces the native action budget independently of the core schema", () => {
    const oversized = snapshot();
    oversized.nodes[0]!.actions = Array.from({ length: 129 }, (_, index) => ({
      name: `action-${String(index).padStart(3, "0")}`,
      risk: "read" as const,
      idempotency: "none" as const,
    }));
    expect(() => captureAndValidateNativeProtocolDataMessage({
      schemaVersion: "0.1",
      kind: "snapshot-response",
      requestId: "request-oversized-snapshot",
      sessionRef: "session-1",
      surfaceRef: "surface-1",
      snapshot: oversized,
    })).toThrow("Invalid native protocol data message");
  });

  it("validates a bounded delta and rejects cross-surface substitution", () => {
    const delta = {
      schemaVersion: "0.1",
      kind: "agent-snapshot-delta",
      surfaceId: "surface-1",
      baseRevision: "revision-1",
      revision: "revision-2",
      baseDigest: digest("a"),
      targetDigest: digest("b"),
      target: {
        title: "Fixture",
        url: "app://fixture",
        generatedAt: "2026-09-22T00:00:01.000Z",
        focusedElementId: null,
        capabilities: ["actions"],
      },
      nodeUpserts: [node()],
      removedNodeIds: [],
    };
    const envelope = {
      schemaVersion: "0.1",
      kind: "delta-response",
      requestId: "request-4",
      sessionRef: "session-1",
      surfaceRef: "surface-1",
      delta,
    };
    expect(captureAndValidateNativeProtocolDataMessage(envelope).kind).toBe(
      "delta-response",
    );
    expect(() => captureAndValidateNativeProtocolDataMessage({
      ...envelope,
      surfaceRef: "surface-other",
    })).toThrow("Invalid native protocol data message");
  });

  it("rejects a delta response above the 512 KiB protocol budget", () => {
    const largeNodes = Array.from({ length: 70 }, (_, index) => ({
      ...node(`node-${String(index).padStart(3, "0")}`),
      description: "x".repeat(8_000),
      actions: [],
    }));
    expect(() => captureAndValidateNativeProtocolDataMessage({
      schemaVersion: "0.1",
      kind: "delta-response",
      requestId: "request-oversized-delta",
      sessionRef: "session-1",
      surfaceRef: "surface-1",
      delta: {
        schemaVersion: "0.1",
        kind: "agent-snapshot-delta",
        surfaceId: "surface-1",
        baseRevision: "revision-1",
        revision: "revision-2",
        baseDigest: digest("a"),
        targetDigest: digest("b"),
        target: {
          title: "Fixture",
          url: "app://fixture",
          generatedAt: "2026-09-22T00:00:01.000Z",
          focusedElementId: null,
          capabilities: [],
        },
        nodeUpserts: largeNodes,
        removedNodeIds: [],
      },
    })).toThrow("Invalid native protocol data message");
  });

  it("rejects accessor-bearing data without invoking the accessor", () => {
    let invoked = false;
    const value = Object.defineProperty({}, "kind", {
      enumerable: true,
      get: () => {
        invoked = true;
        return "surface-list-request";
      },
    });
    expect(() => captureAndValidateNativeProtocolDataMessage(value)).toThrow(
      "Invalid native protocol data message",
    );
    expect(invoked).toBe(false);
  });

  it("publishes compilable aggregate schemas with explicit core references", () => {
    const validator = new Ajv2020({ strict: true });
    addFormatsModule(validator);
    validator.addSchema(AGENT_SNAPSHOT_SCHEMA);
    validator.addSchema(AGENT_SNAPSHOT_DELTA_SCHEMA);
    validator.addSchema(AGENT_ACTION_RESULT_SCHEMA);
    validator.addSchema(AGENT_ACTION_FAILURE_SCHEMA);
    validator.addSchema(NATIVE_PROTOCOL_HANDSHAKE_SCHEMA);
    validator.addSchema(NATIVE_PROTOCOL_DATA_SCHEMA);
    validator.addSchema(NATIVE_PROTOCOL_EXECUTION_SCHEMA);
    validator.addSchema(NATIVE_PROTOCOL_MESSAGE_SCHEMA);
    expect(validator.getSchema(NATIVE_PROTOCOL_MESSAGE_SCHEMA.$id)).toBeTypeOf(
      "function",
    );
  });
});

describe("native protocol execution messages", () => {
  it("captures a JSON-only action request and deeply freezes it", () => {
    const result = captureAndValidateNativeProtocolExecutionMessage({
      schemaVersion: "0.1",
      kind: "action-request",
      requestId: "request-action-1",
      sessionRef: "session-1",
      surfaceRef: "surface-1",
      revision: "revision-1",
      elementId: "button-1",
      action: "click",
      input: { confirmed: true },
      idempotencyKey: "idem-1",
    });
    expect(result.kind).toBe("action-request");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.kind === "action-request" && result.input)).toBe(true);
  });

  it.each([
    { risk: "destructive" },
    { processId: 42 },
    { principal: { id: "attacker" } },
    { confirmation: true },
  ])("rejects caller-supplied authority fields", (extra) => {
    expect(() => captureAndValidateNativeProtocolExecutionMessage({
      schemaVersion: "0.1",
      kind: "action-request",
      requestId: "request-action-2",
      sessionRef: "session-1",
      surfaceRef: "surface-1",
      revision: "revision-1",
      elementId: "button-1",
      action: "click",
      ...extra,
    })).toThrow("Invalid native protocol execution message");
  });

  it("validates a successful core outcome against its surface binding", () => {
    const envelope = {
      schemaVersion: "0.1",
      kind: "action-response",
      requestId: "request-action-3",
      sessionRef: "session-1",
      surfaceRef: "surface-1",
      outcome: {
        schemaVersion: "0.1",
        surfaceId: "surface-1",
        previousRevision: "revision-1",
        revision: "revision-2",
        status: "succeeded",
        action: "click",
        targetId: "button-1",
        targetPresent: true,
        node: node(),
        output: { saved: true },
      },
    };
    expect(captureAndValidateNativeProtocolExecutionMessage(envelope).kind).toBe(
      "action-response",
    );
    expect(() => captureAndValidateNativeProtocolExecutionMessage({
      ...envelope,
      surfaceRef: "surface-other",
    })).toThrow("Invalid native protocol execution message");
  });

  it("enforces the 256 KiB action-result budget", () => {
    expect(() => captureAndValidateNativeProtocolExecutionMessage({
      schemaVersion: "0.1",
      kind: "action-response",
      requestId: "request-action-large",
      sessionRef: "session-1",
      surfaceRef: "surface-1",
      outcome: {
        schemaVersion: "0.1",
        surfaceId: "surface-1",
        previousRevision: "revision-1",
        revision: "revision-2",
        status: "succeeded",
        action: "read",
        targetId: "output-1",
        targetPresent: false,
        output: Array.from({ length: 34 }, () => "x".repeat(8_000)),
      },
    })).toThrow("Invalid native protocol execution message");
  });

  it("accepts fixed cancellation dispositions without cross-session fields", () => {
    expect(captureAndValidateNativeProtocolExecutionMessage({
      schemaVersion: "0.1",
      kind: "cancel-response",
      requestId: "request-cancel-1",
      sessionRef: "session-1",
      targetRequestId: "request-action-3",
      disposition: "already-completed",
    }).kind).toBe("cancel-response");
  });

  it("requires package-owned request error messages", () => {
    const valid = {
      schemaVersion: "0.1",
      kind: "request-error",
      requestId: "request-error-1",
      sessionRef: "session-1",
      code: "permission_denied",
      message: NATIVE_PROTOCOL_REQUEST_ERROR_MESSAGES.permission_denied,
    };
    expect(captureAndValidateNativeProtocolExecutionMessage(valid).kind).toBe(
      "request-error",
    );
    expect(() => captureAndValidateNativeProtocolExecutionMessage({
      ...valid,
      message: "OS error: token=secret-sentinel",
    })).toThrow("Invalid native protocol execution message");
  });

  it("enforces event-specific fields and safe integer sequences", () => {
    expect(captureAndValidateNativeProtocolExecutionMessage({
      schemaVersion: "0.1",
      kind: "event",
      sessionRef: "session-1",
      sequence: 1,
      event: "surface-changed",
      surfaceRef: "surface-1",
      revision: "revision-2",
    }).kind).toBe("event");
    expect(() => captureAndValidateNativeProtocolExecutionMessage({
      schemaVersion: "0.1",
      kind: "event",
      sessionRef: "session-1",
      sequence: Number.MAX_SAFE_INTEGER + 1,
      event: "surface-changed",
      surfaceRef: "surface-1",
      revision: "revision-2",
    })).toThrow("Invalid native protocol execution message");
    expect(() => captureAndValidateNativeProtocolExecutionMessage({
      schemaVersion: "0.1",
      kind: "event",
      sessionRef: "session-1",
      sequence: 2,
      event: "surface-closed",
      surfaceRef: "surface-1",
      revision: "leaked-revision",
    })).toThrow("Invalid native protocol execution message");
  });
});
