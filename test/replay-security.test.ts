import { describe, expect, it } from "vitest";

import {
  captureCanonicalSnapshot,
  descriptorSafeCaptureJson,
} from "../src/delta/canonical.js";
import {
  captureAgentReplayFixture,
  replayAgentFixture,
  type AgentReplayFixture,
} from "../src/replay/index.js";
import type { AgentActionSnapshot, AgentSnapshot } from "../src/types.js";

const DIGEST_DOMAIN = "dual-surface-ui:agent-replay-fixture:0.1\0";

const makeSnapshot = (
  action: AgentActionSnapshot = {
    name: "submit",
    risk: "write",
    effects: ["persisted"],
  },
): AgentSnapshot => captureCanonicalSnapshot({
  schemaVersion: "0.1",
  surfaceId: "secure-surface",
  revision: "runtime-revision-a",
  title: "Safe synthetic fixture",
  url: "https://fixture.example/form",
  generatedAt: "2026-09-20T00:00:00.000Z",
  capabilities: ["semantic-actions"],
  nodes: [{
    id: "submit",
    role: "button",
    name: "Submit",
    state: {},
    actions: [action],
  }],
});

async function sealFixture(
  unsigned: Omit<AgentReplayFixture, "fixtureDigest">,
): Promise<AgentReplayFixture> {
  const canonical = descriptorSafeCaptureJson(unsigned, {
    maxCharacters: 2_097_152,
    maxStringLength: 32_768,
    maxNodes: 250_000,
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${DIGEST_DOMAIN}${JSON.stringify(canonical)}`),
  );
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return { ...unsigned, fixtureDigest: `sha256:${hex}` };
}

async function safeFixture(
  action?: AgentActionSnapshot,
): Promise<AgentReplayFixture> {
  const initialSnapshot = makeSnapshot(action);
  return sealFixture({
    schemaVersion: "0.1",
    kind: "agent-replay-fixture",
    fixtureId: "security-boundary",
    surfaceId: "secure-surface",
    environment: {
      origin: "https://fixture.example",
      generation: "generation-1",
    },
    initialSnapshot,
    steps: [{
      request: {
        surfaceId: "secure-surface",
        revision: "runtime-revision-a",
        elementId: "submit",
        action: "submit",
      },
      controls: {
        policy: "deny",
        effects: { persisted: true },
        execution: { kind: "transition", nextSnapshot: initialSnapshot },
      },
      expected: {
        outcome: { status: "failed", code: "authorization_required" },
        lifecycle: [
          {
            event: "action_requested",
            outcome: "requested",
            sequence: 1,
            revisionRef: "revision-1",
            actionRef: "action-1",
          },
          {
            event: "policy_decided",
            outcome: "deny",
            sequence: 2,
            revisionRef: "revision-1",
            actionRef: "action-1",
          },
          {
            event: "action_failed",
            outcome: "authorization_required",
            sequence: 3,
            revisionRef: "revision-1",
            actionRef: "action-1",
          },
        ],
      },
    }],
    expectedFinalSnapshot: initialSnapshot,
  });
}

describe("synthetic replay trust boundary", () => {
  it("rejects digest tampering with a fixed non-reflective reason", async () => {
    const fixture = structuredClone(await safeFixture());
    fixture.steps[0]!.expected.outcome = {
      status: "failed",
      code: "internal_error",
    };
    await expect(captureAgentReplayFixture(fixture)).resolves.toEqual({
      status: "rejected",
      reason: "fixture_digest_mismatch",
    });
  });

  it("rejects credential actions even when the fixture digest is valid", async () => {
    const fixture = await safeFixture({
      name: "submit",
      risk: "credential",
      effects: ["persisted"],
    });
    await expect(captureAgentReplayFixture(fixture)).resolves.toEqual({
      status: "rejected",
      reason: "secret_detected",
    });
  });

  it("rejects secret-shaped keys and values without reflecting them", async () => {
    const fixture = structuredClone(await safeFixture()) as AgentReplayFixture & {
      steps: [{ request: Record<string, unknown> }];
    };
    fixture.steps[0].request.input = {
      password: "do-not-reflect-this-value",
    };
    const result = await captureAgentReplayFixture(fixture);
    expect(result).toEqual({ status: "rejected", reason: "secret_detected" });
    expect(JSON.stringify(result)).not.toContain("do-not-reflect-this-value");
  });

  it("rejects provider tokens and sentinels in ordinary values and snapshot URLs", async () => {
    const mutations: Array<(fixture: AgentReplayFixture) => void> = [
      (fixture) => { fixture.initialSnapshot.title = "SECRET-PASSWORD-7319"; },
      (fixture) => { fixture.initialSnapshot.nodes[0]!.state.value = "sk_live_1234567890123456"; },
      (fixture) => { fixture.steps[0]!.request.input = { note: "ghp_12345678901234567890" }; },
      (fixture) => { fixture.steps[0]!.request.input = { value: "4111111111111111" }; },
      (fixture) => { fixture.steps[0]!.request.input = { value: "731902" }; },
      (fixture) => { fixture.steps[0]!.request.input = { value: "webauthn:credential-value-7319" }; },
      (fixture) => { fixture.steps[0]!.request.input = { value: "-----BEGIN CERTIFICATE-----" }; },
      (fixture) => {
        const execution = fixture.steps[0]!.controls.execution;
        if (execution.kind === "transition") execution.output = "xoxb-1234567890-secret";
      },
      (fixture) => { fixture.initialSnapshot.url = "https://fixture.example/form?api_key=value7319"; },
      (fixture) => { fixture.initialSnapshot.url = "https://fixture.example/form#session-value7319"; },
    ];

    for (const mutate of mutations) {
      const fixture = structuredClone(await safeFixture());
      mutate(fixture);
      const { fixtureDigest: _digest, ...unsigned } = fixture;
      const resealed = await sealFixture(unsigned);
      await expect(captureAgentReplayFixture(resealed)).resolves.toEqual({
        status: "rejected",
        reason: "secret_detected",
      });
    }
  });

  it("does not invoke accessors or executable fixture fields", async () => {
    const fixture = structuredClone(await safeFixture()) as AgentReplayFixture & {
      callback?: () => void;
    };
    let getterReads = 0;
    Object.defineProperty(fixture, "fixtureId", {
      enumerable: true,
      get() {
        getterReads += 1;
        return "hostile-accessor";
      },
    });
    await expect(replayAgentFixture(fixture)).resolves.toEqual({
      status: "rejected",
      reason: "invalid_fixture",
    });
    expect(getterReads).toBe(0);

    let callbackCalls = 0;
    const executable = structuredClone(await safeFixture()) as AgentReplayFixture & {
      callback?: () => void;
    };
    executable.callback = () => { callbackCalls += 1; };
    await expect(replayAgentFixture(executable)).resolves.toEqual({
      status: "rejected",
      reason: "invalid_fixture",
    });
    expect(callbackCalls).toBe(0);
  });

  it("rejects cross-surface fixture content before any synthetic execution", async () => {
    const fixture = structuredClone(await safeFixture());
    fixture.steps[0]!.request.surfaceId = "different-surface";
    await expect(replayAgentFixture(fixture)).resolves.toEqual({
      status: "rejected",
      reason: "surface_mismatch",
    });
  });

  it("rejects oversized values at the capture boundary", async () => {
    const fixture = structuredClone(await safeFixture());
    fixture.steps[0]!.request.input = "x".repeat(32_769);
    await expect(captureAgentReplayFixture(fixture)).resolves.toEqual({
      status: "rejected",
      reason: "budget_exceeded",
    });
  });

  it("returns deeply frozen detached fixture data", async () => {
    const source = await safeFixture();
    const captured = await captureAgentReplayFixture(source);
    expect(captured.status).toBe("valid");
    if (captured.status !== "valid") return;
    expect(captured.fixture).not.toBe(source);
    expect(Object.isFrozen(captured.fixture)).toBe(true);
    expect(Object.isFrozen(captured.fixture.steps)).toBe(true);
    expect(Object.isFrozen(captured.fixture.initialSnapshot.nodes)).toBe(true);
  });
});
