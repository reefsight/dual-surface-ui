import { describe, expect, it } from "vitest";

import type { AgentAuditEvent } from "../src/audit.js";
import {
  captureAndValidateAgentRuntimeTrace,
  createAgentTraceRecorder,
} from "../src/trace/index.js";

const event = (
  overrides: Partial<AgentAuditEvent> = {},
): AgentAuditEvent => {
  const result = {
    schemaVersion: "0.1",
    event: "action_requested",
    correlationId: "correlation-a",
    surfaceId: "surface-a",
    revision: "revision-a",
    sequence: 1,
    timestamp: "2026-09-20T00:00:00.000Z",
    durationMs: 1,
    outcome: "requested",
    action: "approve",
    ...overrides,
  } as AgentAuditEvent & { action?: string };
  if (result.event === "surface_observed") delete result.action;
  return result;
};

async function completedTrace(options: {
  correlationId?: string;
  durationMs?: number;
  timestamp?: string;
} = {}) {
  const recorder = createAgentTraceRecorder({ sourceId: "unit-source" });
  recorder.record(event({
    correlationId: options.correlationId ?? "correlation-a",
    durationMs: options.durationMs ?? 1,
    timestamp: options.timestamp ?? "2026-09-20T00:00:00.000Z",
  }));
  recorder.record(event({
    correlationId: options.correlationId ?? "correlation-a",
    durationMs: options.durationMs ?? 1,
    timestamp: options.timestamp ?? "2026-09-20T00:00:00.000Z",
    event: "policy_decided",
    outcome: "deny",
    sequence: 2,
  }));
  recorder.record(event({
    correlationId: options.correlationId ?? "correlation-a",
    durationMs: options.durationMs ?? 1,
    timestamp: options.timestamp ?? "2026-09-20T00:00:00.000Z",
    event: "action_failed",
    outcome: "authorization_required",
    sequence: 3,
  }));
  return recorder.finish();
}

describe("redacted runtime trace recorder", () => {
  it("persists only normalized lifecycle fields and immutable digest links", async () => {
    const finished = await completedTrace({ correlationId: "private-correlation-7319" });
    expect(finished.status).toBe("complete");
    if (finished.status !== "complete") return;

    expect(finished.trace).toMatchObject({
      schemaVersion: "0.1",
      kind: "agent-runtime-trace",
      sourceId: "unit-source",
      recordCount: 3,
      operationCount: 1,
    });
    expect(finished.trace.records.map((record) => ({
      index: record.index,
      operation: record.operation,
      sequence: record.sequence,
      event: record.event,
      outcome: record.outcome,
      actionRef: record.actionRef,
      revisionRef: record.revisionRef,
    }))).toEqual([
      { index: 1, operation: 1, sequence: 1, event: "action_requested", outcome: "requested", actionRef: "action-1", revisionRef: "revision-1" },
      { index: 2, operation: 1, sequence: 2, event: "policy_decided", outcome: "deny", actionRef: "action-1", revisionRef: "revision-1" },
      { index: 3, operation: 1, sequence: 3, event: "action_failed", outcome: "authorization_required", actionRef: "action-1", revisionRef: "revision-1" },
    ]);
    const serialized = JSON.stringify(finished.trace);
    for (const forbidden of [
      "private-correlation-7319",
      "surface-a",
      "revision-a",
      "approve",
      "timestamp",
      "durationMs",
      "correlationId",
    ]) expect(serialized).not.toContain(forbidden);
    expect(Object.isFrozen(finished.trace)).toBe(true);
    expect(Object.isFrozen(finished.trace.records)).toBe(true);
    await expect(captureAndValidateAgentRuntimeTrace(finished.trace)).resolves.toEqual(finished.trace);
  });

  it("normalizes correlation, time, and duration noise deterministically", async () => {
    const first = await completedTrace();
    const second = await completedTrace({
      correlationId: "different-correlation",
      durationMs: 98_765,
      timestamp: "2030-01-01T01:02:03.000Z",
    });
    expect(first).toEqual(second);
  });

  it("poisons invalid ordering and cross-surface recording without throwing", async () => {
    const invalidOrder = createAgentTraceRecorder({ sourceId: "invalid-order" });
    expect(() => invalidOrder.record(event({
      event: "action_verified",
      outcome: "succeeded",
    }))).not.toThrow();
    await expect(invalidOrder.finish()).resolves.toEqual({
      status: "rejected",
      reason: "invalid_order",
    });

    const crossSurface = createAgentTraceRecorder({ sourceId: "cross-surface" });
    crossSurface.record(event());
    crossSurface.record(event({
      correlationId: "correlation-b",
      event: "surface_observed",
      outcome: "observed",
      surfaceId: "surface-b",
    }));
    await expect(crossSurface.finish()).resolves.toEqual({
      status: "rejected",
      reason: "surface_mismatch",
    });
  });

  it("fails closed for operation overflow and tampered digest chains", async () => {
    const recorder = createAgentTraceRecorder({ sourceId: "overflow" });
    for (let index = 0; index < 257; index += 1) {
      recorder.record(event({
        correlationId: `observation-${index}`,
        event: "surface_observed",
        outcome: "observed",
      }));
    }
    await expect(recorder.finish()).resolves.toEqual({
      status: "rejected",
      reason: "budget_exceeded",
    });

    const finished = await completedTrace();
    expect(finished.status).toBe("complete");
    if (finished.status !== "complete") return;
    const tampered = structuredClone(finished.trace);
    tampered.records[1]!.outcome = "allow";
    await expect(captureAndValidateAgentRuntimeTrace(tampered)).rejects.toThrow();
  });

  it("poisons secret-bearing audit input without persisting or reflecting it", async () => {
    const recorder = createAgentTraceRecorder({ sourceId: "sentinel-boundary" });
    expect(() => recorder.record(event({
      action: "token=do-not-persist-123456",
    }))).not.toThrow();
    const result = await recorder.finish();
    expect(result).toEqual({ status: "rejected", reason: "secret_detected" });
    expect(JSON.stringify(result)).not.toContain("do-not-persist-123456");
  });

  it("rejects provider credentials in configuration and every opaque audit field", async () => {
    expect(() => createAgentTraceRecorder({
      sourceId: "sk_live_1234567890123456",
    })).toThrow();

    for (const [field, value] of [
      ["action", "ghp_12345678901234567890"],
      ["revision", "xoxb-1234567890-secret"],
      ["correlationId", "sk-1234567890123456"],
    ] as const) {
      const recorder = createAgentTraceRecorder({ sourceId: `provider-${field}` });
      recorder.record(event({ [field]: value }));
      await expect(recorder.finish()).resolves.toEqual({
        status: "rejected",
        reason: "secret_detected",
      });
    }
  });

  it("is single-use and rejects incomplete traces deterministically", async () => {
    const empty = createAgentTraceRecorder({ sourceId: "empty-trace" });
    await expect(empty.finish()).resolves.toEqual({
      status: "rejected",
      reason: "invalid_order",
    });
    await expect(empty.finish()).resolves.toEqual({
      status: "rejected",
      reason: "already_finished",
    });

    const completed = createAgentTraceRecorder({ sourceId: "single-use" });
    completed.record(event({ event: "surface_observed", outcome: "observed" }));
    expect((await completed.finish()).status).toBe("complete");
    await expect(completed.finish()).resolves.toEqual({
      status: "rejected",
      reason: "already_finished",
    });
  });
});
