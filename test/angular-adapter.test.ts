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
import { bootstrapApplication } from "@angular/platform-browser";
import { renderApplication } from "@angular/platform-server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  createAgentSurface,
  type AgentElementDefinition,
  type AgentSurface,
} from "../src/index.js";
import {
  AgentElementDirective,
  injectAgentSurface,
  provideAgentSurface,
} from "../angular/src/index.js";

function definition(
  id = "approve",
  handler = vi.fn(),
): AgentElementDefinition {
  return {
    id,
    description: "Approve the reviewed operation",
    actions: {
      approve: {
        risk: "consequential",
        effects: ["operation_approved"],
        handler,
      },
    },
  };
}

class BoundButtonComponent {
  definition: AgentElementDefinition = definition();
  clicks = 0;
}

Component({
  imports: [AgentElementDirective],
  standalone: true,
  template: `
    <button
      [dualSurfaceAgentElement]="definition"
      (click)="clicks = clicks + 1"
    >Approve</button>
  `,
})(BoundButtonComponent);

class SwappableHostComponent {
  definition: AgentElementDefinition = definition("swapped");
  button = true;
}

Component({
  imports: [AgentElementDirective],
  standalone: true,
  template: `
    @if (button) {
      <button [dualSurfaceAgentElement]="definition">Approve</button>
    } @else {
      <input [dualSurfaceAgentElement]="definition" />
    }
  `,
})(SwappableHostComponent);

class ServerButtonComponent {
  definition: AgentElementDefinition = definition("server-approve");
}

Component({
  imports: [AgentElementDirective],
  standalone: true,
  selector: "server-button",
  template: `<button [dualSurfaceAgentElement]="definition">Approve</button>`,
})(ServerButtonComponent);

function configure(surface?: AgentSurface): void {
  TestBed.configureTestingModule({
    imports: [BoundButtonComponent],
    providers: [
      provideZonelessChangeDetection(),
      ...(surface ? [provideAgentSurface(surface)] : []),
    ],
  });
}

