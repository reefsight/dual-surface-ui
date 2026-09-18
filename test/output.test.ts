// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AgentOutputValidationError,
  createAgentSurface,
} from "../src/index.js";

describe("AgentSurface handler output", () => {
  beforeEach(() => {
    document.body.innerHTML = `<button>Submit</button>`;
  });

  function createOutputAction(
    handler: () => unknown | Promise<unknown>,
    outputSchema?: Record<string, unknown>,
    verifyEffect = vi.fn(() => true),
  ) {
    const surface = createAgentSurface({
      authorize: () => true,
      verifyEffect,
    });
    surface.register(document.querySelector("button")!, {
      id: "submit",
      actions: {
        submit_order: {
          risk: "write",
          effects: ["order_submitted"],
          ...(outputSchema ? { outputSchema } : {}),
          handler,
        },
      },
    });
    return { surface, verifyEffect };
  }

  function requestFor(surface: ReturnType<typeof createAgentSurface>) {
    const snapshot = surface.snapshot();
    return {
      surfaceId: snapshot.surfaceId,
      revision: snapshot.revision,
      elementId: "submit",
      action: "submit_order",
    };
  }

  it.each([
    ["synchronous", () => ({ orderId: "order-123", accepted: true })],
    [
      "asynchronous",
      async () => ({ orderId: "order-123", accepted: true }),
    ],
  ] as const)("returns valid %s JSON output", async (_case, handler) => {
    const { surface } = createOutputAction(
      handler,
      {
        type: "object",
        additionalProperties: false,
        required: ["orderId", "accepted"],
        properties: {
          orderId: { type: "string" },
          accepted: { type: "boolean" },
        },
      },
    );

    const result = await surface.perform(requestFor(surface));

    expect(result.output).toEqual({
      orderId: "order-123",
      accepted: true,
    });
  });

  it("returns a detached JSON value instead of the handler object", async () => {
    const original = { orderId: "order-123" };
    const { surface } = createOutputAction(() => original, {
      type: "object",
      required: ["orderId"],
      properties: { orderId: { type: "string" } },
    });

    const result = await surface.perform(requestFor(surface));

    expect(result.output).toEqual(original);
    expect(result.output).not.toBe(original);
  });

  it("rejects schema-invalid output after verifying the effect", async () => {
    const verifyEffect = vi.fn(() => true);
    const { surface } = createOutputAction(
      () => ({ orderId: 123, secret: "must-not-leak" }),
      {
        type: "object",
        required: ["orderId"],
        properties: { orderId: { type: "string" } },
      },
      verifyEffect,
    );

    let caught: unknown;
    try {
      await surface.perform(requestFor(surface));
    } catch (error) {
      caught = error;
    }

    expect(verifyEffect).toHaveBeenCalledOnce();
    expect(caught).toBeInstanceOf(AgentOutputValidationError);
    expect(String(caught)).not.toContain("must-not-leak");
  });

  it.each([
    ["missing", () => undefined, { type: "object" }],
    ["malformed schema", () => ({ ok: true }), { type: "not-a-type" }],
    ["BigInt", () => 1n, {}],
    ["function", () => () => true, {}],
    [
      "throwing getter",
      () =>
        Object.defineProperty({}, "secret", {
          enumerable: true,
          get() {
            throw new Error("must-not-leak");
          },
        }),
      {},
    ],
    [
      "cyclic",
      () => {
        const value: Record<string, unknown> = {};
        value.self = value;
        return value;
      },
      {},
    ],
  ] as const)("fails closed for %s output", async (_case, handler, schema) => {
    const { surface } = createOutputAction(handler, schema);

    await expect(surface.perform(requestFor(surface))).rejects.toMatchObject({
      code: "invalid_output",
    });
  });

  it("reports effect failure before an invalid output contract", async () => {
    const { surface } = createOutputAction(
      () => ({ orderId: 123 }),
      {
        type: "object",
        required: ["orderId"],
        properties: { orderId: { type: "string" } },
      },
      vi.fn(() => false),
    );

    await expect(surface.perform(requestFor(surface))).rejects.toMatchObject({
      code: "verification_failed",
    });
  });

  it("does not inspect or expose output without an output schema", async () => {
    const toJSON = vi.fn(() => {
      throw new Error("must-not-serialize");
    });
    const { surface } = createOutputAction(() => ({
      secret: "must-not-leak",
      toJSON,
    }));

    const result = await surface.perform(requestFor(surface));

    expect(toJSON).not.toHaveBeenCalled();
    expect(result.output).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("must-not-leak");
  });
});
