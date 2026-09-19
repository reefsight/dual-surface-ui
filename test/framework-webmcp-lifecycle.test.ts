// @vitest-environment jsdom
import "@angular/compiler";

import {
  Component,
  provideZonelessChangeDetection,
} from "@angular/core";
import { TestBed } from "@angular/core/testing";
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createApp, defineComponent, h, nextTick, type App } from "vue";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createAgentSurface,
  type AgentElementDefinition,
  type AgentSurface,
} from "../src/index.js";
import {
  exportAgentSurfaceToWebMcp,
  type InstrumentedWebMcpExportHandle,
  type WebMcpModelContext,
  type WebMcpTool,
} from "../src/webmcp/index.js";
import {
  AgentSurfaceProvider,
  useAgentElement as useReactAgentElement,
} from "../src/react/index.js";
import {
  AgentElementDirective,
  provideAgentSurface,
} from "../angular/src/index.js";
import {
  createAgentSurfacePlugin,
  useAgentElement as useVueAgentElement,
} from "../src/vue/index.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const toolName = "framework.confirm";
const binding = {
  name: toolName,
  description: "Confirm the reviewed framework operation",
  elementId: "confirm",
  action: "confirm",
} as const;

function definition(handler: () => string): AgentElementDefinition {
  return {
    id: "confirm",
    description: "Confirm the reviewed framework operation",
    actions: {
      confirm: {
        risk: "read",
        handler,
      },
    },
  };
}

class FakeModelContext implements WebMcpModelContext {
  readonly tools = new Map<string, WebMcpTool>();
  readonly registrations: WebMcpTool[] = [];

  registerTool(tool: WebMcpTool, options: { signal: AbortSignal }): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`duplicate active tool: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
    this.registrations.push(tool);
    options.signal.addEventListener(
      "abort",
      () => {
        if (this.tools.get(tool.name) === tool) this.tools.delete(tool.name);
      },
      { once: true },
    );
  }
}

async function exportSurface(
  surface: AgentSurface,
  context: FakeModelContext,
): Promise<InstrumentedWebMcpExportHandle> {
  return exportAgentSurfaceToWebMcp(surface, {
    document,
    modelContext: context,
    bindings: [binding],
  });
}

function expectOneCurrentTool(context: FakeModelContext): WebMcpTool {
  expect([...context.tools]).toEqual([[toolName, expect.any(Object)]]);
  return context.tools.get(toolName)!;
}

async function expectAborted(tool: WebMcpTool): Promise<void> {
  await expect(tool.execute({})).rejects.toMatchObject({ name: "AbortError" });
}

async function expectCurrentToolExecutes(tool: WebMcpTool): Promise<void> {
  await expect(tool.execute({})).resolves.toMatchObject({ status: "succeeded" });
}

function ReactBoundButton({ value }: { value: AgentElementDefinition }) {
  const ref = useReactAgentElement<HTMLButtonElement>(value);
  return createElement("button", { ref }, "Confirm");
}

async function mountReact(
  container: HTMLDivElement,
  surface: AgentSurface,
  value: AgentElementDefinition,
): Promise<Root> {
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        AgentSurfaceProvider,
        { surface },
        createElement(ReactBoundButton, { value }),
      ),
    );
  });
  return root;
}

class AngularBoundButtonComponent {
  value!: AgentElementDefinition;
}

Component({
  imports: [AgentElementDirective],
  standalone: true,
  template: `
    <button [dualSurfaceAgentElement]="value">Confirm</button>
  `,
})(AngularBoundButtonComponent);

async function mountAngular(surface: AgentSurface, value: AgentElementDefinition) {
  TestBed.configureTestingModule({
    imports: [AngularBoundButtonComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideAgentSurface(surface),
    ],
  });
  const fixture = TestBed.createComponent(AngularBoundButtonComponent);
  fixture.componentInstance.value = value;
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture;
}

function createVueBoundApp(
  surface: AgentSurface,
  value: AgentElementDefinition,
): App {
  const BoundButton = defineComponent({
    setup() {
      const element = useVueAgentElement<HTMLButtonElement>(value);
      return () => h("button", { ref: element }, "Confirm");
    },
  });
  const app = createApp(BoundButton);
  app.use(createAgentSurfacePlugin(surface));
  return app;
}

describe("framework adapters with the WebMCP exporter lifecycle", () => {
  beforeAll(() => {
    TestBed.initTestEnvironment(
      BrowserTestingModule,
      platformBrowserTesting(),
    );
  });

  beforeEach(() => {
    document.body.replaceChildren();
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  afterAll(() => {
    TestBed.resetTestEnvironment();
  });

  it("releases and re-registers exactly one tool across React unmount/remount", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const surface = createAgentSurface({ root: container, surfaceId: "react-webmcp" });
    const context = new FakeModelContext();
    const handler = vi.fn(() => "confirmed");

    let root = await mountReact(container, surface, definition(handler));
    const firstExport = await exportSurface(surface, context);
    const oldTool = expectOneCurrentTool(context);

    await act(async () => root.unmount());
    firstExport.dispose();
    expect(context.tools.size).toBe(0);
    await expectAborted(oldTool);

    root = await mountReact(container, surface, definition(handler));
    const secondExport = await exportSurface(surface, context);
    const currentTool = expectOneCurrentTool(context);
    expect(context.registrations).toHaveLength(2);
    expect(currentTool).not.toBe(oldTool);
    await expectCurrentToolExecutes(currentTool);

    await act(async () => root.unmount());
    secondExport.dispose();
    expect(context.tools.size).toBe(0);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("releases and re-registers exactly one tool across Angular destroy/remount", async () => {
    const surface = createAgentSurface({ root: document, surfaceId: "angular-webmcp" });
    const context = new FakeModelContext();
    const handler = vi.fn(() => "confirmed");

    let fixture = await mountAngular(surface, definition(handler));
    const firstExport = await exportSurface(surface, context);
    const oldTool = expectOneCurrentTool(context);

    fixture.destroy();
    firstExport.dispose();
    expect(context.tools.size).toBe(0);
    await expectAborted(oldTool);

    TestBed.resetTestingModule();
    fixture = await mountAngular(surface, definition(handler));
    const secondExport = await exportSurface(surface, context);
    const currentTool = expectOneCurrentTool(context);
    expect(context.registrations).toHaveLength(2);
    expect(currentTool).not.toBe(oldTool);
    await expectCurrentToolExecutes(currentTool);

    fixture.destroy();
    secondExport.dispose();
    expect(context.tools.size).toBe(0);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("releases and re-registers exactly one tool across Vue unmount/remount", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const surface = createAgentSurface({ root: container, surfaceId: "vue-webmcp" });
    const context = new FakeModelContext();
    const handler = vi.fn(() => "confirmed");

    let app = createVueBoundApp(surface, definition(handler));
    app.mount(container);
    await nextTick();
    const firstExport = await exportSurface(surface, context);
    const oldTool = expectOneCurrentTool(context);

    app.unmount();
    firstExport.dispose();
    expect(context.tools.size).toBe(0);
    await expectAborted(oldTool);

    app = createVueBoundApp(surface, definition(handler));
    app.mount(container);
    await nextTick();
    const secondExport = await exportSurface(surface, context);
    const currentTool = expectOneCurrentTool(context);
    expect(context.registrations).toHaveLength(2);
    expect(currentTool).not.toBe(oldTool);
    await expectCurrentToolExecutes(currentTool);

    app.unmount();
    secondExport.dispose();
    expect(context.tools.size).toBe(0);
    expect(handler).toHaveBeenCalledOnce();
  });
});