async function renderBoundButton(surface: AgentSurface) {
  configure(surface);
  const fixture = TestBed.createComponent(BoundButtonComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture;
}

describe("Angular adapter", () => {
  beforeAll(() => {
    TestBed.initTestEnvironment(
      BrowserTestingModule,
      platformBrowserTesting(),
    );
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  afterAll(() => {
    TestBed.resetTestEnvironment();
  });

  it("injects the exact provided surface and rejects a missing provider", () => {
    const surface = createAgentSurface({ root: document, surfaceId: "inject" });
    configure(surface);

    expect(TestBed.runInInjectionContext(() => injectAgentSurface())).toBe(
      surface,
    );

    TestBed.resetTestingModule();
    configure();
    expect(() =>
      TestBed.runInInjectionContext(() => injectAgentSurface()),
    ).toThrow("injectAgentSurface requires provideAgentSurface()");
  });

  it("defers registration until render and passes the exact definition", async () => {
    const surface = createAgentSurface({ root: document, surfaceId: "deferred" });
    const register = vi.spyOn(surface, "register");
    configure(surface);
    const fixture = TestBed.createComponent(BoundButtonComponent);
    const supplied = fixture.componentInstance.definition;

    expect(register).not.toHaveBeenCalled();

    fixture.detectChanges();
    await fixture.whenStable();

    const button = fixture.nativeElement.querySelector("button") as HTMLButtonElement;
    expect(register).toHaveBeenCalledOnce();
    expect(register).toHaveBeenCalledWith(button, supplied);
    expect(button.dataset.agentId).toBe("approve");
  });

  it("disposes the old registration before binding an updated definition", async () => {
    const surface = createAgentSurface({ root: document, surfaceId: "update" });
    const originalRegister = surface.register.bind(surface);
    const events: string[] = [];
    vi.spyOn(surface, "register").mockImplementation((element, value) => {
      events.push(`register:${value.id}`);
      const unregister = originalRegister(element, value);
      return () => {
        events.push(`dispose:${value.id}`);
        unregister();
      };
    });
    const fixture = await renderBoundButton(surface);

    fixture.componentInstance.definition = definition("confirm");
    fixture.changeDetectorRef.markForCheck();
    await fixture.whenStable();

    expect(events).toEqual([
      "register:approve",
      "dispose:approve",
      "register:confirm",
    ]);
    const button = fixture.nativeElement.querySelector("button") as HTMLButtonElement;
    expect(button.dataset.agentId).toBe("confirm");
    const ids = surface.snapshot().nodes.map((node) => node.id);
    expect(ids).toContain("confirm");
    expect(ids).not.toContain("approve");
  });

  it("cleans destroy and leaves one live registration after remount", async () => {
    const surface = createAgentSurface({ root: document, surfaceId: "remount" });
    const originalRegister = surface.register.bind(surface);
    let live = 0;
    vi.spyOn(surface, "register").mockImplementation((element, value) => {
      live += 1;
      const unregister = originalRegister(element, value);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        live -= 1;
        unregister();
      };
    });
    const first = await renderBoundButton(surface);
    const firstButton = first.nativeElement.querySelector("button") as HTMLButtonElement;
    expect(live).toBe(1);

    first.destroy();
    expect(live).toBe(0);
    expect(firstButton.hasAttribute("data-agent-id")).toBe(false);

    TestBed.resetTestingModule();
    const second = await renderBoundButton(surface);
    expect(live).toBe(1);
    expect(
      (second.nativeElement.querySelector("button") as HTMLButtonElement)
        .dataset.agentId,
    ).toBe("approve");
  });

  it("cleans the old host before registering a replacement node", async () => {
    const surface = createAgentSurface({ root: document, surfaceId: "host-swap" });
    TestBed.configureTestingModule({
      imports: [SwappableHostComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideAgentSurface(surface),
      ],
    });
    const fixture = TestBed.createComponent(SwappableHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const oldButton = fixture.nativeElement.querySelector("button") as HTMLButtonElement;

    fixture.componentInstance.button = false;
    fixture.changeDetectorRef.markForCheck();
    await fixture.whenStable();

    const input = fixture.nativeElement.querySelector("input") as HTMLInputElement;
    expect(oldButton.hasAttribute("data-agent-id")).toBe(false);
    expect(input.dataset.agentId).toBe("swapped");
    expect(
      surface.snapshot().nodes.filter((node) =>
        node.actions.some((action) => action.name === "approve"),
      ),
    ).toHaveLength(1);
  });

  it("moves ownership when the provider injector is recreated", async () => {
    const firstSurface = createAgentSurface({ root: document, surfaceId: "first" });
    const first = await renderBoundButton(firstSurface);
    first.destroy();
    TestBed.resetTestingModule();

    const secondSurface = createAgentSurface({ root: document, surfaceId: "second" });
    await renderBoundButton(secondSurface);

    expect(
      firstSurface.snapshot().nodes.some((node) =>
        node.actions.some((action) => action.name === "approve"),
      ),
    ).toBe(false);
    expect(
      secondSurface.snapshot().nodes.some((node) =>
        node.actions.some((action) => action.name === "approve"),
      ),
    ).toBe(true);
  });

  it("registers only the latest definition supplied before first render", async () => {
    const surface = createAgentSurface({ root: document, surfaceId: "rapid" });
    const register = vi.spyOn(surface, "register");
    configure(surface);
    const fixture = TestBed.createComponent(BoundButtonComponent);
    fixture.componentInstance.definition = definition("first");
    fixture.componentInstance.definition = definition("latest");

    fixture.detectChanges();
    await fixture.whenStable();

    expect(register).toHaveBeenCalledOnce();
    expect(register.mock.calls[0]?.[1].id).toBe("latest");
  });

  it("preserves human clicks while core policy remains authoritative", async () => {
    const handler = vi.fn();
    const surface = createAgentSurface({
      root: document,
      surfaceId: "authority",
      policy: () => ({ outcome: "deny" }),
      verifyEffect: () => true,
    });
    const fixture = await renderBoundButton(surface);
    fixture.componentInstance.definition = definition("approve", handler);
    fixture.changeDetectorRef.markForCheck();
    await fixture.whenStable();
    const button = fixture.nativeElement.querySelector("button") as HTMLButtonElement;

    button.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.clicks).toBe(1);

    const snapshot = surface.snapshot();
    const outcome = await surface.performSafe({
      surfaceId: snapshot.surfaceId,
      revision: snapshot.revision,
      elementId: "approve",
      action: "approve",
    });
    expect(outcome).toMatchObject({
      status: "failed",
      error: { code: "authorization_required" },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("renders human SSR markup without registering an agent element", async () => {
    const surface = createAgentSurface({ root: document, surfaceId: "server" });
    const register = vi.spyOn(surface, "register");

    const html = await renderApplication(
      (context) =>
        bootstrapApplication(
          ServerButtonComponent,
          {
            providers: [
              provideZonelessChangeDetection(),
              provideAgentSurface(surface),
            ],
          },
          context,
        ),
      {
        document: "<server-button></server-button>",
        url: "https://example.test/approval",
        allowedHosts: ["example.test"],
      },
    );

    expect(html).toContain("Approve");
    expect(html).not.toContain("data-agent-id");
    expect(register).not.toHaveBeenCalled();
  });
});
