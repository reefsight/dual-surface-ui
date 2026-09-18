// @vitest-environment jsdom
import {
  KeepAlive,
  createApp,
  createSSRApp,
  defineComponent,
  h,
  nextTick,
  shallowRef,
  type App,
  type Component,
} from "vue";
import { renderToString } from "@vue/server-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createAgentSurface,
  type AgentElementDefinition,
  type AgentSurface,
} from "../src/index.js";
import {
  createAgentSurfacePlugin,
  useAgentElement,
  useAgentSurface,
} from "../src/vue/index.js";

function definition(
  id = "confirm",
  handler = vi.fn(),
): AgentElementDefinition {
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

function mount(
  component: Component,
  container: Element,
  surface?: AgentSurface,
): App {
  const app = createApp(component);
  if (surface) app.use(createAgentSurfacePlugin(surface));
  app.mount(container);
  return app;
}

async function settle(): Promise<void> {
  await nextTick();
  await nextTick();
}

describe("Vue adapter", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("injects the exact surface and rejects calls outside setup or without the plugin", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const surface = createAgentSurface({ root: document, surfaceId: "inject" });
    let observed: AgentSurface | undefined;
    const Consumer = defineComponent({
      setup() {
        observed = useAgentSurface();
        return () => h("span", "ready");
      },
    });

    const app = mount(Consumer, container, surface);
    expect(observed).toBe(surface);
    app.unmount();

    expect(() => useAgentSurface()).toThrow(
      "useAgentSurface must be called during component setup",
    );

    const missingContainer = document.createElement("div");
    document.body.append(missingContainer);
    const missing = createApp(Consumer);
    missing.config.warnHandler = () => {};
    expect(() => missing.mount(missingContainer)).toThrow(
      "useAgentSurface requires createAgentSurfacePlugin()",
    );

    const missingElementContainer = document.createElement("div");
    document.body.append(missingElementContainer);
    const MissingElement = defineComponent({
      setup() {
        const element = useAgentElement<HTMLButtonElement>(definition());
        return () => h("button", { ref: element }, "Confirm");
      },
    });
    const missingElementErrors: unknown[] = [];
    const missingElementApp = createApp(MissingElement);
    missingElementApp.config.errorHandler = (error) =>
      missingElementErrors.push(error);
    missingElementApp.mount(missingElementContainer);
    expect(missingElementErrors[0]).toEqual(
      expect.objectContaining({
        message:
          "useAgentElement requires createAgentSurfacePlugin() on the client",
      }),
    );
    missingElementApp.unmount();
  });

  it("registers only after mount with the exact explicit definition", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const surface = createAgentSurface({ root: document, surfaceId: "mount" });
    const register = vi.spyOn(surface, "register");
    const supplied = definition();
    let registeredDuringSetup = false;
    const Bound = defineComponent({
      setup() {
        const element = useAgentElement<HTMLButtonElement>(supplied);
        registeredDuringSetup = register.mock.calls.length > 0;
        return () => h("button", { ref: element }, "Confirm");
      },
    });
    const app = createApp(Bound);
    app.use(createAgentSurfacePlugin(surface));

    expect(register).not.toHaveBeenCalled();
    app.mount(container);
    expect(registeredDuringSetup).toBe(false);
    await settle();

    const button = container.querySelector("button")!;
    expect(register).toHaveBeenCalledOnce();
    expect(register).toHaveBeenCalledWith(button, supplied);
    expect(button.dataset.agentId).toBe("confirm");
    app.unmount();
  });

  it("preserves human clicks while core policy remains authoritative", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const handler = vi.fn();
    const clicked = vi.fn();
    const surface = createAgentSurface({
      root: document,
      surfaceId: "authority",
      policy: () => ({ outcome: "deny" }),
      verifyEffect: () => true,
    });
    const Bound = defineComponent({
      setup() {
        const element = useAgentElement<HTMLButtonElement>(
          definition("confirm", handler),
        );
        return () =>
          h("button", { ref: element, onClick: clicked }, "Confirm");
      },
    });
    const app = mount(Bound, container, surface);
    await settle();

    (container.querySelector("button") as HTMLButtonElement).click();
    expect(clicked).toHaveBeenCalledOnce();

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
    app.unmount();
  });

  it("disposes before definition and v-if element replacements", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const surface = createAgentSurface({ root: document, surfaceId: "replace" });
    const originalRegister = surface.register.bind(surface);
    const events: string[] = [];
    vi.spyOn(surface, "register").mockImplementation((element, value) => {
      events.push(`register:${value.id}:${element.tagName}`);
      const unregister = originalRegister(element, value);
      return () => {
        events.push(`dispose:${value.id}:${element.tagName}`);
        unregister();
      };
    });
    const currentDefinition = shallowRef(definition("first"));
    const button = shallowRef(true);
    const Bound = defineComponent({
      setup() {
        const element = useAgentElement<HTMLElement>(currentDefinition);
        return () =>
          button.value
            ? h("button", { key: "button", ref: element }, "Run")
            : h("input", { key: "input", ref: element });
      },
    });
    const app = mount(Bound, container, surface);
    await settle();
    const oldButton = container.querySelector("button")!;

    currentDefinition.value = definition("second");
    await settle();
    button.value = false;
    await settle();

    const input = container.querySelector("input")!;
    expect(events).toEqual([
      "register:first:BUTTON",
      "dispose:first:BUTTON",
      "register:second:BUTTON",
      "dispose:second:BUTTON",
      "register:second:INPUT",
    ]);
    expect(oldButton.hasAttribute("data-agent-id")).toBe(false);
    expect(input.dataset.agentId).toBe("second");
    expect(
      surface.snapshot().nodes.filter((node) =>
        node.actions.some((action) => action.name === "confirm"),
      ),
    ).toHaveLength(1);
    app.unmount();
  });

  it("cleans unmount and leaves one registration after remount", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const surface = createAgentSurface({ root: document, surfaceId: "remount" });
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
    const Bound = defineComponent({
      setup() {
        const element = useAgentElement<HTMLButtonElement>(definition());
        return () => h("button", { ref: element }, "Confirm");
      },
    });

    const first = mount(Bound, container, surface);
    await settle();
    const firstButton = container.querySelector("button")!;
    expect(live).toBe(1);
    first.unmount();
    expect(live).toBe(0);
    expect(firstButton.hasAttribute("data-agent-id")).toBe(false);

    const second = mount(Bound, container, surface);
    await settle();
    expect(live).toBe(1);
    expect(maximumLive).toBe(1);
    second.unmount();
    expect(live).toBe(0);
  });

  it("removes KeepAlive ownership while deactivated and restores it once", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const surface = createAgentSurface({ root: document, surfaceId: "keep-alive" });
    const register = vi.spyOn(surface, "register");
    const shown = shallowRef(true);
    const Bound = defineComponent({
      name: "KeptAgentButton",
      setup() {
        const element = useAgentElement<HTMLButtonElement>(definition("kept"));
        return () => h("button", { ref: element }, "Kept");
      },
    });
    const Host = defineComponent({
      setup() {
        return () =>
          h(KeepAlive, null, {
            default: () => (shown.value ? h(Bound, { key: "kept" }) : null),
          });
      },
    });
    const app = mount(Host, container, surface);
    await settle();
    expect(register).toHaveBeenCalledTimes(1);
    expect(surface.snapshot().nodes.some((node) => node.id === "kept")).toBe(true);

    shown.value = false;
    await settle();
    expect(surface.snapshot().nodes.some((node) => node.id === "kept")).toBe(false);

    shown.value = true;
    await settle();
    expect(register).toHaveBeenCalledTimes(2);
    expect(surface.snapshot().nodes.filter((node) => node.id === "kept")).toHaveLength(1);
    app.unmount();
  });

  it("fails closed when two live elements claim the same id", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const surface = createAgentSurface({ root: document, surfaceId: "duplicate" });
    const errors: unknown[] = [];
    const Bound = defineComponent({
      setup() {
        const first = useAgentElement<HTMLButtonElement>(definition("same"));
        const second = useAgentElement<HTMLButtonElement>(definition("same"));
        return () => [
          h("button", { ref: first }, "First"),
          h("button", { ref: second }, "Second"),
        ];
      },
    });
    const app = createApp(Bound);
    app.use(createAgentSurfacePlugin(surface));
    app.config.errorHandler = (error) => errors.push(error);
    app.mount(container);
    await settle();

    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual(
      expect.objectContaining({ message: "Duplicate agent element id: same" }),
    );
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.filter((element) => element.dataset.agentId === "same")).toHaveLength(1);
    expect(surface.snapshot().nodes.filter((node) => node.id === "same")).toHaveLength(1);
    app.unmount();
  });

  it("rejects a component-instance ref instead of guessing its root element", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const surface = createAgentSurface({ root: document, surfaceId: "component-ref" });
    const register = vi.spyOn(surface, "register");
    const errors: unknown[] = [];
    const Child = defineComponent({
      setup: () => () => h("button", "Child"),
    });
    const Parent = defineComponent({
      setup() {
        const element = useAgentElement<Element>(definition("component"));
        return () => h(Child, { ref: element });
      },
    });
    const app = createApp(Parent);
    app.use(createAgentSurfacePlugin(surface));
    app.config.errorHandler = (error) => errors.push(error);
    app.mount(container);
    await settle();

    expect(errors[0]).toEqual(
      expect.objectContaining({
        message:
          "useAgentElement template ref must resolve to a native Element",
      }),
    );
    expect(register).not.toHaveBeenCalled();
    app.unmount();
  });

  it("renders SSR human markup without registration or an agent marker", async () => {
    const Bound = defineComponent({
      setup() {
        const element = useAgentElement<HTMLButtonElement>(definition("server"));
        return () => h("button", { ref: element }, "Confirm");
      },
    });
    const app = createSSRApp(Bound);

    const html = await renderToString(app);

    expect(html).toContain("<button>Confirm</button>");
    expect(html).not.toContain("data-agent-id");
  });

  it("hydrates SSR markup without warnings, registers once, and cleans up", async () => {
    const Bound = defineComponent({
      setup() {
        const element = useAgentElement<HTMLButtonElement>(definition("hydrated"));
        return () => h("button", { ref: element }, "Confirm");
      },
    });
    const serverApp = createSSRApp(Bound);
    const html = await renderToString(serverApp);

    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.append(container);
    const serverButton = container.querySelector("button");
    const clientSurface = createAgentSurface({
      root: document,
      surfaceId: "hydration-client",
    });
    const clientRegister = vi.spyOn(clientSurface, "register");
    const warnings: string[] = [];
    const errors: unknown[] = [];
    const clientApp = createSSRApp(Bound);
    clientApp.use(createAgentSurfacePlugin(clientSurface));
    clientApp.config.warnHandler = (message) => warnings.push(message);
    clientApp.config.errorHandler = (error) => errors.push(error);

    clientApp.mount(container);
    await settle();

    const hydratedButton = container.querySelector("button")!;
    expect(hydratedButton).toBe(serverButton);
    expect(warnings).toEqual([]);
    expect(errors).toEqual([]);
    expect(clientRegister).toHaveBeenCalledOnce();
    expect(hydratedButton.dataset.agentId).toBe("hydrated");

    clientApp.unmount();
    expect(hydratedButton.hasAttribute("data-agent-id")).toBe(false);
    expect(clientSurface.snapshot().nodes.some((node) => node.id === "hydrated")).toBe(false);
  });
});
