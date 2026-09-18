// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentAuthorizationRequiredError,
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

    await expect(
      surface.perform({ elementId: "save", action: "click" }),
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
      { name: "set_value", risk: "credential" },
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

    const result = await surface.perform({
      elementId: "name",
      action: "set_value",
      input: "New",
    });

    expect(input.value).toBe("New");
    expect(inputEvent).toHaveBeenCalledOnce();
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ risk: "write", elementId: "name" }),
    );
    expect(result.state.value).toBe("New");
  });

  it("supports explicit domain actions and risk metadata", async () => {
    document.body.innerHTML = `<button>Confirm</button>`;
    const button = document.querySelector("button")!;
    const handler = vi.fn();
    const surface = createAgentSurface({ authorize: () => true });
    surface.register(button, {
      id: "confirm-order",
      description: "Confirm and submit the current order",
      actions: {
        confirm_order: {
          description: "Submit the order for payment",
          risk: "consequential",
          handler,
        },
      },
    });

    const item = surface
      .snapshot()
      .nodes.find((element) => element.id === "confirm-order");
    expect(item).toEqual(
      expect.objectContaining({
        description: "Confirm and submit the current order",
        actions: [
          expect.objectContaining({
            name: "confirm_order",
            risk: "consequential",
          }),
        ],
      }),
    );

    await surface.perform({
      elementId: "confirm-order",
      action: "confirm_order",
      input: { orderId: "order-1" },
    });
    expect(handler).toHaveBeenCalledWith({ orderId: "order-1" }, button);
  });
});
