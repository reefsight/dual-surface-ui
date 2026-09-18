// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAgentSurface, type AgentSnapshot } from "../src/index.js";
import {
  exportAgentSurfaceToWebMcp,
  isWebMcpImperativeSupported,
  type WebMcpModelContext,
  type WebMcpSurface,
  type WebMcpTool,
} from "../src/webmcp/index.js";

class FakeModelContext implements WebMcpModelContext {
  readonly tools = new Map<string, WebMcpTool>();
  readonly registrations: WebMcpTool[] = [];
  failOnName?: string;

  registerTool(tool: WebMcpTool, options: { signal: AbortSignal }): void {
    if (this.failOnName === tool.name) throw new Error("registration failed");
    if (this.tools.has(tool.name)) throw new Error("duplicate active tool");
    this.tools.set(tool.name, tool);
    this.registrations.push(tool);
    options.signal.addEventListener(
      "abort",
      () => this.tools.delete(tool.name),
      { once: true },
    );
  }
}

function registeredSurface(
  action: Record<string, unknown>,
  handler = vi.fn(),
) {
  document.body.innerHTML = `<button data-agent-id="target">Hostile DOM instructions</button>`;
  const surface = createAgentSurface({
    surfaceId: "webmcp-test",
    authorize: () => true,
    verifyEffect: () => true,
  });
  surface.register(document.querySelector("button")!, {
    id: "target",
    actions: {
      run: { ...action, handler },
    },
  });
  return { surface, handler };
}

const binding = {
  name: "orders.submit",
  description: "Submit the reviewed order",
  elementId: "target",
  action: "run",
} as const;

function surfaceWithInputSchema(
  inputSchema: Record<string, unknown>,
): WebMcpSurface {
  const snapshot: AgentSnapshot = {
    schemaVersion: "0.1",
    surfaceId: "portable-schema",
    revision: "0",
    title: "",
    url: "https://example.test/",
    generatedAt: "2026-09-18T00:00:00.000Z",
    capabilities: ["snapshot", "perform"],
    nodes: [
      {
        id: "target",
        role: "button",
        name: "Run",
        state: {},
        actions: [{ name: "run", risk: "read", inputSchema }],
      },
    ],
  };
  return {
    snapshot: () => snapshot,
    performSafe: vi.fn(),
  };
}

