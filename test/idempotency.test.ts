// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AgentIdempotencyConflictError,
  AgentIdempotencyKeyRequiredError,
  AgentInvalidIdempotencyKeyError,
  createAgentSurface,
} from "../src/index.js";
import type { AgentIdempotency, AgentSurfaceOptions } from "../src/index.js";

describe("AgentSurface idempotency and replay protection", () => {
  beforeEach(() => {
    document.body.innerHTML = `<button>Submit</button>`;
  });

  function createAction(options: {
    cacheSize?: number;
    getPrincipal?: AgentSurfaceOptions["getPrincipal"];
    handler: () => unknown | Promise<unknown>;
    idempotency?: AgentIdempotency;
  }) {
    const policy = vi.fn(() => ({ outcome: "allow" as const }));
    const verifyEffect = vi.fn(() => true);
    const surface = createAgentSurface({
      getPrincipal: options.getPrincipal,
      idempotencyCacheSize: options.cacheSize,
      policy,
      verifyEffect,
    });
    surface.register(document.querySelector("button")!, {
      id: "submit",
      actions: {
        submit_order: {
          risk: "consequential",
          effects: ["order_submitted"],
          idempotency: options.idempotency,
          outputSchema: {
            type: "object",
            required: ["attempt"],
            properties: { attempt: { type: "number" } },
          },
          handler: options.handler,
        },
      },
    });
    return { policy, surface, verifyEffect };
  }

  function requestFor(
    surface: ReturnType<typeof createAgentSurface>,
    key?: string,
    input: unknown = { orderId: "order-123" },
  ) {
    const snapshot = surface.snapshot();
    return {
      surfaceId: snapshot.surfaceId,
      revision: snapshot.revision,
      elementId: "submit",
      action: "submit_order",
      input,
      ...(key !== undefined ? { idempotencyKey: key } : {}),
    };
  }

  it("requires a valid key for keyed actions before policy or execution", async () => {
    const handler = vi.fn(() => ({ attempt: 1 }));
    const { policy, surface } = createAction({
      handler,
      idempotency: "keyed",
    });

    await expect(surface.perform(requestFor(surface))).rejects.toBeInstanceOf(
      AgentIdempotencyKeyRequiredError,
    );
    await expect(
      surface.perform(requestFor(surface, " contains spaces ")),
    ).rejects.toBeInstanceOf(AgentInvalidIdempotencyKeyError);
    expect(policy).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it.each(["none", "safe-retry"] as const)(
    "rejects a key when %s actions do not activate keyed protection",
    async (idempotency) => {
      const handler = vi.fn(() => ({ attempt: 1 }));
      const { surface } = createAction({ handler, idempotency });

      await expect(
        surface.perform(requestFor(surface, "request-1")),
      ).rejects.toBeInstanceOf(AgentInvalidIdempotencyKeyError);
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it("rejects non-JSON keyed input before policy or execution", async () => {
    const handler = vi.fn(() => ({ attempt: 1 }));
    const { policy, surface } = createAction({
      handler,
      idempotency: "keyed",
    });

    await expect(
      surface.perform(requestFor(surface, "request-1", { value: 1n })),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(policy).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns a detached cached result for an identical successful retry", async () => {
    let attempt = 0;
    const handler = vi.fn(() => ({ attempt: ++attempt }));
    const { policy, surface, verifyEffect } = createAction({
      handler,
      idempotency: "keyed",
    });
    const request = requestFor(surface, "request-1");

    const first = await surface.perform(request);
    (first.output as { attempt: number }).attempt = 999;
    const replay = await surface.perform(request);

    expect(replay.output).toEqual({ attempt: 1 });
    expect(replay).not.toBe(first);
    expect(handler).toHaveBeenCalledOnce();
    expect(policy).toHaveBeenCalledOnce();
    expect(verifyEffect).toHaveBeenCalledOnce();
  });

  it("shares one in-flight execution across concurrent identical requests", async () => {
    let release!: () => void;
    const handler = vi.fn(
      () =>
        new Promise<{ attempt: number }>((resolve) => {
          release = () => resolve({ attempt: 1 });
        }),
    );
    const { surface } = createAction({ handler, idempotency: "keyed" });
    const request = requestFor(surface, "concurrent-1");

    const first = surface.perform(request);
    const second = surface.perform(request);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
    release();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toEqual(secondResult);
    expect(firstResult).not.toBe(secondResult);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("rejects reuse with different input, revision, or principal", async () => {
    let principalId = "user-1";
    const handler = vi.fn(() => ({ attempt: 1 }));
    const { surface } = createAction({
      getPrincipal: () => ({ id: principalId }),
      handler,
      idempotency: "keyed",
    });
    const request = requestFor(surface, "request-1");
    await surface.perform(request);

    let conflict: unknown;
    try {
      await surface.perform({
        ...request,
        input: { orderId: "must-not-leak" },
      });
    } catch (error) {
      conflict = error;
    }
    expect(conflict).toBeInstanceOf(AgentIdempotencyConflictError);
    expect(String(conflict)).not.toContain("must-not-leak");
    expect(String(conflict)).not.toContain("request-1");
    await expect(
      surface.perform({ ...request, revision: "999" }),
    ).rejects.toBeInstanceOf(AgentIdempotencyConflictError);
    principalId = "user-2";
    await expect(surface.perform(request)).rejects.toBeInstanceOf(
      AgentIdempotencyConflictError,
    );
    expect(handler).toHaveBeenCalledOnce();
  });

  it("removes failed executions so the same request can retry", async () => {
    let attempt = 0;
    const handler = vi.fn(() => {
      attempt += 1;
      if (attempt === 1) throw new Error("temporary failure");
      return { attempt };
    });
    const { surface } = createAction({ handler, idempotency: "keyed" });
    const request = requestFor(surface, "request-1");

    await expect(surface.perform(request)).rejects.toThrow("temporary failure");
    const result = await surface.perform(request);

    expect(result.output).toEqual({ attempt: 2 });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("replays after the original action removes its target", async () => {
    let attempt = 0;
    const button = document.querySelector("button")!;
    const handler = vi.fn(() => {
      button.remove();
      return { attempt: ++attempt };
    });
    const { surface } = createAction({ handler, idempotency: "keyed" });
    const request = requestFor(surface, "remove-1");

    const first = await surface.perform(request);
    const replay = await surface.perform(request);

    expect(first.targetPresent).toBe(false);
    expect(replay).toEqual(first);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("executes safe-retry actions normally on every request", async () => {
    let attempt = 0;
    const handler = vi.fn(() => ({ attempt: ++attempt }));
    const { surface } = createAction({ handler, idempotency: "safe-retry" });
    const request = requestFor(surface);

    expect((await surface.perform(request)).output).toEqual({ attempt: 1 });
    expect((await surface.perform(request)).output).toEqual({ attempt: 2 });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("evicts the oldest settled replay when the cache bound is exceeded", async () => {
    let attempt = 0;
    const handler = vi.fn(() => ({ attempt: ++attempt }));
    const { surface } = createAction({
      cacheSize: 1,
      handler,
      idempotency: "keyed",
    });
    const first = requestFor(surface, "request-1");
    const second = requestFor(surface, "request-2");

    await surface.perform(first);
    await surface.perform(second);
    const rerun = await surface.perform(first);

    expect(rerun.output).toEqual({ attempt: 3 });
    expect(handler).toHaveBeenCalledTimes(3);
  });
});
