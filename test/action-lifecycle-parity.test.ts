// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentSurface } from "../src/index.js";
import { AgentActionLifecycleCoordinator } from "../src/internal/action-lifecycle.js";
import type {
  AgentActionRequest,
  AgentActionSnapshot,
  AgentAuditEvent,
  AgentSnapshot,
} from "../src/index.js";

const action: AgentActionSnapshot = {
  name: "commit",
  risk: "write",
  idempotency: "keyed",
  effects: ["committed"],
  outputSchema: {
    type: "object",
    properties: { committed: { const: true } },
    required: ["committed"],
    additionalProperties: false,
  },
};

function fakeSnapshot(
  revision: string,
  committed: boolean,
  snapshotAction: AgentActionSnapshot = action,
): AgentSnapshot {
  return {
    schemaVersion: "0.1",
    surfaceId: "fake-surface",
    revision,
    title: "Fake",
    url: "https://example.test/fake",
    generatedAt: "2026-09-19T00:00:00.000Z",
    capabilities: ["snapshot", "perform"],
    nodes: [
      {
        id: "commit-button",
        role: "button",
        name: committed ? "Committed" : "Commit",
        state: {},
        actions: [snapshotAction],
      },
    ],
  };
}

describe("backend-neutral action lifecycle coordinator", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps fake-backend execution, replay, and audit ordering aligned with AgentSurface", async () => {
    const domEvents: AgentAuditEvent[] = [];
    const fakeEvents: AgentAuditEvent[] = [];
    const domHandler = vi.fn(() => {
      button.textContent = "Committed";
      return { committed: true };
    });
    const button = document.createElement("button");
    button.textContent = "Commit";
    document.body.append(button);
    const surface = new AgentSurface({
      surfaceId: "dom-surface",
      policy: () => ({ outcome: "allow" }),
      verifyEffect: () => true,
      onAudit: (event) => domEvents.push(event),
      createCorrelationId: () => "dom-correlation",
    });
    surface.register(button, {
      id: "commit-button",
      actions: {
        commit: {
          ...action,
          handler: domHandler,
        },
      },
    });
    const domRevision = surface.snapshot().revision;
    domEvents.length = 0;

    let committed = false;
    const fakeExecute = vi.fn(() => {
      committed = true;
      return { committed: true };
    });
    const fake = new AgentActionLifecycleCoordinator<object>({
      backend: {
        captureContext: () => ({
          generation: "generation-1",
          origin: "https://example.test",
        }),
        captureSnapshot: () => fakeSnapshot(committed ? "1" : "0", committed),
        lastKnownRevision: () => (committed ? "1" : "0"),
        resolveTarget: () => ({
          execute: fakeExecute,
          target: {},
        }),
        surfaceId: "fake-surface",
      },
      hooks: {
        policy: () => ({ outcome: "allow" }),
        verifyEffect: () => true,
        onAudit: (event) => fakeEvents.push(event),
        createCorrelationId: () => "fake-correlation",
      },
      idempotencyCacheSize: 8,
    });

    const domRequest: AgentActionRequest = {
      surfaceId: "dom-surface",
      revision: domRevision,
      elementId: "commit-button",
      action: "commit",
      idempotencyKey: "commit-1",
    };
    const fakeRequest: AgentActionRequest = {
      ...domRequest,
      surfaceId: "fake-surface",
      revision: "0",
    };
    const [domFirst, fakeFirst] = await Promise.all([
      surface.perform(domRequest),
      fake.perform(fakeRequest),
    ]);
    const [domReplay, fakeReplay] = await Promise.all([
      surface.perform(domRequest),
      fake.perform(fakeRequest),
    ]);

    expect(domFirst.status).toBe(fakeFirst.status);
    expect(domFirst.output).toEqual(fakeFirst.output);
    expect(domReplay.output).toEqual(fakeReplay.output);
    expect(domHandler).toHaveBeenCalledOnce();
    expect(fakeExecute).toHaveBeenCalledOnce();
    expect(domEvents.map(({ event, outcome }) => [event, outcome])).toEqual(
      fakeEvents.map(({ event, outcome }) => [event, outcome]),
    );
  });

  it("checks backend generation after each asynchronous precondition", async () => {
    let generation = "generation-1";
    let preconditionCount = 0;
    const execute = vi.fn();
    const preconditionAction: AgentActionSnapshot = {
      ...action,
      idempotency: "none",
      preconditions: ["first", "second"],
    };
    const coordinator = new AgentActionLifecycleCoordinator<object>({
      backend: {
        captureContext: () => ({
          generation,
          origin: "https://example.test",
        }),
        captureSnapshot: () => fakeSnapshot("0", false, preconditionAction),
        lastKnownRevision: () => "0",
        resolveTarget: () => ({
          execute,
          target: {},
        }),
        surfaceId: "fake-surface",
      },
      hooks: {
        policy: () => ({ outcome: "allow" }),
        checkPrecondition: async () => {
          preconditionCount += 1;
          if (preconditionCount === 1) generation = "generation-2";
          return true;
        },
        verifyEffect: () => true,
      },
      idempotencyCacheSize: 8,
    });

    const outcome = await coordinator.performSafe({
      surfaceId: "fake-surface",
      revision: "0",
      elementId: "commit-button",
      action: "commit",
    });

    expect(outcome).toMatchObject({
      status: "failed",
      revision: "0",
      error: { code: "stale_revision" },
    });
    expect(preconditionCount).toBe(1);
    expect(execute).not.toHaveBeenCalled();
  });

  it("rechecks semantic revision after each precondition", async () => {
    let revision = "0";
    let preconditionCount = 0;
    const execute = vi.fn();
    const preconditionAction: AgentActionSnapshot = {
      ...action,
      idempotency: "none",
      preconditions: ["first", "second"],
    };
    const coordinator = new AgentActionLifecycleCoordinator<object>({
      backend: {
        captureContext: () => ({
          generation: "generation-1",
          origin: "https://example.test",
        }),
        captureSnapshot: () =>
          fakeSnapshot(revision, false, preconditionAction),
        lastKnownRevision: () => revision,
        resolveTarget: () => ({
          execute,
          target: {},
        }),
        surfaceId: "fake-surface",
      },
      hooks: {
        policy: () => ({ outcome: "allow" }),
        checkPrecondition: async () => {
          preconditionCount += 1;
          if (preconditionCount === 1) revision = "1";
          return true;
        },
        verifyEffect: () => true,
      },
      idempotencyCacheSize: 8,
    });

    const outcome = await coordinator.performSafe({
      surfaceId: "fake-surface",
      revision: "0",
      elementId: "commit-button",
      action: "commit",
    });

    expect(outcome).toMatchObject({
      status: "failed",
      revision: "1",
      error: { code: "stale_revision" },
    });
    expect(preconditionCount).toBe(1);
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects an identically re-registered capability before its captured handler executes", async () => {
    const button = document.createElement("button");
    button.textContent = "Commit";
    document.body.append(button);
    const handler = vi.fn(() => ({ committed: true }));
    let releasePolicy!: () => void;
    const policyReached = new Promise<void>((resolve) => {
      releasePolicy = resolve;
    });
    let continuePolicy!: () => void;
    const policyWait = new Promise<void>((resolve) => {
      continuePolicy = resolve;
    });
    const policy = vi.fn(async () => {
      releasePolicy();
      await policyWait;
      return { outcome: "allow" as const };
    });
    const surface = new AgentSurface({
      surfaceId: "dom-surface",
      policy,
      verifyEffect: () => true,
    });
    const definition = {
      id: "commit-button",
      actions: {
        commit: {
          ...action,
          handler,
        },
      },
    };
    surface.register(button, definition);
    const revision = surface.snapshot().revision;
    const pending = surface.performSafe({
      surfaceId: "dom-surface",
      revision,
      elementId: "commit-button",
      action: "commit",
      idempotencyKey: "commit-1",
    });

    await policyReached;
    surface.register(button, definition);
    expect(surface.snapshot().revision).toBe(revision);
    continuePolicy();
    const outcome = await pending;

    expect(outcome).toMatchObject({
      status: "failed",
      error: { code: "stale_revision" },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("selects target and action from the captured snapshot before backend resolution", async () => {
    let snapshotSurfaceId = "fake-surface";
    const resolveTarget = vi.fn(() => ({
      execute: vi.fn(),
      target: {},
    }));
    const coordinator = new AgentActionLifecycleCoordinator<object>({
      backend: {
        captureContext: () => ({
          generation: "generation-1",
          origin: "https://example.test",
        }),
        captureSnapshot: () => ({
          ...fakeSnapshot("0", false),
          surfaceId: snapshotSurfaceId,
        }),
        lastKnownRevision: () => "0",
        resolveTarget,
        surfaceId: "fake-surface",
      },
      hooks: {},
      idempotencyCacheSize: 8,
    });

    const missingTarget = await coordinator.performSafe({
      surfaceId: "fake-surface",
      revision: "0",
      elementId: "missing",
      action: "commit",
    });
    const missingAction = await coordinator.performSafe({
      surfaceId: "fake-surface",
      revision: "0",
      elementId: "commit-button",
      action: "invented",
    });
    snapshotSurfaceId = "other-surface";
    const mismatchedSnapshot = await coordinator.performSafe({
      surfaceId: "fake-surface",
      revision: "0",
      elementId: "commit-button",
      action: "commit",
      idempotencyKey: "commit-mismatch",
    });

    expect(missingTarget).toMatchObject({
      status: "failed",
      error: { code: "element_not_found" },
    });
    expect(missingAction).toMatchObject({
      status: "failed",
      error: { code: "action_not_found" },
    });
    expect(mismatchedSnapshot).toMatchObject({
      status: "failed",
      error: { code: "surface_mismatch" },
    });
    expect(resolveTarget).not.toHaveBeenCalled();
  });

  it("rejects a stable context whose origin does not own the snapshot URL", async () => {
    const policy = vi.fn(() => ({ outcome: "allow" as const }));
    const execute = vi.fn();
    const coordinator = new AgentActionLifecycleCoordinator<object>({
      backend: {
        captureContext: () => ({
          generation: "generation-1",
          origin: "https://attacker.test",
        }),
        captureSnapshot: () => fakeSnapshot("0", false),
        lastKnownRevision: () => "0",
        resolveTarget: () => ({ execute, target: {} }),
        surfaceId: "fake-surface",
      },
      hooks: { policy },
      idempotencyCacheSize: 8,
    });

    const outcome = await coordinator.performSafe({
      surfaceId: "fake-surface",
      revision: "0",
      elementId: "commit-button",
      action: "commit",
      idempotencyKey: "origin-mismatch",
    });

    expect(outcome).toMatchObject({
      status: "failed",
      error: { code: "surface_mismatch" },
    });
    expect(policy).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("copies backend context values before an async hook can mutate them", async () => {
    const sharedContext = {
      generation: "generation-1",
      origin: "https://example.test",
    };
    const execute = vi.fn();
    const coordinator = new AgentActionLifecycleCoordinator<object>({
      backend: {
        captureContext: () => sharedContext,
        captureSnapshot: () => fakeSnapshot("0", false),
        lastKnownRevision: () => "0",
        resolveTarget: () => ({ execute, target: {} }),
        surfaceId: "fake-surface",
      },
      hooks: {
        policy: () => {
          sharedContext.generation = "generation-2";
          return { outcome: "allow" };
        },
      },
      idempotencyCacheSize: 8,
    });

    const outcome = await coordinator.performSafe({
      surfaceId: "fake-surface",
      revision: "0",
      elementId: "commit-button",
      action: "commit",
      idempotencyKey: "mutable-context",
    });

    expect(outcome).toMatchObject({
      status: "failed",
      error: { code: "stale_revision" },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects identical target replacement and semantic ABA before execution", async () => {
    const runRace = async (mutate: (button: HTMLButtonElement) => void) => {
      const button = document.createElement("button");
      button.dataset.agentId = "race-button";
      button.textContent = "Commit";
      document.body.append(button);
      const invoked = vi.fn();
      button.addEventListener("click", invoked);
      const surface = new AgentSurface({
        surfaceId: "dom-surface",
        policy: () => {
          mutate(button);
          return { outcome: "allow" };
        },
      });
      const revision = surface.snapshot().revision;

      const outcome = await surface.performSafe({
        surfaceId: "dom-surface",
        revision,
        elementId: "race-button",
        action: "click",
      });

      expect(outcome).toMatchObject({
        status: "failed",
        error: { code: "stale_revision" },
      });
      expect(invoked).not.toHaveBeenCalled();
      document.body.innerHTML = "";
    };

    await runRace((button) => {
      const replacement = button.cloneNode(true);
      button.replaceWith(replacement);
    });
    await runRace((button) => {
      button.textContent = "Changed";
      button.textContent = "Commit";
    });
  });

  it("does not invalidate a target for unrelated hidden DOM activity", async () => {
    const button = document.createElement("button");
    button.dataset.agentId = "stable-button";
    button.textContent = "Commit";
    const hidden = document.createElement("div");
    hidden.hidden = true;
    document.body.append(button, hidden);
    const invoked = vi.fn(() => {
      button.textContent = "Committed";
    });
    button.addEventListener("click", invoked);
    const surface = new AgentSurface({
      surfaceId: "dom-surface",
      policy: () => {
        hidden.dataset.heartbeat = "1";
        return { outcome: "allow" };
      },
    });
    const revision = surface.snapshot().revision;

    const outcome = await surface.performSafe({
      surfaceId: "dom-surface",
      revision,
      elementId: "stable-button",
      action: "click",
    });

    expect(outcome).toMatchObject({ status: "succeeded" });
    expect(invoked).toHaveBeenCalledOnce();
  });

  it("does not let action_started observers retarget execution", async () => {
    const button = document.createElement("button");
    button.dataset.agentId = "audit-race-button";
    button.textContent = "Commit";
    document.body.append(button);
    const invoked = vi.fn(() => {
      button.textContent = "Committed";
    });
    button.addEventListener("click", invoked);
    const surface = new AgentSurface({
      surfaceId: "dom-surface",
      policy: () => ({ outcome: "allow" }),
      onAudit: (event) => {
        if (event.event === "action_started") {
          button.replaceWith(button.cloneNode(true));
        }
      },
      createCorrelationId: () => "audit-race",
    });
    const revision = surface.snapshot().revision;

    const outcome = await surface.performSafe({
      surfaceId: "dom-surface",
      revision,
      elementId: "audit-race-button",
      action: "click",
    });

    expect(outcome).toMatchObject({ status: "succeeded" });
    expect(invoked).toHaveBeenCalledOnce();
  });

  it("rejects same-document navigation ABA during policy", async () => {
    const button = document.createElement("button");
    button.dataset.agentId = "navigation-aba-button";
    button.textContent = "Commit";
    document.body.append(button);
    const invoked = vi.fn();
    button.addEventListener("click", invoked);
    const events: AgentAuditEvent[] = [];
    const originalUrl = window.location.href;
    const surface = new AgentSurface({
      surfaceId: "dom-surface",
      policy: () => {
        window.history.pushState({}, "", "/transient-route");
        window.history.pushState({}, "", originalUrl);
        return { outcome: "allow" };
      },
      onAudit: (event) => events.push(event),
      createCorrelationId: () => "navigation-aba",
    });
    const revision = surface.snapshot().revision;
    events.length = 0;

    const outcome = await surface.performSafe({
      surfaceId: "dom-surface",
      revision,
      elementId: "navigation-aba-button",
      action: "click",
    });

    expect(outcome).toMatchObject({
      status: "failed",
      error: { code: "stale_revision" },
    });
    expect(invoked).not.toHaveBeenCalled();
    expect(events.some(({ event }) => event === "action_started")).toBe(false);
    expect(window.location.href).toBe(originalUrl);
  });

  it("rejects fragment navigation ABA before queued hashchange events", async () => {
    const button = document.createElement("button");
    button.dataset.agentId = "hash-aba-button";
    button.textContent = "Commit";
    document.body.append(button);
    const invoked = vi.fn();
    button.addEventListener("click", invoked);
    const originalHash = window.location.hash;
    const surface = new AgentSurface({
      surfaceId: "dom-surface",
      policy: () => {
        window.location.hash = "#transient";
        window.location.hash = originalHash;
        return { outcome: "allow" };
      },
    });
    const revision = surface.snapshot().revision;

    const outcome = await surface.performSafe({
      surfaceId: "dom-surface",
      revision,
      elementId: "hash-aba-button",
      action: "click",
    });

    expect(outcome).toMatchObject({
      status: "failed",
      error: { code: "stale_revision" },
    });
    expect(invoked).not.toHaveBeenCalled();
    expect(window.location.hash).toBe(originalHash);
  });

  it("fails an atomic context change before execution but permits intentional navigation by the action", async () => {
    const events: AgentAuditEvent[] = [];
    let context = {
      generation: "generation-1",
      origin: "https://example.test",
    };
    let revision = "0";
    const execute = vi.fn(() => {
      context = {
        generation: "generation-2",
        origin: "https://example.test/next",
      };
      revision = "1";
      return { committed: true };
    });
    const makeCoordinator = (
      policy: () => { outcome: "allow" } = () => ({ outcome: "allow" }),
    ) =>
      new AgentActionLifecycleCoordinator<object>({
        backend: {
          captureContext: () => ({ ...context }),
          captureSnapshot: () => fakeSnapshot(revision, revision === "1"),
          lastKnownRevision: () => revision,
          resolveTarget: () => ({ execute, target: {} }),
          surfaceId: "fake-surface",
        },
        hooks: {
          policy,
          verifyEffect: () => true,
          onAudit: (event) => events.push(event),
          createCorrelationId: () => "context-race",
        },
        idempotencyCacheSize: 8,
      });

    const success = await makeCoordinator().performSafe({
      surfaceId: "fake-surface",
      revision: "0",
      elementId: "commit-button",
      action: "commit",
      idempotencyKey: "commit-navigation",
    });
    expect(success).toMatchObject({ status: "succeeded", revision: "1" });
    events.length = 0;
    events.length = 0;

    context = {
      generation: "generation-1",
      origin: "https://example.test",
    };
    revision = "0";
    execute.mockClear();
    const raced = makeCoordinator(() => {
      context = {
        generation: "generation-1",
        origin: "https://attacker.test",
      };
      return { outcome: "allow" };
    });
    const failure = await raced.performSafe({
      surfaceId: "fake-surface",
      revision: "0",
      elementId: "commit-button",
      action: "commit",
      idempotencyKey: "commit-race",
    });
    expect(failure).toMatchObject({
      status: "failed",
      error: { code: "stale_revision" },
    });
    expect(execute).not.toHaveBeenCalled();
    expect(events.some((event) => event.event === "action_started")).toBe(false);
    expect(events.some(({ event }) => event === "action_started")).toBe(false);
  });

  it.each([
    ["deny", "authorization_required"],
    ["decline", "confirmation_required"],
    ["precondition", "precondition_failed"],
  ] as const)("preserves %s failure precedence", async (scenario, code) => {
    const scenarioAction: AgentActionSnapshot = {
      ...action,
      idempotency: "none",
      ...(scenario === "decline" ? { requiresConfirmation: true } : {}),
      ...(scenario === "precondition"
        ? { preconditions: ["ready"] }
        : {}),
    };
    const execute = vi.fn();
    const events: AgentAuditEvent[] = [];
    let scenarioContext = {
      generation: "generation-1",
      origin: "https://example.test",
    };
    const driftContext = () => {
      scenarioContext = {
        generation: "generation-2",
        origin: "https://changed.test",
      };
    };
    const coordinator = new AgentActionLifecycleCoordinator<object>({
      backend: {
        captureContext: () => ({ ...scenarioContext }),
        captureSnapshot: () => fakeSnapshot("0", false, scenarioAction),
        lastKnownRevision: () => "0",
        resolveTarget: () => ({ execute, target: {} }),
        surfaceId: "fake-surface",
      },
      hooks: {
        policy: () => {
          if (scenario === "deny") driftContext();
          return { outcome: scenario === "deny" ? "deny" : "allow" };
        },
        ...(scenario === "decline"
          ? {
              confirm: () => {
                driftContext();
                return false;
              },
            }
          : {}),
        ...(scenario === "precondition"
          ? {
              checkPrecondition: () => {
                driftContext();
                return false;
              },
            }
          : {}),
        onAudit: (event) => events.push(event),
        createCorrelationId: () => `precedence-${scenario}`,
      },
      idempotencyCacheSize: 8,
    });

    const outcome = await coordinator.performSafe({
      surfaceId: "fake-surface",
      revision: "0",
      elementId: "commit-button",
      action: "commit",
    });
    expect(outcome).toMatchObject({ status: "failed", error: { code } });
    expect(execute).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({
      event: "action_failed",
      outcome: code,
    });
  });
});
