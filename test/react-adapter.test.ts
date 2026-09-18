// @vitest-environment jsdom
import { act, createElement, StrictMode, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAgentSurface, type AgentElementDefinition } from "../src/index.js";
import {
  AgentSurfaceProvider,
  useAgentElement,
  useAgentSurface,
} from "../src/react/index.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement;

function definition(id = "confirm", handler = vi.fn()): AgentElementDefinition {
  return {
    id,
    description: "Confirm the reviewed operation",
    actions: {
      confirm: {
        risk: "consequential",
        effects: ["operation_confirmed"],
        handler,
      },
    },
  };
}

function BoundButton({
  value,
  onClick,
}: {
  value: AgentElementDefinition;
  onClick?: () => void;
}) {
  const ref = useAgentElement<HTMLButtonElement>(value);
  return createElement("button", { ref, onClick }, "Confirm");
}

async function render(element: React.ReactNode): Promise<void> {
  root = createRoot(container);
  await act(async () => root!.render(element));
}

describe("React adapter", () => {
  beforeEach(() => {
    container = document.createElement("div");
    document.body.replaceChildren(container);
    root = undefined;
  });

  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    vi.restoreAllMocks();
  });

  it("provides the exact surface and registers the committed element", async () => {
    const surface = createAgentSurface({ root: container, surfaceId: "react" });
    let observed: unknown;
    function Consumer() {
      observed = useAgentSurface();
      return createElement(BoundButton, { value: definition() });
    }

    await render(
      createElement(
        AgentSurfaceProvider,
        { surface },
        createElement(Consumer),
      ),
    );

    expect(observed).toBe(surface);
    expect(container.querySelector("button")?.dataset.agentId).toBe("confirm");
    expect(surface.snapshot().nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "confirm",
          description: "Confirm the reviewed operation",
        }),
      ]),
    );
  });

  it("preserves React click behavior and core remains execution authority", async () => {
    const click = vi.fn();
    const handler = vi.fn();
    const surface = createAgentSurface({
      root: container,
      surfaceId: "authority",
      policy: () => ({ outcome: "deny" }),
      verifyEffect: () => true,
    });
    await render(
      createElement(
        AgentSurfaceProvider,
        { surface },
        createElement(BoundButton, {
          value: definition("confirm", handler),
          onClick: click,
        }),
      ),
    );

    await act(async () => container.querySelector("button")!.click());
    expect(click).toHaveBeenCalledOnce();

    const snapshot = surface.snapshot();
    const outcome = await surface.performSafe({
      surfaceId: snapshot.surfaceId,
      revision: snapshot.revision,
      elementId: "confirm",
      action: "confirm",
    });
    expect(outcome).toMatchObject({
      status: "failed",
      error: { code: "authorization_required" },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("keeps exactly one registration through StrictMode replay and cleans unmount", async () => {
    const surface = createAgentSurface({ root: container, surfaceId: "strict" });
    const originalRegister = surface.register.bind(surface);
    let live = 0;
    let maximumLive = 0;
    vi.spyOn(surface, "register").mockImplementation((element, value) => {
      live += 1;
      maximumLive = Math.max(maximumLive, live);
      const unregister = originalRegister(element, value);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        live -= 1;
        unregister();
      };
    });

    await render(
      createElement(
        StrictMode,
        null,
        createElement(
          AgentSurfaceProvider,
          { surface },
          createElement(BoundButton, { value: definition() }),
        ),
      ),
    );

    expect(live).toBe(1);
    expect(maximumLive).toBe(1);
    expect(surface.snapshot().nodes.some((node) => node.id === "confirm")).toBe(
      true,
    );

    await act(async () => root!.unmount());
    root = undefined;
    expect(live).toBe(0);
  });

  it("replaces definitions on the same node without stale cleanup", async () => {
    const surface = createAgentSurface({ root: container, surfaceId: "replace" });
    const first = definition("first");
    const second = definition("second");
    const tree = (value: AgentElementDefinition) =>
      createElement(
        AgentSurfaceProvider,
        { surface },
        createElement(BoundButton, { value }),
      );

    await render(tree(first));
    const element = container.querySelector("button");
    await act(async () => root!.render(tree(second)));

    expect(container.querySelector("button")).toBe(element);
    expect(element?.dataset.agentId).toBe("second");
    const ids = surface.snapshot().nodes.map((node) => node.id);
    expect(ids).toContain("second");
    expect(ids).not.toContain("first");
  });

  it("moves ownership to a new provider surface before registering it", async () => {
    const first = createAgentSurface({ root: container, surfaceId: "first" });
    const second = createAgentSurface({ root: container, surfaceId: "second" });
    const value = definition("owned");
    const tree = (surface: typeof first) =>
      createElement(
        AgentSurfaceProvider,
        { surface },
        createElement(BoundButton, { value }),
      );

    await render(tree(first));
    await act(async () => root!.render(tree(second)));

    const firstOwned = first.snapshot().nodes.find((node) => node.id === "owned");
    const secondOwned = second.snapshot().nodes.find((node) => node.id === "owned");
    expect(firstOwned?.actions.some((action) => action.name === "confirm")).toBe(
      false,
    );
    expect(secondOwned?.actions.some((action) => action.name === "confirm")).toBe(
      true,
    );
  });

  it("handles underlying DOM node replacement", async () => {
    const surface = createAgentSurface({ root: container, surfaceId: "node-swap" });
    const value = definition("swapped");
    function Swappable({ input }: { input: boolean }) {
      const ref = useAgentElement<HTMLElement>(value);
      return input
        ? createElement("input", { ref, key: "input" })
        : createElement("button", { ref, key: "button" }, "Run");
    }
    const tree = (input: boolean) =>
      createElement(
        AgentSurfaceProvider,
        { surface },
        createElement(Swappable, { input }),
      );

    await render(tree(false));
    const oldNode = container.firstElementChild;
    await act(async () => root!.render(tree(true)));

    expect(container.firstElementChild).not.toBe(oldNode);
    expect(container.firstElementChild?.getAttribute("data-agent-id")).toBe(
      "swapped",
    );
    expect(oldNode?.hasAttribute("data-agent-id")).toBe(false);
  });

  it("fails closed for missing providers and duplicate IDs", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    root = createRoot(container);
    await expect(
      act(async () => root!.render(createElement(BoundButton, { value: definition() }))),
    ).rejects.toThrow("requires an AgentSurfaceProvider");
    await act(async () => root!.unmount());
    root = undefined;

    const surface = createAgentSurface({ root: container, surfaceId: "duplicate" });
    root = createRoot(container);
    await expect(
      act(async () =>
        root!.render(
          createElement(
            AgentSurfaceProvider,
            { surface },
            createElement(BoundButton, { value: definition("same") }),
            createElement(BoundButton, { value: definition("same") }),
          ),
        ),
      ),
    ).rejects.toThrow("Duplicate agent element id");
    consoleError.mockRestore();
  });

  it("performs no registration during server rendering", () => {
    const surface = createAgentSurface({ root: container, surfaceId: "ssr" });
    const register = vi.spyOn(surface, "register");
    function StableButton() {
      const value = useMemo(() => definition("server"), []);
      return createElement(BoundButton, { value });
    }

    const html = renderToString(
      createElement(
        AgentSurfaceProvider,
        { surface },
        createElement(StableButton),
      ),
    );

    expect(html).toContain("<button>Confirm</button>");
    expect(register).not.toHaveBeenCalled();
    expect(container.hasChildNodes()).toBe(false);
  });
});
