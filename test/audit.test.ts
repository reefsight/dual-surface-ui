// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AgentAuthorizationRequiredError,
  AgentConfirmationRequiredError,
  createAgentSurface,
} from "../src/index.js";
import type {
  AgentActionRequest,
  AgentAuditEvent,
  AgentPolicyOutcome,
} from "../src/index.js";

describe("AgentSurface redacted lifecycle events", () => {
  beforeEach(() => {
    document.body.innerHTML = `<button>Submit</button>`;
  });

  function createAuditedAction(options: {
    confirm?: boolean;
    handler?: () => unknown;
    idempotency?: "keyed";
    onAudit?: (event: AgentAuditEvent) => unknown;
    policyOutcome?: AgentPolicyOutcome;
  } = {}) {
    const events: AgentAuditEvent[] = [];
    let nextCorrelation = 1;
    const button = document.querySelector("button") as HTMLButtonElement;
    const surface = createAgentSurface({
      surfaceId: "checkout",
      createCorrelationId: () => `correlation-${nextCorrelation++}`,
      getPrincipal: () => ({ id: "principal-secret", roles: ["admin"] }),
      policy: () => ({
        outcome: options.policyOutcome ?? "allow",
        reason: "policy-secret-reason",
      }),
      confirm: () => options.confirm ?? true,
      verifyEffect: () => true,
      onAudit: options.onAudit ?? ((event) => events.push(event)),
    });
    surface.register(button, {
      id: "submit",
      actions: {
        submit_order: {
          risk: "consequential",
          effects: ["order_submitted"],
          idempotency: options.idempotency,
          handler:
            options.handler ??
            (() => {
              button.disabled = true;
            }),
        },
      },
    });
    const snapshot = surface.snapshot();
    const request: AgentActionRequest = {
      surfaceId: snapshot.surfaceId,
      revision: snapshot.revision,
      elementId: "submit",
      action: "submit_order",
      input: { password: "input-secret" },
      ...(options.idempotency
        ? { idempotencyKey: "idempotency-secret-key" }
        : {}),
    };
    return { events, request, surface };
  }

  it("emits one public observation event and no internal observation noise", async () => {
    const { events, request, surface } = createAuditedAction();

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(
      expect.objectContaining({
        event: "surface_observed",
        outcome: "observed",
        sequence: 1,
      }),
    );
    expect(events[0]).not.toHaveProperty("action");

    events.length = 0;
    await surface.perform(request);

    expect(events.map((event) => event.event)).toEqual([
      "action_requested",
      "policy_decided",
      "action_started",
      "action_verified",
    ]);
    expect(events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "surface_observed" }),
      ]),
    );
  });

  it("emits the confirmed success lifecycle in order with stable metadata", async () => {
    const { events, request, surface } = createAuditedAction({
      policyOutcome: "require_confirmation",
    });
    events.length = 0;

    await surface.perform(request);

    expect(events.map(({ event, outcome }) => [event, outcome])).toEqual([
      ["action_requested", "requested"],
      ["policy_decided", "require_confirmation"],
      ["confirmation_requested", "requested"],
      ["action_started", "started"],
      ["action_verified", "succeeded"],
    ]);
    expect(new Set(events.map((event) => event.correlationId))).toEqual(
      new Set(["correlation-2"]),
    );
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5]);
    for (const event of events) {
      expect(event).toEqual(
        expect.objectContaining({
          schemaVersion: "0.1",
          surfaceId: "checkout",
          action: "submit_order",
          timestamp: expect.any(String),
          durationMs: expect.any(Number),
        }),
      );
      expect(event.durationMs).toBeGreaterThanOrEqual(0);
      expect(Number.isNaN(Date.parse(event.timestamp))).toBe(false);
      expect(Object.isFrozen(event)).toBe(true);
    }
  });

  it.each([
    ["deny", AgentAuthorizationRequiredError, "authorization_required"],
    [
      "require_confirmation",
      AgentConfirmationRequiredError,
      "confirmation_required",
    ],
  ] as const)(
    "emits a redacted terminal failure for %s",
    async (policyOutcome, errorType, failureOutcome) => {
      const { events, request, surface } = createAuditedAction({
        confirm: false,
        policyOutcome,
      });
      events.length = 0;

      await expect(surface.perform(request)).rejects.toBeInstanceOf(errorType);

      expect(events.at(-1)).toEqual(
        expect.objectContaining({
          event: "action_failed",
          outcome: failureOutcome,
          action: "submit_order",
        }),
      );
      expect(events.some((event) => event.event === "action_started")).toBe(
        false,
      );
    },
  );

  it("reduces unknown handler failures to internal_error without leaking data", async () => {
    const handlerSecret = "handler-secret-message";
    const { events, request, surface } = createAuditedAction({
      handler: () => {
        throw new Error(handlerSecret);
      },
      idempotency: "keyed",
    });
    events.length = 0;

    await expect(surface.perform(request)).rejects.toThrow(handlerSecret);

    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        event: "action_failed",
        outcome: "internal_error",
      }),
    );
    const serialized = JSON.stringify(events);
    for (const secret of [
      handlerSecret,
      "input-secret",
      "principal-secret",
      "policy-secret-reason",
      "idempotency-secret-key",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    for (const prohibited of [
      "targetId",
      "elementId",
      "input",
      "output",
      "principal",
      "origin",
      "reason",
      "idempotencyKey",
      "fingerprint",
      "cause",
      "stack",
    ]) {
      expect(serialized).not.toContain(`"${prohibited}"`);
    }
  });

  it("does not reflect unresolved request action data in early failures", async () => {
    const { events, request, surface } = createAuditedAction();
    events.length = 0;
    const untrustedAction = "secret-but-schema-shaped-action";

    await expect(
      surface.perform({
        ...request,
        surfaceId: "wrong-surface",
        action: untrustedAction,
      }),
    ).rejects.toThrow();

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(
      expect.objectContaining({
        event: "action_failed",
        outcome: "surface_mismatch",
      }),
    );
    expect(events[0]).not.toHaveProperty("action");
    expect(JSON.stringify(events)).not.toContain(untrustedAction);
  });

  it("normalizes non-Error thrown values in audit events", async () => {
    const secret = "non-error-secret";
    const { events, request, surface } = createAuditedAction({
      handler: () => {
        throw { token: secret };
      },
    });
    events.length = 0;

    await expect(surface.perform(request)).rejects.toEqual({ token: secret });

    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        event: "action_failed",
        outcome: "internal_error",
      }),
    );
    expect(JSON.stringify(events)).not.toContain(secret);
  });

  it("labels an idempotent replay without duplicating execution events", async () => {
    const handler = vi.fn(() => {
      (document.querySelector("button") as HTMLButtonElement).disabled = true;
    });
    const { events, request, surface } = createAuditedAction({
      handler,
      idempotency: "keyed",
    });
    events.length = 0;
    await surface.perform(request);
    events.length = 0;

    await surface.perform(request);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(events.map(({ event, outcome }) => [event, outcome])).toEqual([
      ["action_requested", "requested"],
      ["action_verified", "replayed"],
    ]);
    expect(new Set(events.map((event) => event.correlationId)).size).toBe(1);
  });

  it("isolates throwing and rejected observers from successful actions", async () => {
    const throwing = createAuditedAction({
      onAudit: () => {
        throw new Error("sink-secret");
      },
    });
    await expect(throwing.surface.perform(throwing.request)).resolves.toEqual(
      expect.objectContaining({ status: "succeeded" }),
    );

    document.body.innerHTML = `<button>Submit</button>`;
    const rejecting = createAuditedAction({
      onAudit: () => Promise.reject(new Error("async-sink-secret")),
    });
    await expect(rejecting.surface.perform(rejecting.request)).resolves.toEqual(
      expect.objectContaining({ status: "succeeded" }),
    );
    await Promise.resolve();
  });

  it("suppresses synchronous observer re-entry and falls back from bad IDs", () => {
    const events: AgentAuditEvent[] = [];
    const factory = vi
      .fn<() => string>()
      .mockReturnValueOnce("invalid correlation id")
      .mockImplementationOnce(() => {
        throw new Error("factory-secret");
      });
    let surface: ReturnType<typeof createAgentSurface>;
    surface = createAgentSurface({
      surfaceId: "checkout",
      createCorrelationId: factory,
      onAudit: (event) => {
        events.push(event);
        surface.snapshot();
      },
    });

    surface.snapshot();
    surface.snapshot();

    expect(events).toHaveLength(2);
    expect(events.map((event) => event.correlationId)).toEqual([
      "audit-1",
      "audit-2",
    ]);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("does not call the correlation factory when auditing is disabled", () => {
    const createCorrelationId = vi.fn(() => "unused-correlation");
    const surface = createAgentSurface({ createCorrelationId });

    surface.snapshot();

    expect(createCorrelationId).not.toHaveBeenCalled();
  });

  it("rejects a URL-shaped surface identifier when auditing is enabled", () => {
    expect(() =>
      createAgentSurface({
        surfaceId: "https://example.test/checkout?token=secret",
        onAudit: () => undefined,
      }),
    ).toThrow(RangeError);
  });
});
