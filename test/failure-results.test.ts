// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AgentActionNotFoundError,
  createAgentSurface,
} from "../src/index.js";

describe("AgentSurface structured failure results", () => {
  beforeEach(() => {
    document.body.innerHTML = `<button data-agent-id="submit">Submit</button>`;
  });

  it("returns the existing success result unchanged", async () => {
    const surface = createAgentSurface({ policy: () => ({ outcome: "allow" }) });
    document.querySelector("button")!.addEventListener("click", (event) => {
      (event.currentTarget as HTMLButtonElement).disabled = true;
    });
    const snapshot = surface.snapshot();

    const result = await surface.performSafe({
      surfaceId: snapshot.surfaceId,
      revision: snapshot.revision,
      elementId: "submit",
      action: "click",
    });

    expect(result.status).toBe("succeeded");
    expect(result).toEqual(
      expect.objectContaining({
        schemaVersion: "0.1",
        surfaceId: snapshot.surfaceId,
        previousRevision: snapshot.revision,
        action: "click",
        targetId: "submit",
      }),
    );
  });

  it("returns a fixed known failure without reflecting request fields", async () => {
    const surface = createAgentSurface();
    const snapshot = surface.snapshot();
    const secretTarget = "secret-target";

    const result = await surface.performSafe({
      surfaceId: snapshot.surfaceId,
      revision: snapshot.revision,
      elementId: secretTarget,
      action: "read_secret",
      input: { password: "top-secret-input" },
      idempotencyKey: "opaque-secret-key",
    });

    expect(result).toEqual({
      schemaVersion: "0.1",
      surfaceId: snapshot.surfaceId,
      revision: snapshot.revision,
      status: "failed",
      error: {
        code: "element_not_found",
        message: "The target element was not found",
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(secretTarget);
    expect(serialized).not.toContain("read_secret");
    expect(serialized).not.toContain("top-secret-input");
    expect(serialized).not.toContain("opaque-secret-key");
  });

  it("normalizes handler exceptions and reports the latest semantic revision", async () => {
    const secret = "handler-secret-stack-value";
    const policy = vi.fn(() => ({ outcome: "allow" as const }));
    const surface = createAgentSurface({ policy, verifyEffect: () => true });
    const button = document.querySelector("button")!;
    surface.register(button, {
      id: "submit",
      actions: {
        submit_order: {
          risk: "write",
          effects: ["order_submitted"],
          handler: () => {
            (button as HTMLButtonElement).disabled = true;
            throw new Error(secret);
          },
        },
      },
    });
    const snapshot = surface.snapshot();

    const result = await surface.performSafe({
      surfaceId: snapshot.surfaceId,
      revision: snapshot.revision,
      elementId: "submit",
      action: "submit_order",
      input: { password: "another-secret" },
    });

    expect(result).toEqual({
      schemaVersion: "0.1",
      surfaceId: snapshot.surfaceId,
      revision: "1",
      status: "failed",
      error: {
        code: "internal_error",
        message: "The action failed unexpectedly",
      },
    });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain("another-secret");
  });

  it("keeps perform exception behavior for existing callers", async () => {
    const surface = createAgentSurface();
    const snapshot = surface.snapshot();

    await expect(
      surface.perform({
        surfaceId: snapshot.surfaceId,
        revision: snapshot.revision,
        elementId: "submit",
        action: "missing",
      }),
    ).rejects.toBeInstanceOf(AgentActionNotFoundError);
  });

  it("still returns a failure when refreshing the surface observation fails", async () => {
    document.body.innerHTML = `
      <button data-agent-id="duplicate">One</button>
      <button data-agent-id="duplicate">Two</button>
    `;
    const surface = createAgentSurface({ surfaceId: "expected" });

    const result = await surface.performSafe({
      surfaceId: "wrong",
      revision: "0",
      elementId: "duplicate",
      action: "click",
    });

    expect(result).toEqual({
      schemaVersion: "0.1",
      surfaceId: "expected",
      revision: "0",
      status: "failed",
      error: {
        code: "surface_mismatch",
        message: "The request targets a different surface",
      },
    });
  });
});