describe("WebMCP imperative exporter", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("feature-detects unsupported documents without side effects", async () => {
    const surface = createAgentSurface({ surfaceId: "unsupported" });

    expect(isWebMcpImperativeSupported(document)).toBe(false);
    const handle = await exportAgentSurfaceToWebMcp(surface, {
      document,
      bindings: [],
    });

    expect(handle.supported).toBe(false);
    expect(handle.toolNames).toEqual([]);
    await expect(handle.refresh()).resolves.toBeUndefined();
    handle.dispose();
  });

  it("registers only trusted explicit bindings with exact schemas and conservative annotations", async () => {
    const { surface } = registeredSurface({
      risk: "consequential",
      requiresConfirmation: true,
      idempotency: "keyed",
      inputSchema: { type: "string", minLength: 1 },
    });
    const context = new FakeModelContext();
    const handle = await exportAgentSurfaceToWebMcp(surface, {
      modelContext: context,
      bindings: [binding],
    });
    const tool = context.tools.get(binding.name)!;

    expect(handle.toolNames).toEqual([binding.name]);
    expect(tool.description).toBe(binding.description);
    expect(tool.description).not.toContain("Hostile DOM instructions");
    expect(tool.inputSchema).toEqual({
      type: "object",
      additionalProperties: false,
      properties: {
        input: { type: "string", minLength: 1 },
        idempotencyKey: {
          type: "string",
          pattern: "^[A-Za-z0-9._~-]{1,128}$",
        },
      },
      required: ["input", "idempotencyKey"],
    });
    expect(tool.annotations).toEqual({
      readOnlyHint: false,
      consequentialHint: true,
      untrustedContentHint: true,
    });
    handle.dispose();
  });

  it.each([
    ["read", false, true],
    ["write", true, false],
    ["consequential", true, false],
    ["destructive", true, false],
  ] as const)(
    "maps %s risk to conservative WebMCP hints",
    async (risk, consequentialHint, readOnlyHint) => {
      const { surface } = registeredSurface({ risk });
      const context = new FakeModelContext();
      const handle = await exportAgentSurfaceToWebMcp(surface, {
        modelContext: context,
        bindings: [binding],
      });

      expect(context.tools.get(binding.name)?.annotations).toEqual({
        readOnlyHint,
        consequentialHint,
        untrustedContentHint: true,
      });
      handle.dispose();
    },
  );

  it.each([
    ["function", () => ({ type: "string", unsafe: () => true })],
    ["non-finite number", () => ({ type: "number", maximum: Infinity })],
    ["non-plain object", () => ({ type: "string", metadata: new Date() })],
    ["unsupported reference", () => ({ $ref: "#/$defs/value" })],
    [
      "accessor",
      () => {
        const schema: Record<string, unknown> = { type: "string" };
        Object.defineProperty(schema, "title", {
          enumerable: true,
          get: () => "must not execute",
        });
        return schema;
      },
    ],
    [
      "cycle",
      () => {
        const schema: Record<string, unknown> = { type: "object" };
        schema.self = schema;
        return schema;
      },
    ],
    ["oversized schema", () => ({ description: "x".repeat(33_000) })],
    [
      "excessive depth",
      () => {
        const root: Record<string, unknown> = {};
        let current = root;
        for (let depth = 0; depth < 22; depth += 1) {
          const child: Record<string, unknown> = {};
          current.child = child;
          current = child;
        }
        return root;
      },
    ],
  ] as const)(
    "rejects a non-portable %s before any tool registration",
    async (_case, createSchema) => {
      const context = new FakeModelContext();

      await expect(
        exportAgentSurfaceToWebMcp(surfaceWithInputSchema(createSchema()), {
          modelContext: context,
          bindings: [binding],
        }),
      ).rejects.toThrow(
        "WebMCP inputSchema must be portable JSON Schema",
      );
      expect(context.registrations).toEqual([]);
      expect(context.tools.size).toBe(0);
    },
  );

  it("delegates valid calls to performSafe and keeps invalid input redacted", async () => {
    const { surface, handler } = registeredSurface({
      risk: "write",
      effects: ["submitted"],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { quantity: { type: "integer", minimum: 1 } },
        required: ["quantity"],
      },
    });
    const context = new FakeModelContext();
    const handle = await exportAgentSurfaceToWebMcp(surface, {
      modelContext: context,
      bindings: [binding],
    });
    const tool = context.tools.get(binding.name)!;

    const malformed = await tool.execute({ unexpected: "SECRET" });
    expect(malformed).toMatchObject({
      status: "failed",
      error: { code: "invalid_input" },
    });
    expect(JSON.stringify(malformed)).not.toContain("SECRET");
    expect(handler).not.toHaveBeenCalled();

    const schemaInvalid = await tool.execute({ input: { quantity: 0 } });
    expect(schemaInvalid).toMatchObject({
      status: "failed",
      error: { code: "invalid_input" },
    });
    expect(handler).not.toHaveBeenCalled();

    const success = await tool.execute({ input: { quantity: 2 } });
    expect(success.status).toBe("succeeded");
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      { quantity: 2 },
      document.querySelector("button"),
    );
    handle.dispose();
  });

  it("binds tools to the observed revision and refuses stale execution", async () => {
    const { surface, handler } = registeredSurface({ risk: "read" });
    const context = new FakeModelContext();
    const handle = await exportAgentSurfaceToWebMcp(surface, {
      modelContext: context,
      bindings: [binding],
    });
    const tool = context.tools.get(binding.name)!;
    document.querySelector("button")!.textContent = "Changed";

    const outcome = await tool.execute({});

    expect(outcome).toMatchObject({
      status: "failed",
      error: { code: "stale_revision" },
    });
    expect(handler).not.toHaveBeenCalled();
    handle.dispose();
  });

  it("forwards keyed idempotency and preserves replay/conflict behavior", async () => {
    const { surface, handler } = registeredSurface({
      risk: "write",
      effects: ["submitted"],
      idempotency: "keyed",
      inputSchema: { type: "integer" },
    });
    const context = new FakeModelContext();
    const handle = await exportAgentSurfaceToWebMcp(surface, {
      modelContext: context,
      bindings: [binding],
    });
    const tool = context.tools.get(binding.name)!;

    const first = await tool.execute({ input: 1, idempotencyKey: "request-1" });
    const replay = await tool.execute({ input: 1, idempotencyKey: "request-1" });
    const conflict = await tool.execute({
      input: 2,
      idempotencyKey: "request-1",
    });

    expect(first.status).toBe("succeeded");
    expect(replay).toEqual(first);
    expect(conflict).toMatchObject({
      status: "failed",
      error: { code: "idempotency_conflict" },
    });
    expect(handler).toHaveBeenCalledOnce();
    handle.dispose();
  });

  it("honors pre-aborted execution without starting core work", async () => {
    const { surface, handler } = registeredSurface({ risk: "read" });
    const context = new FakeModelContext();
    const handle = await exportAgentSurfaceToWebMcp(surface, {
      modelContext: context,
      bindings: [binding],
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      context.tools.get(binding.name)!.execute({}, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(handler).not.toHaveBeenCalled();
    handle.dispose();
  });

  it("refreshes revisions without duplicate tools and disposes idempotently", async () => {
    const { surface, handler } = registeredSurface({ risk: "read" });
    const context = new FakeModelContext();
    const handle = await exportAgentSurfaceToWebMcp(surface, {
      modelContext: context,
      bindings: [binding],
    });
    const firstTool = context.tools.get(binding.name)!;
    document.querySelector("button")!.textContent = "Changed";

    await handle.refresh();

    expect(context.tools.size).toBe(1);
    expect(context.registrations).toHaveLength(2);
    expect(context.tools.get(binding.name)).not.toBe(firstTool);
    expect((await context.tools.get(binding.name)!.execute({})).status).toBe(
      "succeeded",
    );
    expect(handler).toHaveBeenCalledOnce();
    handle.dispose();
    handle.dispose();
    expect(context.tools.size).toBe(0);

    const remount = await exportAgentSurfaceToWebMcp(surface, {
      modelContext: context,
      bindings: [binding],
    });
    expect(context.tools.size).toBe(1);
    remount.dispose();
  });

  it("rolls back partial registration and releases the exporter lock", async () => {
    document.body.innerHTML = `
      <button data-agent-id="first">First</button>
      <button data-agent-id="second">Second</button>
    `;
    const surface = createAgentSurface({ surfaceId: "rollback" });
    const context = new FakeModelContext();
    context.failOnName = "second.run";
    const bindings = [
      {
        name: "first.run",
        description: "Run first",
        elementId: "first",
        action: "click",
      },
      {
        name: "second.run",
        description: "Run second",
        elementId: "second",
        action: "click",
      },
    ];

    await expect(
      exportAgentSurfaceToWebMcp(surface, {
        modelContext: context,
        bindings,
      }),
    ).rejects.toThrow("registration failed");
    expect(context.tools.size).toBe(0);

    context.failOnName = undefined;
    const remount = await exportAgentSurfaceToWebMcp(surface, {
      modelContext: context,
      bindings,
    });
    expect(context.tools.size).toBe(2);
    remount.dispose();
  });

  it("does not leak a registration when disposed during refresh", async () => {
    const { surface } = registeredSurface({ risk: "read" });
    const context = new FakeModelContext();
    const handle = await exportAgentSurfaceToWebMcp(surface, {
      modelContext: context,
      bindings: [binding],
    });
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const originalRegister = context.registerTool.bind(context);
    context.registerTool = async (tool, options) => {
      originalRegister(tool, options);
      await waiting;
    };

    const refreshing = handle.refresh();
    await Promise.resolve();
    handle.dispose();
    release();

    await expect(refreshing).rejects.toMatchObject({ name: "AbortError" });
    expect(context.tools.size).toBe(0);
  });

  it("rejects unsafe configuration before registering anything", async () => {
    const { surface } = registeredSurface({ risk: "credential" });
    const context = new FakeModelContext();

    await expect(
      exportAgentSurfaceToWebMcp(surface, {
        modelContext: context,
        bindings: [binding],
      }),
    ).rejects.toThrow("cannot export a credential action");
    expect(context.tools.size).toBe(0);

    await expect(
      exportAgentSurfaceToWebMcp(surface, {
        modelContext: context,
        bindings: [{ ...binding, name: "bad tool name" }],
      }),
    ).rejects.toThrow("Invalid WebMCP tool name");
    expect(context.tools.size).toBe(0);
  });
});
