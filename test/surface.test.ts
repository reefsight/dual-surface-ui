// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentAuthorizationRequiredError,
  AgentDuplicateElementIdError,
  AgentInputValidationError,
  AgentStaleRevisionError,
  AgentSurfaceMismatchError,
  createAgentSurface,
  type AgentElementDefinition,
} from "../src/index.js";

describe("AgentSurface", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.title = "Checkout";
    window.history.replaceState({}, "", "/");
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
      idempotencyKey: "order-1.confirm",
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

  it("advances revision for replaceState, pushState, and hash navigation", async () => {
    document.body.innerHTML = `<button data-agent-id="save">Save</button>`;
    const authorize = vi.fn(() => true);
    const surface = createAgentSurface({ surfaceId: "spa", authorize });
    const observed = surface.snapshot();

    window.history.replaceState({}, "", "/replaced-route");
    expect(surface.snapshot().revision).toBe("1");
    window.history.pushState({}, "", "/next-route");
    expect(surface.snapshot().revision).toBe("2");
    window.location.hash = "section";
    const navigated = surface.snapshot();

    expect(navigated.url).toBe("http://localhost:3000/next-route#section");
    expect(navigated.revision).toBe("3");
    await expect(surface.perform({
      surfaceId: observed.surfaceId,
      revision: observed.revision,
      elementId: "save",
      action: "click",
    })).rejects.toBeInstanceOf(AgentStaleRevisionError);
    expect(authorize).not.toHaveBeenCalled();
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

  it("preserves permissive root registration compatibility outside the strict compiler", () => {
    document.body.innerHTML = `<button>Legacy</button>`;
    const longId = "element-" + "x".repeat(128);
    const longAction = "a".repeat(65);
    const conditions = Array.from(
      { length: 33 },
      (_, index) => `legacy condition ${index}`,
    );
    const surface = createAgentSurface();

    expect(() =>
      surface.register(document.querySelector("button")!, {
        id: longId,
        description: "",
        actions: {
          [longAction]: {
            description: "",
            risk: "read",
            preconditions: conditions,
          },
        },
      }),
    ).not.toThrow();

    const node = surface.snapshot().nodes.find((item) => item.id === longId);
    expect(node?.actions[0]).toMatchObject({
      name: longAction,
      preconditions: conditions,
    });
  });

  it("binds disposal to the registered id even if the definition mutates", () => {
    document.body.innerHTML = `<button>First</button><button>Second</button>`;
    const [first, second] = Array.from(document.querySelectorAll("button"));
    const surface = createAgentSurface();
    const value = { id: "stable", description: "Original" };
    const unregister = surface.register(first!, value);

    value.id = "mutated-after-registration";
    unregister();

    expect(first!.hasAttribute("data-agent-id")).toBe(false);
    expect(() =>
      surface.register(second!, { id: "stable", description: "Replacement" }),
    ).not.toThrow();
  });

  it("captures registration semantics until the definition is explicitly registered again", async () => {
    document.body.innerHTML = `<button>Run</button>`;
    const button = document.querySelector("button")!;
    const originalHandler = vi.fn(() => ({ accepted: true }));
    const replacementHandler = vi.fn(() => ({ accepted: 1 }));
    const inputSchema = {
      type: "object",
      additionalProperties: false,
      properties: { value: { type: "string" } },
      required: ["value"],
    };
    const outputSchema = {
      type: "object",
      additionalProperties: false,
      properties: { accepted: { type: "boolean" } },
      required: ["accepted"],
    };
    const value: AgentElementDefinition = {
      id: "stable",
      description: "Original definition",
      actions: {
        run: {
          description: "Original action",
          risk: "read",
          inputSchema,
          outputSchema,
          preconditions: ["ready"],
          effects: ["ran"],
          requiresConfirmation: false,
          idempotency: "none",
          handler: originalHandler,
        },
      },
    };
    const surface = createAgentSurface({
      checkPrecondition: () => true,
      verifyEffect: () => true,
    });
    surface.register(button, value);

    value.id = "mutated";
    value.description = "Mutated definition";
    const action = value.actions!.run!;
    action.description = "Mutated action";
    action.risk = "consequential";
    inputSchema.properties.value.type = "number";
    inputSchema.required.push("extra");
    outputSchema.properties.accepted.type = "number";
    action.preconditions!.push("mutated_precondition");
    action.effects!.push("mutated_effect");
    action.requiresConfirmation = true;
    action.idempotency = "keyed";
    action.handler = replacementHandler;
    delete value.actions!.run;
    value.actions!.replacement = action;

    const observed = surface.snapshot();
    const node = observed.nodes.find((item) => item.id === "stable");
    expect(node).toMatchObject({
      id: "stable",
      description: "Original definition",
      actions: [
        {
          name: "run",
          description: "Original action",
          risk: "read",
          inputSchema: {
            properties: { value: { type: "string" } },
            required: ["value"],
          },
          outputSchema: {
            properties: { accepted: { type: "boolean" } },
          },
          preconditions: ["ready"],
          effects: ["ran"],
          requiresConfirmation: false,
          idempotency: "none",
        },
      ],
    });
    expect(button.dataset.agentId).toBe("stable");

    const result = await surface.perform({
      surfaceId: observed.surfaceId,
      revision: observed.revision,
      elementId: "stable",
      action: "run",
      input: { value: "allowed" },
    });
    expect(result.output).toEqual({ accepted: true });
    expect(originalHandler).toHaveBeenCalledOnce();
    expect(replacementHandler).not.toHaveBeenCalled();

    surface.register(button, value);
    const rebound = surface.snapshot();
    expect(rebound.nodes.some((item) => item.id === "stable")).toBe(false);
    expect(rebound.nodes.find((item) => item.id === "mutated")?.actions[0]?.name)
      .toBe("replacement");
  });

  it("cannot swap a registered handler while asynchronous policy is pending", async () => {
    document.body.innerHTML = `<button>Run</button>`;
    const button = document.querySelector("button")!;
    const originalHandler = vi.fn();
    const replacementHandler = vi.fn();
    let policyStarted!: () => void;
    let releasePolicy!: () => void;
    const started = new Promise<void>((resolve) => {
      policyStarted = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      releasePolicy = resolve;
    });
    const customPrototypeAction = Object.assign(
      Object.create({ inheritedMetadata: "ignored" }),
      {
        risk: "read" as const,
        handler: originalHandler,
      },
    );
    const value: AgentElementDefinition = {
      id: "run",
      actions: {
        run: customPrototypeAction,
      },
    };
    const surface = createAgentSurface({
      policy: async () => {
        policyStarted();
        await pending;
        return { outcome: "allow" };
      },
    });
    surface.register(button, value);
    const observed = surface.snapshot();

    const execution = surface.perform({
      surfaceId: observed.surfaceId,
      revision: observed.revision,
      elementId: "run",
      action: "run",
    });
    await started;
    customPrototypeAction.handler = replacementHandler;
    releasePolicy();
    await execution;

    expect(originalHandler).toHaveBeenCalledOnce();
    expect(replacementHandler).not.toHaveBeenCalled();
  });

  it("prevents an older disposer from removing a newer registration", () => {
    document.body.innerHTML = `<button>Run</button>`;
    const button = document.querySelector("button")!;
    const surface = createAgentSurface();
    const unregisterOld = surface.register(button, {
      id: "owned",
      actions: { old_action: { risk: "read" } },
    });
    const unregisterNew = surface.register(button, {
      id: "owned",
      actions: { new_action: { risk: "read" } },
    });

    unregisterOld();

    const node = surface.snapshot().nodes.find((item) => item.id === "owned");
    expect(node?.actions.map((action) => action.name)).toContain("new_action");
    expect(button.dataset.agentId).toBe("owned");

    unregisterNew();
    expect(button.hasAttribute("data-agent-id")).toBe(false);
  });

  it("replaces an overlapping id on the same element without a stale lookup", async () => {
    document.body.innerHTML = `<button>Run</button>`;
    const button = document.querySelector("button")!;
    const surface = createAgentSurface();
    const unregisterOld = surface.register(button, {
      id: "old-id",
      actions: { old_action: { risk: "read" } },
    });
    const unregisterNew = surface.register(button, {
      id: "new-id",
      actions: { new_action: { risk: "read" } },
    });

    unregisterOld();
    const snapshot = surface.snapshot();

    expect(snapshot.nodes.some((item) => item.id === "old-id")).toBe(false);
    expect(snapshot.nodes.some((item) => item.id === "new-id")).toBe(true);
    await expect(
      surface.performSafe({
        surfaceId: snapshot.surfaceId,
        revision: snapshot.revision,
        elementId: "old-id",
        action: "old_action",
      }),
    ).resolves.toMatchObject({
      status: "failed",
      error: { code: "element_not_found" },
    });
    unregisterNew();
  });
});
