import type { Page } from "playwright-core";
import { describe, expect, it } from "vitest";

import { createPlaywrightSurface } from "../src/playwright/index.js";
import type { PlaywrightElementBinding } from "../src/playwright/types.js";

function fakePage(): Page & { listenerCount(): number } {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const emitter = {
    on(event: string, listener: (...args: unknown[]) => void) {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
      return emitter;
    },
    off(event: string, listener: (...args: unknown[]) => void) {
      listeners.get(event)?.delete(listener);
      return emitter;
    },
  };
  const frame = {};
  const context = {
    ...emitter,
    browser: () => undefined,
  };
  return {
    ...emitter,
    context: () => context,
    getByRole: () => { throw new Error("not used"); },
    isClosed: () => false,
    mainFrame: () => frame,
    url: () => "https://fixture.example/path?secret=1#fragment",
    listenerCount: () => [...listeners.values()].reduce((total, set) => total + set.size, 0),
  } as unknown as Page & { listenerCount(): number };
}

const clickBinding = (): PlaywrightElementBinding => ({
  id: "save",
  target: { role: "button", name: "Save" },
  actions: {
    save: {
      operation: { type: "click" },
      effects: ["saved"],
    },
  },
});

describe("Playwright semantic adapter configuration", () => {
  it("captures data properties without invoking accessors", () => {
    let accessed = false;
    const options = {
      page: fakePage(),
      surfaceId: "pw-unit",
      allowedOrigins: ["https://fixture.example"],
      bindings: [clickBinding()],
      get policy() {
        accessed = true;
        return undefined;
      },
    };
    expect(() => createPlaywrightSurface(options)).toThrow(TypeError);
    expect(accessed).toBe(false);
  });

  it.each([
    {
      name: "non-canonical origin",
      origins: ["https://fixture.example/"],
      bindings: [clickBinding()],
    },
    {
      name: "normalized accessible whitespace",
      origins: ["https://fixture.example"],
      bindings: [{ ...clickBinding(), target: { role: "button" as const, name: " Save " } }],
    },
    {
      name: "duplicate semantic target",
      origins: ["https://fixture.example"],
      bindings: [clickBinding(), { ...clickBinding(), id: "save-again" }],
    },
    {
      name: "operation-role mismatch",
      origins: ["https://fixture.example"],
      bindings: [{
        id: "bad-fill",
        target: { role: "button" as const, name: "Save" },
        actions: { fill: { operation: { type: "fill" as const } } },
      }],
    },
    {
      name: "sensitive executable binding",
      origins: ["https://fixture.example"],
      bindings: [{ ...clickBinding(), sensitive: true }],
    },
    {
      name: "switch set-checked",
      origins: ["https://fixture.example"],
      bindings: [{
        id: "bad-switch",
        target: { role: "switch" as const, name: "Toggle" },
        actions: { check: { operation: { type: "set-checked" as const, checked: true } } },
      }],
    },
    {
      name: "radio uncheck",
      origins: ["https://fixture.example"],
      bindings: [{
        id: "bad-radio",
        target: { role: "radio" as const, name: "Choice" },
        actions: { uncheck: { operation: { type: "set-checked" as const, checked: false } } },
      }],
    },
  ])("rejects $name", ({ origins, bindings }) => {
    expect(() => createPlaywrightSurface({
      page: fakePage(),
      surfaceId: "pw-unit",
      allowedOrigins: origins,
      bindings,
    })).toThrow(TypeError);
  });

  it("honors cancellation before queued observation", async () => {
    const surface = createPlaywrightSurface({
      page: fakePage(),
      surfaceId: "pw-unit",
      allowedOrigins: ["https://fixture.example"],
      bindings: [clickBinding()],
    });
    const controller = new AbortController();
    controller.abort();
    await expect(surface.snapshot({ signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    surface.dispose();
  });

  it("exposes visual selection only after explicit captured configuration", () => {
    const plain = createPlaywrightSurface({
      page: fakePage(), surfaceId: "pw-plain", allowedOrigins: ["https://fixture.example"], bindings: [clickBinding()],
    });
    const visual = createPlaywrightSurface({
      page: fakePage(), surfaceId: "pw-visual", allowedOrigins: ["https://fixture.example"], bindings: [clickBinding()],
      visual: { selectCandidate: () => undefined, sensitiveMasks: [] },
    });
    expect("selectVisualCandidate" in plain).toBe(false);
    expect(typeof visual.selectVisualCandidate).toBe("function");
    plain.dispose();
    visual.dispose();
  });

  it("rejects unsafe visual configuration without invoking accessors", () => {
    let accessed = false;
    const visual = {
      get selectCandidate() { accessed = true; return () => undefined; },
      sensitiveMasks: [],
    };
    expect(() => createPlaywrightSurface({
      page: fakePage(), surfaceId: "pw-visual", allowedOrigins: ["https://fixture.example"],
      bindings: [clickBinding()], visual,
    })).toThrow(TypeError);
    expect(accessed).toBe(false);
    expect(() => createPlaywrightSurface({
      page: fakePage(), surfaceId: "pw-visual", allowedOrigins: ["https://fixture.example"],
      bindings: [clickBinding()],
      visual: {
        selectCandidate: () => undefined,
        sensitiveMasks: [{ role: "textbox", name: "Secret" }, { role: "textbox", name: "Secret" }],
      },
    })).toThrow(TypeError);
  });

  it("disposes page listeners idempotently", () => {
    const page = fakePage();
    const surface = createPlaywrightSurface({
      page,
      surfaceId: "pw-unit",
      allowedOrigins: ["https://fixture.example"],
      bindings: [clickBinding()],
    });
    expect(page.listenerCount()).toBeGreaterThan(0);
    surface.dispose();
    surface.dispose();
    expect(page.listenerCount()).toBe(0);
  });
});
