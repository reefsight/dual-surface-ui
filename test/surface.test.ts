// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentAuthorizationRequiredError,
  AgentDuplicateElementIdError,
  AgentInputValidationError,
  AgentStaleRevisionError,
  AgentSurfaceMismatchError,
  createAgentSurface,
} from "../src/index.js";

describe("AgentSurface", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.title = "Checkout";
  });

  it("turns the human DOM into a compact semantic snapshot", () => {
    document.body.innerHTML = `
      <main>
        <h1>Checkout</h1>
        <label for="email">Email address</label>
        <input id="email" type="email" value="person@example.com">
        <div class="decoration"></div>
        <button>Place order</button>
      </main>
    `;

    const snapshot = createAgentSurface().snapshot();

    expect(snapshot.title).toBe("Checkout");
    expect(snapshot.schemaVersion).toBe("0.1");
    expect(snapshot.surfaceId).toBe(window.location.href);
    expect(snapshot.revision).toBe("0");
    expect(snapshot.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "heading", name: "Checkout" }),
        expect.objectContaining({
          role: "textbox",
          name: "Email address",
          state: expect.objectContaining({ value: "person@example.com" }),
        }),
        expect.objectContaining({
          role: "button",
          name: "Place order",
          actions: [{ name: "click", risk: "write" }],
        }),
      ]),
    );
    expect(snapshot.nodes.some((item) => item.name === "decoration")).toBe(
      false,
    );
  });

  it("requires authorization before inferred write actions", async () => {
    document.body.innerHTML = `<button data-agent-id="save">Save</button>`;
    const surface = createAgentSurface();
    const snapshot = surface.snapshot();

    await expect(
      surface.perform({
        surfaceId: snapshot.surfaceId,
        revision: snapshot.revision,
        elementId: "save",
        action: "click",
      }),
    ).rejects.toBeInstanceOf(AgentAuthorizationRequiredError);
  });

  it("never exposes credential values in snapshots", () => {
    document.body.innerHTML = `
      <label for="password">Password</label>
      <input id="password" type="password" value="top-secret">
    `;

    const password = createAgentSurface()
      .snapshot()
      .nodes.find((element) => element.name === "Password");

    expect(password?.state).toEqual(
      expect.objectContaining({ sensitive: true, valuePresent: true }),
    );
    expect(password?.state.value).toBeUndefined();
    expect(password?.actions).toEqual([
      {
        name: "set_value",
        risk: "credential",
        inputSchema: { type: "string" },
      },
    ]);
    expect(JSON.stringify(password)).not.toContain("top-secret");
  });

  it("executes an approved native action and returns updated state", async () => {
    document.body.innerHTML = `
      <label for="name">Name</label>
      <input id="name" data-agent-id="name" value="Old">
    `;
    const input = document.querySelector("input")!;
    const inputEvent = vi.fn();
    input.addEventListener("input", inputEvent);
    const authorize = vi.fn(() => true);
    const surface = createAgentSurface({ authorize });
    const snapshot = surface.snapshot();

    const result = await surface.perform({
      surfaceId: snapshot.surfaceId,
      revision: snapshot.revision,
      elementId: "name",
      action: "set_value",
      input: "New",
    });

    expect(input.value).toBe("New");
    expect(inputEvent).toHaveBeenCalledOnce();
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ risk: "write", elementId: "name" }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        schemaVersion: "0.1",
        surfaceId: snapshot.surfaceId,
        previousRevision: "0",
        revision: "1",
        status: "succeeded",
        action: "set_value",
        targetId: "name",
        targetPresent: true,
      }),
    );
    expect(result.node?.state.value).toBe("New");
  });

  it("supports explicit domain actions and risk metadata", async () => {
    document.body.innerHTML = `<button>Confirm</button>`;
    const button = document.querySelector("button")!;
    const handler = vi.fn();
    const surface = createAgentSurface({
      authorize: () => true,
      checkPrecondition: () => true,
      confirm: () => true,
      verifyEffect: () => true,
    });
    surface.register(button, {
      id: "confirm-order",
      description: "Confirm and submit the current order",
      actions: {
        confirm_order: {
          description: "Submit the order for payment",
          risk: "consequential",
          inputSchema: {
            type: "object",
            additionalProperties: false,
            properties: { orderId: { type: "string" } },
            required: ["orderId"],
          },
          preconditions: ["order_is_ready"],
          effects: ["order_is_submitted"],
          requiresConfirmation: true,
          idempotency: "keyed",
          handler,
        },
      },
    });

    const snapshot = surface.snapshot();
    const item = snapshot.nodes.find(
      (element) => element.id === "confirm-order",
    );
    expect(item).toEqual(
      expect.objectContaining({
        description: "Confirm and submit the current order",
        actions: [
          expect.objectContaining({
            name: "confirm_order",
            risk: "consequential",
            inputSchema: {
              type: "object",
              additionalProperties: false,
              properties: { orderId: { type: "string" } },
              required: ["orderId"],
            },
            preconditions: ["order_is_ready"],
            effects: ["order_is_submitted"],
            requiresConfirmation: true,
            idempotency: "keyed",
          }),
        ],
      }),
    );

    await surface.perform({
      surfaceId: snapshot.surfaceId,
      revision: snapshot.revision,
      elementId: "confirm-order",
      action: "confirm_order",
      input: { orderId: "order-1" },
    });
    expect(handler).toHaveBeenCalledWith({ orderId: "order-1" }, button);
  });

  it("returns a successful result when the action removes its target", async () => {
    document.body.innerHTML = `<button>Close</button>`;
    const button = document.querySelector("button")!;
    const surface = createAgentSurface({
      surfaceId: "dialog",
      authorize: () => true,
      verifyEffect: ({ after }) =>
        !after.nodes.some((item) => item.id === "close-dialog"),
    });
    surface.register(button, {
      id: "close-dialog",
      actions: {
        close: {
          risk: "write",
          effects: ["dialog_closed"],
          handler: () => button.remove(),
        },
      },
    });
    const observed = surface.snapshot();

    const result = await surface.perform({
      surfaceId: observed.surfaceId,
      revision: observed.revision,
      elementId: "close-dialog",
      action: "close",
    });

    expect(result).toEqual(
      expect.objectContaining({
        previousRevision: "0",
        revision: "1",
        targetPresent: false,
      }),
    );
    expect(result.node).toBeUndefined();
  });

  it("keeps element IDs stable and rejects duplicate declared IDs", () => {
    document.body.innerHTML = `
      <button data-agent-id="stable">First</button>
    `;
    const surface = createAgentSurface();

    expect(surface.snapshot().nodes[0]?.id).toBe("stable");
    expect(surface.snapshot().nodes[0]?.id).toBe("stable");

    document.body.insertAdjacentHTML(
      "beforeend",
      `<button data-agent-id="stable">Second</button>`,
    );
    expect(() => surface.snapshot()).toThrow(AgentDuplicateElementIdError);
  });

  it("advances revision only when semantic state changes", () => {
    document.body.innerHTML = `
      <label for="name">Name</label>
      <input id="name" value="Old">
    `;
    const input = document.querySelector("input")!;
    const surface = createAgentSurface();

    expect(surface.snapshot().revision).toBe("0");
    document.body.insertAdjacentHTML("beforeend", `<div class="decoration"></div>`);
    expect(surface.snapshot().revision).toBe("0");

    input.value = "New";
    expect(surface.snapshot().revision).toBe("1");
    expect(surface.snapshot().revision).toBe("1");
  });

  it("rejects wrong-surface and stale requests before authorization", async () => {
    document.body.innerHTML = `
      <label for="name">Name</label>
      <input id="name" data-agent-id="name" value="Old">
    `;
    const authorize = vi.fn(() => true);
    const surface = createAgentSurface({ surfaceId: "profile", authorize });
    const observed = surface.snapshot();

    await expect(
      surface.perform({
        surfaceId: "other",
        revision: observed.revision,
        elementId: "name",
        action: "set_value",
        input: "Wrong surface",
      }),
    ).rejects.toBeInstanceOf(AgentSurfaceMismatchError);

    document.querySelector("input")!.value = "Changed elsewhere";
    await expect(
      surface.perform({
        surfaceId: observed.surfaceId,
        revision: observed.revision,
        elementId: "name",
        action: "set_value",
        input: "Stale write",
      }),
    ).rejects.toBeInstanceOf(AgentStaleRevisionError);

    expect(authorize).not.toHaveBeenCalled();
    expect(document.querySelector("input")!.value).toBe("Changed elsewhere");
  });

  it("rejects invalid native input before authorization or execution", async () => {
    document.body.innerHTML = `
      <label for="name">Name</label>
      <input id="name" data-agent-id="name" value="Old">
    `;
    const authorize = vi.fn(() => true);
    const surface = createAgentSurface({ authorize });
    const observed = surface.snapshot();
    const rawSecret = { password: "must-not-leak" };

    let caught: unknown;
    try {
      await surface.perform({
        surfaceId: observed.surfaceId,
        revision: observed.revision,
        elementId: "name",
        action: "set_value",
        input: rawSecret,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AgentInputValidationError);
    expect(caught).toMatchObject({ code: "invalid_input" });
    expect(String(caught)).not.toContain("must-not-leak");
    expect(authorize).not.toHaveBeenCalled();
    expect(document.querySelector("input")!.value).toBe("Old");
  });

  it("fails closed when a declared input schema is malformed", async () => {
    document.body.innerHTML = `<button>Run</button>`;
    const button = document.querySelector("button")!;
    const authorize = vi.fn(() => true);
    const handler = vi.fn();
    const surface = createAgentSurface({ authorize });
    surface.register(button, {
      id: "run",
      actions: {
        run: {
          inputSchema: { type: "not-a-json-schema-type" },
          handler,
        },
      },
    });
    const observed = surface.snapshot();

    await expect(
      surface.perform({
        surfaceId: observed.surfaceId,
        revision: observed.revision,
        elementId: "run",
        action: "run",
        input: "value",
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(authorize).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });
});
