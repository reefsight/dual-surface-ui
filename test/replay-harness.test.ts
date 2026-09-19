import { describe, expect, it } from "vitest";

import {
  captureCanonicalSnapshot,
  descriptorSafeCaptureJson,
} from "../src/delta/canonical.js";
import {
  captureAgentReplayFixture,
  replayAgentFixture,
  type AgentReplayExpectedEvent,
  type AgentReplayFixture,
  type AgentReplayStep,
} from "../src/replay/index.js";
import type {
  AgentActionSnapshot,
  AgentJsonValue,
  AgentSnapshot,
} from "../src/types.js";

const DIGEST_DOMAIN = "dual-surface-ui:agent-replay-fixture:0.1\0";

const snapshot = (
  revision: string,
  action: AgentActionSnapshot,
): AgentSnapshot => captureCanonicalSnapshot({
  schemaVersion: "0.1",
  surfaceId: "fixture-surface",
  revision,
  title: "Synthetic replay fixture",
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

const lifecycle = (
  entries: readonly (readonly [
    AgentReplayExpectedEvent["event"],
    AgentReplayExpectedEvent["outcome"],
    AgentReplayExpectedEvent["revisionRef"]?,
    boolean?,
  ])[],
): AgentReplayExpectedEvent[] => entries.map(
  ([event, outcome, revisionRef = "revision-1", includeAction = true], index) => ({
    event,
    outcome,
    sequence: index + 1,
    revisionRef,
    ...(includeAction ? { actionRef: "action-1" as const } : {}),
  }),
);

type UnsignedFixture = Omit<AgentReplayFixture, "fixtureDigest">;

async function sealFixture(unsigned: UnsignedFixture): Promise<AgentReplayFixture> {
  const canonical = descriptorSafeCaptureJson(unsigned, {
    maxCharacters: 2_097_152,
    maxStringLength: 32_768,
    maxNodes: 250_000,
  });
  const bytes = new TextEncoder().encode(
    `${DIGEST_DOMAIN}${JSON.stringify(canonical)}`,
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return { ...unsigned, fixtureDigest: `sha256:${hex}` };
}

async function fixture(options: {
  readonly fixtureId: string;
  readonly action?: Partial<AgentActionSnapshot>;
  readonly request?: Partial<AgentReplayStep["request"]>;
  readonly controls?: Partial<AgentReplayStep["controls"]>;
  readonly expected: AgentReplayStep["expected"];
  readonly nextRevision?: string;
  readonly finalRevision?: string;
}): Promise<AgentReplayFixture> {
  const action: AgentActionSnapshot = {
    name: "submit",
    risk: "write",
    effects: ["persisted"],
    ...options.action,
  };
  const initialSnapshot = snapshot("runtime-revision-a", action);
  const nextSnapshot = snapshot(
    options.nextRevision ?? "runtime-revision-b",
    action,
  );
  const expectedFinalSnapshot = options.finalRevision === "next"
    ? nextSnapshot
    : initialSnapshot;
  const requestedExecution = options.controls?.execution;
  const execution = requestedExecution?.kind === "throw"
    ? requestedExecution
    : {
        kind: "transition" as const,
        nextSnapshot: requestedExecution?.nextSnapshot ?? nextSnapshot,
        ...(requestedExecution?.output !== undefined
          ? { output: requestedExecution.output }
          : {}),
      };
  const { execution: _execution, ...controlOverrides } = options.controls ?? {};
  return sealFixture({
    schemaVersion: "0.1",
    kind: "agent-replay-fixture",
    fixtureId: options.fixtureId,
    surfaceId: "fixture-surface",
    environment: {
      origin: "https://fixture.example",
      generation: "generation-1",
    },
    initialSnapshot,
    steps: [{
      request: {
        surfaceId: "fixture-surface",
        revision: "runtime-revision-a",
        elementId: "submit",
        action: "submit",
        ...options.request,
      },
      controls: {
        policy: "allow",
        effects: { persisted: true },
        ...controlOverrides,
        execution,
      },
      expected: options.expected,
    }],
    expectedFinalSnapshot,
  });
}

describe("synthetic replay harness", () => {
  it.each([
    {
      name: "invalid input",
      id: "invalid-input",
      action: {
        inputSchema: {
          type: "object",
          required: ["value"],
          additionalProperties: false,
          properties: { value: { type: "string" } },
        },
      },
      request: { input: { value: 7 } },
      code: "invalid_input" as const,
      events: lifecycle([
        ["action_requested", "requested"],
        ["action_failed", "invalid_input"],
      ]),
    },
    {
      name: "policy denial",
      id: "policy-denial",
      controls: { policy: "deny" as const },
      code: "authorization_required" as const,
      events: lifecycle([
        ["action_requested", "requested"],
        ["policy_decided", "deny"],
        ["action_failed", "authorization_required"],
      ]),
    },
    {
      name: "confirmation decline",
      id: "confirmation-decline",
      action: { requiresConfirmation: true },
      controls: { confirmation: false },
      code: "confirmation_required" as const,
      events: lifecycle([
        ["action_requested", "requested"],
        ["policy_decided", "allow"],
        ["confirmation_requested", "requested"],
        ["action_failed", "confirmation_required"],
      ]),
    },
    {
      name: "stale revision",
      id: "stale-revision",
      request: { revision: "stale-revision" },
      code: "stale_revision" as const,
      events: lifecycle([
        ["action_failed", "stale_revision", "revision-1", false],
      ]),
    },
    {
      name: "precondition failure",
      id: "precondition-failure",
      action: { preconditions: ["ready"] },
      controls: { preconditions: { ready: false } },
      code: "precondition_failed" as const,
      events: lifecycle([
        ["action_requested", "requested"],
        ["policy_decided", "allow"],
        ["action_failed", "precondition_failed"],
      ]),
    },
    {
      name: "execution failure",
      id: "execution-failure",
      controls: { execution: { kind: "throw" as const } },
      code: "internal_error" as const,
      events: lifecycle([
        ["action_requested", "requested"],
        ["policy_decided", "allow"],
        ["action_started", "started"],
        ["action_failed", "internal_error"],
      ]),
    },
    {
      name: "invalid output",
      id: "invalid-output",
      action: { outputSchema: { type: "string" } },
      controls: { execution: { kind: "transition" as const, nextSnapshot: undefined as never, output: 7 } },
      code: "invalid_output" as const,
      finalRevision: "next",
      events: lifecycle([
        ["action_requested", "requested"],
        ["policy_decided", "allow"],
        ["action_started", "started"],
        ["action_failed", "invalid_output", "revision-2"],
      ]),
    },
    {
      name: "verification failure",
      id: "verification-failure",
      controls: { effects: { persisted: false } },
      code: "verification_failed" as const,
      finalRevision: "next",
      events: lifecycle([
        ["action_requested", "requested"],
        ["policy_decided", "allow"],
        ["action_started", "started"],
        ["action_failed", "verification_failed", "revision-2"],
      ]),
    },
  ])("replays $name deterministically", async (scenario) => {
    const built = await fixture({
      fixtureId: scenario.id,
      ...(scenario.action ? { action: scenario.action } : {}),
      ...(scenario.request ? { request: scenario.request } : {}),
      ...(scenario.controls ? { controls: scenario.controls } : {}),
      ...(scenario.finalRevision ? { finalRevision: scenario.finalRevision } : {}),
      expected: {
        outcome: { status: "failed", code: scenario.code },
        lifecycle: scenario.events,
      },
    });
    expect(await captureAgentReplayFixture(built)).toMatchObject({ status: "valid" });
    expect(await replayAgentFixture(built)).toMatchObject({
      status: "matched",
      fixtureId: scenario.id,
    });
  });

  it("detects a keyed replay conflict without executing a second transition", async () => {
    const action: AgentActionSnapshot = {
      name: "submit",
      risk: "write",
      effects: ["persisted"],
      idempotency: "keyed",
      inputSchema: { type: "object" },
    };
    const initialSnapshot = snapshot("runtime-revision-a", action);
    const changedSnapshot = snapshot("runtime-revision-b", action);
    const firstLifecycle = lifecycle([
      ["action_requested", "requested"],
      ["policy_decided", "allow"],
      ["action_started", "started"],
      ["action_verified", "succeeded", "revision-2"],
    ]);
    const conflictLifecycle = lifecycle([
      ["action_requested", "requested", "revision-2"],
      ["action_failed", "idempotency_conflict", "revision-2"],
    ]);
    const built = await sealFixture({
      schemaVersion: "0.1",
      kind: "agent-replay-fixture",
      fixtureId: "keyed-conflict",
      surfaceId: "fixture-surface",
      environment: { origin: "https://fixture.example", generation: "generation-1" },
      initialSnapshot,
      steps: [
        {
          request: {
            surfaceId: "fixture-surface",
            revision: "runtime-revision-a",
            elementId: "submit",
            action: "submit",
            input: { value: "first" },
            idempotencyKey: "stable-key",
          },
          controls: {
            policy: "allow",
            effects: { persisted: true },
            execution: { kind: "transition", nextSnapshot: changedSnapshot },
          },
          expected: {
            outcome: { status: "succeeded", revisionRef: "revision-2" },
            lifecycle: firstLifecycle,
          },
        },
        {
          request: {
            surfaceId: "fixture-surface",
            revision: "runtime-revision-b",
            elementId: "submit",
            action: "submit",
            input: { value: "different" },
            idempotencyKey: "stable-key",
          },
          controls: {
            policy: "allow",
            effects: { persisted: true },
            execution: { kind: "throw" },
          },
          expected: {
            outcome: { status: "failed", code: "idempotency_conflict" },
            lifecycle: conflictLifecycle,
          },
        },
      ],
      expectedFinalSnapshot: changedSnapshot,
    });

    const result = await replayAgentFixture(built);
    expect(result).toMatchObject({
      status: "matched",
      fixtureId: "keyed-conflict",
      outcomes: [
        { operation: 1, status: "succeeded", revisionRef: "revision-2" },
        { operation: 2, status: "failed", code: "idempotency_conflict" },
      ],
    });
  });

  it("returns bounded structural mismatch evidence instead of fixture payloads", async () => {
    const built = await fixture({
      fixtureId: "mismatch-evidence",
      expected: {
        outcome: { status: "failed", code: "authorization_required" },
        lifecycle: lifecycle([
          ["action_requested", "requested"],
          ["policy_decided", "deny"],
          ["action_failed", "authorization_required"],
        ]),
      },
      controls: { policy: "allow" },
    });
    const result = await replayAgentFixture(built);
    expect(result).toEqual({
      status: "mismatch",
      fixtureId: "mismatch-evidence",
      differences: expect.arrayContaining([
        { path: "outcome", operation: 1 },
        { path: "lifecycle", operation: 1, index: 1 },
      ]),
    });
    expect(JSON.stringify(result)).not.toContain("fixture.example");
  });

  it("produces the same normalized result across repeated fresh runs", async () => {
    const built = await fixture({
      fixtureId: "repeatable-success",
      action: { risk: "read", effects: [] },
      controls: {
        execution: {
          kind: "transition",
          nextSnapshot: snapshot("runtime-revision-b", {
            name: "submit",
            risk: "read",
          }),
          output: { accepted: true } as AgentJsonValue,
        },
      },
      finalRevision: "next",
      expected: {
        outcome: { status: "succeeded", revisionRef: "revision-2" },
        lifecycle: lifecycle([
          ["action_requested", "requested"],
          ["policy_decided", "allow"],
          ["action_started", "started"],
          ["action_verified", "succeeded", "revision-2"],
        ]),
      },
    });
    expect(await replayAgentFixture(built)).toEqual(await replayAgentFixture(built));
  });
});
