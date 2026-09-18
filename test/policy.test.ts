// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AgentAuthorizationRequiredError,
  AgentConfirmationRequiredError,
  AgentInvalidPolicyDecisionError,
  AgentStaleRevisionError,
  createAgentSurface,
} from "../src/index.js";

describe("AgentSurface policy boundary", () => {
  beforeEach(() => {
    document.body.innerHTML = `<button>Submit</button>`;
  });

  function createRegisteredSurface(
    options: Parameters<typeof createAgentSurface>[0],
    definition: { requiresConfirmation?: boolean } = {},
  ) {
    const handler = vi.fn();
    const surface = createAgentSurface({
      surfaceId: "checkout",
      verifyEffect: () => true,
      ...options,
    });
    surface.register(document.querySelector("button")!, {
      id: "submit-order",
      actions: {
        submit_order: {
          risk: "consequential",
          effects: ["order_submitted"],
          ...(definition.requiresConfirmation !== undefined
            ? { requiresConfirmation: definition.requiresConfirmation }
            : {}),
          handler,
        },
      },
    });
    return { handler, surface };
  }

  function actionRequest(surface: ReturnType<typeof createAgentSurface>) {
    const snapshot = surface.snapshot();
    return {
      surfaceId: snapshot.surfaceId,
      revision: snapshot.revision,
      elementId: "submit-order",
      action: "submit_order",
    };
  }

  it("binds allow decisions to principal, origin, surface, and action context", async () => {
    const policy = vi.fn(() => ({ outcome: "allow" as const }));
    const { handler, surface } = createRegisteredSurface({
      getPrincipal: () => ({ id: "user-7", roles: ["buyer"] }),
      policy,
    });
    const request = actionRequest(surface);

    await surface.perform(request);

    expect(handler).toHaveBeenCalledOnce();
    expect(policy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "submit_order",
        elementId: "submit-order",
        origin: window.location.origin,
        principal: { id: "user-7", roles: ["buyer"] },
        revision: request.revision,
        risk: "consequential",
        surfaceId: "checkout",
      }),
    );
  });

  it("blocks a deny decision before execution", async () => {
    const authorize = vi.fn(() => true);
    const { handler, surface } = createRegisteredSurface({
      policy: () => ({ outcome: "deny", reason: "permission_missing" }),
      authorize,
    });

    await expect(surface.perform(actionRequest(surface))).rejects.toBeInstanceOf(
      AgentAuthorizationRequiredError,
    );
    expect(authorize).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("requires trusted confirmation when policy requests it", async () => {
    const { handler, surface } = createRegisteredSurface({
      policy: () => ({ outcome: "require_confirmation" }),
    });

    await expect(surface.perform(actionRequest(surface))).rejects.toMatchObject({
      code: "confirmation_required",
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("executes only after trusted confirmation succeeds", async () => {
    const confirm = vi.fn(() => true);
    const { handler, surface } = createRegisteredSurface({
      policy: () => ({ outcome: "require_confirmation" }),
      confirm,
    });
    const request = actionRequest(surface);

    await surface.perform(request);

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "submit_order",
        decision: { outcome: "require_confirmation" },
        revision: request.revision,
      }),
    );
    expect(handler).toHaveBeenCalledOnce();
  });

  it("action metadata forces confirmation even after an allow decision", async () => {
    const confirm = vi.fn(() => false);
    const { handler, surface } = createRegisteredSurface(
      {
        policy: () => ({ outcome: "allow" }),
        confirm,
      },
      { requiresConfirmation: true },
    );

    await expect(surface.perform(actionRequest(surface))).rejects.toBeInstanceOf(
      AgentConfirmationRequiredError,
    );
    expect(confirm).toHaveBeenCalledOnce();
    expect(handler).not.toHaveBeenCalled();
  });

  it("fails closed on an invalid policy decision", async () => {
    const { handler, surface } = createRegisteredSurface({
      policy: (() => ({ outcome: "maybe" })) as never,
    });

    await expect(surface.perform(actionRequest(surface))).rejects.toBeInstanceOf(
      AgentInvalidPolicyDecisionError,
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects semantic drift that occurs while policy is pending", async () => {
    document.body.innerHTML = `
      <label for="name">Name</label>
      <input id="name" value="Old">
      <button>Submit</button>
    `;
    const handler = vi.fn();
    const surface = createAgentSurface({
      policy: async () => {
        document.querySelector("input")!.value = "Changed";
        return { outcome: "allow" };
      },
    });
    surface.register(document.querySelector("button")!, {
      id: "submit-order",
      actions: { submit_order: { risk: "write", handler } },
    });

    await expect(surface.perform(actionRequest(surface))).rejects.toBeInstanceOf(
      AgentStaleRevisionError,
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("preserves the legacy boolean authorizer for non-confirmed actions", async () => {
    const authorize = vi.fn(() => true);
    const { handler, surface } = createRegisteredSurface({ authorize });

    await surface.perform(actionRequest(surface));

    expect(authorize).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledOnce();
  });
});
