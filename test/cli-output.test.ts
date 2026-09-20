import { describe, expect, it } from "vitest";

import {
  createAgentCliError,
  serializeAgentCliOutput,
  type AgentCliEvent,
  type AgentCliResultEnvelope,
} from "../src/cli/output.js";

const digest = `sha256:${"a".repeat(64)}` as const;

describe("CLI canonical machine output", () => {
  it("serializes one recursively key-sorted compact JSON value plus one LF", () => {
    const result: AgentCliResultEnvelope = {
      schemaVersion: "0.1",
      kind: "agent-cli-result",
      command: "inspect",
      status: "completed",
      data: {
        artifactType: "snapshot",
        schemaVersion: "0.1",
        digest,
        counts: { nodes: 2, actions: 3, capabilities: 1 },
      },
    };
    const serialized = serializeAgentCliOutput(result);
    expect(serialized).toBe(
      `{"command":"inspect","data":{"artifactType":"snapshot","counts":{"actions":3,"capabilities":1,"nodes":2},"digest":"${digest}","schemaVersion":"0.1"},"kind":"agent-cli-result","schemaVersion":"0.1","status":"completed"}\n`,
    );
    expect(serialized.endsWith("\n")).toBe(true);
    expect(serialized.endsWith("\n\n")).toBe(false);
  });

  it("preserves non-evaluation NDJSON status inside the exact data pair", () => {
    const event: AgentCliEvent = {
      schemaVersion: "0.1",
      kind: "agent-cli-event",
      command: "validate",
      sequence: 0,
      type: "result",
      data: {
        status: "invalid",
        data: { valid: false, reason: "digest_mismatch" },
      },
    };
    expect(JSON.parse(serializeAgentCliOutput(event))).toEqual(event);
  });

  it("constructs the fixed one-to-one redacted error contract", () => {
    expect(createAgentCliError("driver_error", "record")).toEqual({
      schemaVersion: "0.1",
      kind: "agent-cli-error",
      command: "record",
      code: "driver_error",
      message: "Trusted driver failed.",
    });
    expect(serializeAgentCliOutput(createAgentCliError("internal_error"))).toBe(
      '{"code":"internal_error","kind":"agent-cli-error","message":"Internal error.","schemaVersion":"0.1"}\n',
    );
  });

  it("normalizes negative zero and rejects non-JSON or hostile object graphs", () => {
    const normalized = {
      schemaVersion: "0.1",
      kind: "agent-cli-result",
      command: "inspect",
      status: "completed",
      data: {
        artifactType: "snapshot",
        schemaVersion: "0.1",
        digest,
        counts: { nodes: -0, actions: 0, capabilities: 0 },
      },
    } as unknown as AgentCliResultEnvelope;
    expect(serializeAgentCliOutput(normalized)).toContain('"nodes":0');

    let getterReads = 0;
    const hostile = {
      schemaVersion: "0.1",
      kind: "agent-cli-result",
      command: "diff",
      status: "no_change",
      data: {},
    };
    Object.defineProperty(hostile.data, "value", {
      enumerable: true,
      get() { getterReads += 1; return "unsafe"; },
    });
    expect(() => serializeAgentCliOutput(
      hostile as unknown as AgentCliResultEnvelope,
    )).toThrowError("Invalid CLI output");
    expect(getterReads).toBe(0);

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => serializeAgentCliOutput(cyclic as AgentCliResultEnvelope)).toThrowError(
      "Invalid CLI output",
    );
  });

  it("fails closed before emitting secret-bearing output", () => {
    const unsafe = {
      schemaVersion: "0.1",
      kind: "agent-cli-result",
      command: "diff",
      status: "no_change",
      data: { note: "token=do-not-emit-123456" },
    } as unknown as AgentCliResultEnvelope;
    expect(() => serializeAgentCliOutput(unsafe)).toThrowError("Invalid CLI output");
  });

  it("rejects values that do not match the exact result, event, or error schema", () => {
    const extraResultProperty = {
      schemaVersion: "0.1",
      kind: "agent-cli-result",
      command: "diff",
      status: "no_change",
      data: {},
      extra: true,
    } as unknown as AgentCliResultEnvelope;
    expect(() => serializeAgentCliOutput(extraResultProperty)).toThrowError(
      "Invalid CLI output",
    );

    const mismatchedEvaluationStatus = {
      schemaVersion: "0.1",
      kind: "agent-cli-result",
      command: "evaluate",
      status: "complete",
      data: {
        result: {
          schemaVersion: "0.1",
          kind: "agent-evaluation-result",
          suiteId: "suite",
          definitionDigest: digest,
          driverId: "driver",
          status: "incomplete",
          caseCount: 1,
          dimensionCount: 1,
          cases: [{
            caseId: "case",
            status: "environment_error",
            code: "environment_unavailable",
          }],
          dimensions: [{
            dimension: "quality",
            earned: 0,
            possible: 0,
            unscored: 1,
          }],
          environmentErrors: 1,
        },
      },
    } as unknown as AgentCliResultEnvelope;
    expect(() => serializeAgentCliOutput(mismatchedEvaluationStatus)).toThrowError(
      "Invalid CLI output",
    );

    const inconsistentEvaluation = {
      schemaVersion: "0.1",
      kind: "agent-cli-result",
      command: "evaluate",
      status: "complete",
      data: {
        result: {
          schemaVersion: "0.1",
          kind: "agent-evaluation-result",
          suiteId: "suite",
          definitionDigest: digest,
          driverId: "driver",
          status: "complete",
          caseCount: 1,
          dimensionCount: 1,
          cases: [{
            caseId: "case",
            status: "scored",
            scores: [{ dimension: "quality", earned: 1, possible: 1 }],
          }],
          dimensions: [{
            dimension: "quality",
            earned: 0,
            possible: 99,
            unscored: 0,
          }],
          environmentErrors: 0,
        },
      },
    } as unknown as AgentCliResultEnvelope;
    expect(() => serializeAgentCliOutput(inconsistentEvaluation)).toThrowError(
      "Invalid CLI output",
    );

    const inconsistentSummary = {
      schemaVersion: "0.1",
      kind: "agent-cli-event",
      command: "evaluate",
      sequence: 1,
      type: "summary",
      data: {
        schemaVersion: "0.1",
        kind: "agent-evaluation-result",
        suiteId: "suite",
        definitionDigest: digest,
        driverId: "driver",
        status: "complete",
        caseCount: 1,
        dimensionCount: 1,
        dimensions: [{
          dimension: "quality",
          earned: 99,
          possible: 0,
          unscored: 99,
        }],
        environmentErrors: 0,
      },
    } as unknown as AgentCliEvent;
    expect(() => serializeAgentCliOutput(inconsistentSummary)).toThrowError(
      "Invalid CLI output",
    );

    const duplicateCaseDimensions = {
      schemaVersion: "0.1",
      kind: "agent-cli-event",
      command: "evaluate",
      sequence: 0,
      type: "case",
      data: {
        caseId: "case",
        status: "scored",
        scores: [
          { dimension: "quality", earned: 1, possible: 1 },
          { dimension: "quality", earned: 0, possible: 1 },
        ],
      },
    } as unknown as AgentCliEvent;
    expect(() => serializeAgentCliOutput(duplicateCaseDimensions)).toThrowError(
      "Invalid CLI output",
    );

    const wrongErrorMessage = {
      ...createAgentCliError("input_io"),
      message: "Internal error.",
    } as unknown as ReturnType<typeof createAgentCliError>;
    expect(() => serializeAgentCliOutput(wrongErrorMessage)).toThrowError(
      "Invalid CLI output",
    );
  });

  it("does not mistake a schema-validated SHA-256 digest for a card number", () => {
    const numericDigest = `sha256:${"4242424242424242".repeat(4)}` as const;
    const result: AgentCliResultEnvelope = {
      schemaVersion: "0.1",
      kind: "agent-cli-result",
      command: "validate",
      status: "valid",
      data: {
        artifactType: "snapshot",
        valid: true,
        digest: numericDigest,
      },
    };
    expect(JSON.parse(serializeAgentCliOutput(result))).toEqual(result);
  });
});
