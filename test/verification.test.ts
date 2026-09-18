// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AgentPreconditionFailedError,
  AgentStaleRevisionError,
  AgentVerificationFailedError,
  createAgentSurface,
} from "../src/index.js";

describe("AgentSurface execution verification", () => {
  beforeEach(() => {
    document.body.innerHTML = `<button>Submit</button>`;
  });

  function requestFor(surface: ReturnType<typeof createAgentSurface>) {
    const snapshot = surface.snapshot();
    return {
      surfaceId: snapshot.surfaceId,
      revision: snapshot.revision,
      elementId: "submit",
      action: "submit_order",
      input: { token: "must-not-leak" },
    };
  }

  function registerDomainAction(
    surface: ReturnType<typeof createAgentSurface>,
    handler: () => void | Promise<void>,
    options: { effects?: string[]; preconditions?: string[] } = {},
  ) {
    surface.register(document.querySelector("button")!, {
      id: "submit",
      actions: {
        submit_order: {
          risk: "write",
          ...(options.effects ? { effects: options.effects } : {}),
          ...(options.preconditions
            ? { preconditions: options.preconditions }
            : {}),
          handler,
        },
      },
    });
  }

  it.each([
    ["missing", undefined],
    ["false", () => false],
    [
      "throws",
      () => {
        throw new Error("internal predicate detail");
      },
    ],
  ] as const)("blocks execution when a precondition checker is %s", async (_case, checker) => {
    const handler = vi.fn();
    const surface = createAgentSurface({
      authorize: () => true,
      ...(checker ? { checkPrecondition: checker } : {}),
      verifyEffect: () => true,
    });
    registerDomainAction(surface, handler, {
      preconditions: ["order_is_ready"],
      effects: ["order_submitted"],
    });

    await expect(surface.perform(requestFor(surface))).rejects.toBeInstanceOf(
      AgentPreconditionFailedError,
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects semantic drift caused while checking a precondition", async () => {
    document.body.insertAdjacentHTML(
      "afterbegin",
      `<label for="state">State</label><input id="state" value="ready">`,
    );
    const handler = vi.fn();
    const surface = createAgentSurface({
      authorize: () => true,
      checkPrecondition: async () => {
        document.querySelector("input")!.value = "changed";
        return true;
      },
      verifyEffect: () => true,
    });
    registerDomainAction(surface, handler, {
      preconditions: ["order_is_ready"],
      effects: ["order_submitted"],
    });

    await expect(surface.perform(requestFor(surface))).rejects.toBeInstanceOf(
      AgentStaleRevisionError,
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined],
    ["false", () => false],
    [
      "throws",
      () => {
        throw new Error("internal verifier detail");
      },
    ],
  ] as const)("does not report success when an effect verifier is %s", async (_case, verifier) => {
    const handler = vi.fn();
    const surface = createAgentSurface({
      authorize: () => true,
      ...(verifier ? { verifyEffect: verifier } : {}),
    });
    registerDomainAction(surface, handler, {
      effects: ["order_submitted"],
    });

    let caught: unknown;
    try {
      await surface.perform(requestFor(surface));
    } catch (error) {
      caught = error;
    }

    if (_case === "missing") {
      expect(handler).not.toHaveBeenCalled();
    } else {
      expect(handler).toHaveBeenCalledOnce();
    }
    expect(caught).toBeInstanceOf(AgentVerificationFailedError);
    expect(String(caught)).not.toContain("must-not-leak");
  });

  it("fails closed for a custom write action with no declared effects", async () => {
    const handler = vi.fn();
    const surface = createAgentSurface({ authorize: () => true });
    registerDomainAction(surface, handler);

    await expect(surface.perform(requestFor(surface))).rejects.toMatchObject({
      code: "verification_failed",
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns the final state only after every declared effect verifies", async () => {
    const button = document.querySelector("button") as HTMLButtonElement;
    const verifyEffect = vi.fn(({ after }) =>
      after.nodes.some(
        (node) => node.id === "submit" && node.state.disabled === true,
      ),
    );
    const surface = createAgentSurface({
      authorize: () => true,
      checkPrecondition: ({ precondition }) =>
        precondition === "order_is_ready",
      verifyEffect,
    });
    registerDomainAction(
      surface,
      () => {
        button.disabled = true;
      },
      {
        preconditions: ["order_is_ready"],
        effects: ["order_submitted", "button_disabled"],
      },
    );

    const result = await surface.perform(requestFor(surface));

    expect(verifyEffect).toHaveBeenCalledTimes(2);
    expect(result.revision).toBe("1");
    expect(result.node?.state.disabled).toBe(true);
  });

  it("verifies the native toggle transition", async () => {
    document.body.innerHTML = `
      <label><input type="checkbox" data-agent-id="terms"> Terms</label>
    `;
    const surface = createAgentSurface({ authorize: () => true });
    const snapshot = surface.snapshot();

    const result = await surface.perform({
      surfaceId: snapshot.surfaceId,
      revision: snapshot.revision,
      elementId: "terms",
      action: "toggle",
    });

    expect(result.node?.state.checked).toBe(true);
  });

  it("verifies credential input by presence without returning its value", async () => {
    document.body.innerHTML = `
      <label for="password">Password</label>
      <input id="password" type="password" data-agent-id="password">
    `;
    const surface = createAgentSurface({ authorize: () => true });
    const snapshot = surface.snapshot();

    const result = await surface.perform({
      surfaceId: snapshot.surfaceId,
      revision: snapshot.revision,
      elementId: "password",
      action: "set_value",
      input: "top-secret-value",
    });

    expect(result.node?.state).toEqual(
      expect.objectContaining({ sensitive: true, valuePresent: true }),
    );
    expect(result.node?.state.value).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("top-secret-value");
  });

  it("rejects a native click with no semantic transition", async () => {
    document.querySelector("button")!.setAttribute("data-agent-id", "submit");
    const surface = createAgentSurface({ authorize: () => true });
    const snapshot = surface.snapshot();

    await expect(
      surface.perform({
        surfaceId: snapshot.surfaceId,
        revision: snapshot.revision,
        elementId: "submit",
        action: "click",
      }),
    ).rejects.toBeInstanceOf(AgentVerificationFailedError);
  });

  it("accepts a native click only after a semantic transition", async () => {
    const button = document.querySelector("button") as HTMLButtonElement;
    button.setAttribute("data-agent-id", "submit");
    button.addEventListener("click", () => {
      button.disabled = true;
    });
    const surface = createAgentSurface({ authorize: () => true });
    const snapshot = surface.snapshot();

    const result = await surface.perform({
      surfaceId: snapshot.surfaceId,
      revision: snapshot.revision,
      elementId: "submit",
      action: "click",
    });

    expect(result.node?.state.disabled).toBe(true);
  });
});
