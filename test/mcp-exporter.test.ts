import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAgentSurfaceMcpServer } from "../src/mcp/index.js";
import type {
  AgentActionOutcome,
  AgentActionRequest,
  AgentSnapshot,
} from "../src/types.js";

const SECRET = "mcp-secret-sentinel";

function snapshot(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    schemaVersion: "0.1",
    surfaceId: `internal-${SECRET}`,
    revision: "7",
    title: "Checkout",
    url: `https://user:${SECRET}@example.test/pay?token=${SECRET}#${SECRET}`,
    generatedAt: "2026-09-19T00:00:00.000Z",
    capabilities: ["snapshot", "perform"],
    nodes: [{
      id: "submit",
      role: "button",
      name: "Submit order",
      state: {},
      actions: [{
        name: "activate",
        risk: "consequential",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: { note: { type: "string" } },
          required: ["note"],
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          properties: { accepted: { type: "boolean" } },
          required: ["accepted"],
        },
        idempotency: "keyed",
        requiresConfirmation: true,
      }],
    }],
    ...overrides,
  };
}

function succeeded(request: AgentActionRequest): AgentActionOutcome {
  return {
    schemaVersion: "0.1",
    surfaceId: request.surfaceId,
    previousRevision: request.revision,
    revision: "8",
    status: "succeeded",
    action: request.action,
    targetId: request.elementId,
    targetPresent: true,
    output: { accepted: true },
  };
}

const binding = {
  name: "checkout.submit",
  description: "Submit the current order after trusted confirmation",
  elementId: "submit",
  action: "activate",
  projectOutput: (output: Parameters<NonNullable<import("../src/mcp/index.js").McpToolBinding["projectOutput"]>>[0]) => output,
} as const;

interface ConnectedHarness {
  client: Client;
  exporter: ReturnType<typeof createAgentSurfaceMcpServer>;
}

const connected: ConnectedHarness[] = [];

async function connect(options: {
  allow?: boolean;
  current?: AgentSnapshot;
  performSafe?: (request: AgentActionRequest) => Promise<AgentActionOutcome>;
} = {}): Promise<ConnectedHarness> {
  const current = options.current ?? snapshot();
  const exporter = createAgentSurfaceMcpServer({
    snapshot: () => current,
    performSafe: options.performSafe ?? (async (request) => succeeded(request)),
  }, {
    serverName: "dual-surface-ui",
    serverVersion: "0.1.0",
    surfaceRef: "checkout-public",
    principalRef: "test-principal",
    bindings: [binding],
    authorize: () => options.allow ?? true,
  });
  const client = new Client({ name: "p3-1-test", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    exporter.server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  const harness = { client, exporter };
  connected.push(harness);
  return harness;
}

afterEach(async () => {
  await Promise.all(connected.splice(0).map(async ({ client, exporter }) => {
    await client.close().catch(() => undefined);
    await exporter.dispose().catch(() => undefined);
  }));
});

describe("MCP exporter", () => {
  it("lists only explicit tools with strict typed envelopes", async () => {
    const { client } = await connect();

    const resources = await client.listResources();
    const tools = await client.listTools();

    expect(resources.resources).toEqual([expect.objectContaining({
      uri: "dual-surface://surface/checkout-public/snapshot",
      mimeType: "application/json",
    })]);
    expect(resources).toMatchObject({ ttlMs: 0, cacheScope: "private" });
    expect(tools.tools).toHaveLength(1);
    expect(tools.tools[0]).toMatchObject({
      name: binding.name,
      description: binding.description,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["revision", "input", "idempotencyKey"],
      },
      outputSchema: {
        properties: {
          previousRevision: {
            type: "string",
            pattern: "^[^\\u0000-\\u001F\\u007F]{1,128}$",
          },
          revision: {
            type: "string",
            pattern: "^[^\\u0000-\\u001F\\u007F]{1,128}$",
          },
        },
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    });
    expect(tools).toMatchObject({ ttlMs: 0, cacheScope: "private" });
  });

  it("represents primitive, array, object, and absent inputs in deterministic order", async () => {
    const kinds = [
      ["primitive", { type: "string" }],
      ["array", { type: "array", items: { type: "number" } }],
      ["object", {
        type: "object",
        additionalProperties: false,
        properties: { value: { type: "boolean" } },
      }],
      ["absent", undefined],
    ] as const;
    const current = snapshot({
      nodes: kinds.map(([id, inputSchema]) => ({
        id,
        role: "button",
        name: id,
        state: {},
        actions: [{
          name: "run",
          risk: "read" as const,
          ...(inputSchema ? { inputSchema } : {}),
        }],
      })),
    });
    const exporter = createAgentSurfaceMcpServer({
      snapshot: () => current,
      performSafe: async (request) => succeeded(request),
    }, {
      serverName: "dual-surface-ui",
      serverVersion: "0.1.0",
      surfaceRef: "input-kinds",
      principalRef: "test-principal",
      bindings: [...kinds].reverse().map(([id]) => ({
        name: `kind.${id}`,
        description: `Run ${id} input action`,
        elementId: id,
        action: "run",
      })),
      authorize: () => true,
    });
    const client = new Client({ name: "input-kinds", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      exporter.server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    connected.push({ client, exporter });

    const tools = (await client.listTools()).tools;
    expect(tools.map((tool) => tool.name)).toEqual([
      "kind.absent",
      "kind.array",
      "kind.object",
      "kind.primitive",
    ]);
    expect(tools.map((tool) => tool.inputSchema.properties)).toEqual([
      { revision: expect.any(Object) },
      { revision: expect.any(Object), input: kinds[1][1] },
      { revision: expect.any(Object), input: kinds[2][1] },
      { revision: expect.any(Object), input: kinds[0][1] },
    ]);
  });

  it("projects the current snapshot without private identity or URL secrets", async () => {
    const sensitive = snapshot({
      title: SECRET,
      focusedElementId: "submit",
      nodes: [{
        ...snapshot().nodes[0]!,
        name: SECRET,
        description: SECRET,
        state: { sensitive: true, valuePresent: true },
        actions: [{
          ...snapshot().nodes[0]!.actions[0]!,
          description: SECRET,
          preconditions: [SECRET],
        }],
      }],
    });
    const { client, exporter } = await connect({ current: sensitive });

    const result = await client.readResource({ uri: exporter.snapshotUri });
    const content = result.contents[0];
    expect(content).toMatchObject({ mimeType: "application/json" });
    if (!("text" in content)) throw new Error("Expected text resource");
    const projected = JSON.parse(content.text) as AgentSnapshot;

    expect(projected.surfaceId).toBe("checkout-public");
    expect(projected.url).toBe("https://example.test");
    expect(projected.title).toBe("Agent surface");
    expect(projected.focusedElementId).toBeUndefined();
    expect(projected.nodes[0]).toMatchObject({
      name: "Sensitive field",
      state: { sensitive: true, valuePresent: true },
      actions: [],
    });
    expect(content.text).not.toContain(SECRET);
    expect(result).toMatchObject({ ttlMs: 0, cacheScope: "private" });
  });

  it("delegates a bound call to performSafe with server-owned target fields", async () => {
    const performSafe = vi.fn(async (request: AgentActionRequest) => succeeded(request));
    const { client } = await connect({ performSafe });

    const result = await client.callTool({
      name: binding.name,
      arguments: {
        revision: "7",
        input: { note: "approved" },
        idempotencyKey: "order-7",
      },
    });

    expect(performSafe).toHaveBeenCalledWith({
      surfaceId: `internal-${SECRET}`,
      revision: "7",
      elementId: "submit",
      action: "activate",
      input: { note: "approved" },
      idempotencyKey: "order-7",
    });
    expect(result).toMatchObject({
      structuredContent: {
        schemaVersion: "0.1",
        surfaceRef: "checkout-public",
        previousRevision: "7",
        revision: "8",
        status: "succeeded",
        action: "activate",
        targetId: "submit",
        output: { accepted: true },
      },
    });
    expect(JSON.stringify(result)).not.toContain(`internal-${SECRET}`);
  });

  it("fails closed for unauthorized discovery, reads, and calls", async () => {
    const performSafe = vi.fn(async (request: AgentActionRequest) => succeeded(request));
    const { client, exporter } = await connect({ allow: false, performSafe });

    await expect(client.listResources()).resolves.toMatchObject({ resources: [] });
    await expect(client.listTools()).resolves.toMatchObject({ tools: [] });
    await expect(client.readResource({ uri: exporter.snapshotUri })).rejects.toThrow();
    await expect(client.callTool({
      name: binding.name,
      arguments: {
        revision: SECRET.repeat(200),
        input: { note: "approved" },
        idempotencyKey: "order-7",
      },
    })).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        revision: "unavailable",
        status: "failed",
        error: { code: "authorization_required" },
      },
    });
    expect(performSafe).not.toHaveBeenCalled();
    expect(JSON.stringify(await client.listTools())).not.toContain(SECRET);
  });

  it("rejects invalid envelopes before calling the surface", async () => {
    const performSafe = vi.fn(async (request: AgentActionRequest) => succeeded(request));
    const { client } = await connect({ performSafe });

    const result = await client.callTool({
      name: binding.name,
      arguments: {
        revision: "7",
        input: { note: "approved" },
        idempotencyKey: "bad key",
      },
    });

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        status: "failed",
        error: { code: "invalid_input" },
      },
    });
    expect(performSafe).not.toHaveBeenCalled();
  });

  it("preserves core failures while redacting thrown exceptions", async () => {
    const coreFailure = vi.fn(async (): Promise<AgentActionOutcome> => ({
      schemaVersion: "0.1",
      surfaceId: `internal-${SECRET}`,
      revision: "9",
      status: "failed",
      error: {
        code: "stale_revision",
        message: "The observed surface revision is stale",
      },
    }));
    const first = await connect({ performSafe: coreFailure });
    const failed = await first.client.callTool({
      name: binding.name,
      arguments: {
        revision: "7",
        input: { note: "approved" },
        idempotencyKey: "order-7",
      },
    });
    expect(failed).toMatchObject({
      isError: true,
      structuredContent: {
        surfaceRef: "checkout-public",
        revision: "9",
        error: { code: "stale_revision" },
      },
    });

    const second = await connect({
      performSafe: async () => {
        throw new Error(`private stack ${SECRET}`);
      },
    });
    const redacted = await second.client.callTool({
      name: binding.name,
      arguments: {
        revision: "7",
        input: { note: "approved" },
        idempotencyKey: "order-8",
      },
    });
    expect(redacted).toMatchObject({
      isError: true,
      structuredContent: { error: { code: "internal_error" } },
    });
    expect(JSON.stringify(redacted)).not.toContain(SECRET);

    const forged = await connect({
      performSafe: async () => ({
        schemaVersion: "0.1",
        surfaceId: `internal-${SECRET}`,
        revision: "7",
        status: "failed",
        error: { code: "stale_revision", message: `stack ${SECRET}` },
      }),
    });
    const normalized = await forged.client.callTool({
      name: binding.name,
      arguments: {
        revision: "7",
        input: { note: "approved" },
        idempotencyKey: "order-9",
      },
    });
    expect(normalized).toMatchObject({
      structuredContent: {
        error: {
          code: "stale_revision",
          message: "The observed surface revision is stale",
        },
      },
    });
    expect(JSON.stringify(normalized)).not.toContain(SECRET);

    const inheritedCode = await connect({
      performSafe: async () => ({
        schemaVersion: "wrong" as "0.1",
        surfaceId: "foreign-surface",
        revision: "7",
        status: "failed",
        error: {
          code: "toString" as "internal_error",
          message: SECRET,
        },
      }),
    });
    const hardened = await inheritedCode.client.callTool({
      name: binding.name,
      arguments: {
        revision: "7",
        input: { note: "approved" },
        idempotencyKey: "order-10",
      },
    });
    expect(hardened).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: "internal_error",
          message: "The action failed unexpectedly",
        },
      },
    });
    expect(JSON.stringify(hardened)).not.toContain(SECRET);
  });

  it("rejects unavailable, credential, duplicate, and untrusted bindings", () => {
    const base = {
      snapshot: () => snapshot(),
      performSafe: async (request: AgentActionRequest) => succeeded(request),
    };
    const options = {
      serverName: "dual-surface-ui",
      serverVersion: "0.1.0",
      surfaceRef: "checkout-public",
      principalRef: "test-principal",
      bindings: [binding],
      authorize: () => true,
    };

    expect(() => createAgentSurfaceMcpServer(base, {
      ...options,
      bindings: [{ ...binding, elementId: "missing" }],
    })).toThrow("unavailable or credential");
    expect(() => createAgentSurfaceMcpServer(base, {
      ...options,
      bindings: [binding, { ...binding, name: "checkout.other" }],
    })).toThrow("Duplicate");
    expect(() => createAgentSurfaceMcpServer(base, {
      ...options,
      surfaceRef: `https://example.test/?token=${SECRET}`,
    })).toThrow("opaque URL-safe identifier");
    expect(() => createAgentSurfaceMcpServer({
      ...base,
      snapshot: () => snapshot({
        nodes: [{
          ...snapshot().nodes[0]!,
          actions: [{ ...snapshot().nodes[0]!.actions[0]!, risk: "credential" }],
        }],
      }),
    }, options)).toThrow("unavailable or credential");
    expect(() => createAgentSurfaceMcpServer({
      ...base,
      snapshot: () => snapshot({
        nodes: [{
          ...snapshot().nodes[0]!,
          actions: [{
            ...snapshot().nodes[0]!.actions[0]!,
            inputSchema: {
              type: "string",
              "x-mcp-header": "secret-route",
            },
          }],
        }],
      }),
    }, options)).toThrow("transport-only keywords");
    expect(() => createAgentSurfaceMcpServer({
      ...base,
      snapshot: () => snapshot({
        nodes: [{
          ...snapshot().nodes[0]!,
          actions: [{
            ...snapshot().nodes[0]!.actions[0]!,
            inputSchema: { type: "not-a-json-schema-type" },
          }],
        }],
      }),
    }, options)).toThrow();
    expect(() => createAgentSurfaceMcpServer({
      ...base,
      snapshot: () => snapshot({ revision: "r".repeat(129) }),
    }, options)).toThrow("snapshot is unavailable");
  });

  it("captures security configuration so later option mutation cannot grant access", async () => {
    const options = {
      serverName: "dual-surface-ui",
      serverVersion: "0.1.0",
      surfaceRef: "fixed-surface",
      principalRef: "fixed-principal",
      bindings: [binding],
      authorize: () => false,
    };
    const exporter = createAgentSurfaceMcpServer({
      snapshot,
      performSafe: async (request) => succeeded(request),
    }, options);
    options.surfaceRef = "mutated-surface";
    options.principalRef = "mutated-principal";
    options.authorize = () => true;
    const client = new Client({ name: "mutation-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      exporter.server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    connected.push({ client, exporter });

    expect(exporter.snapshotUri).toContain("fixed-surface");
    await expect(client.listTools()).resolves.toMatchObject({ tools: [] });
  });

  it("enforces snapshot, catalog, and action-result serialization budgets", async () => {
    const oversizedSnapshot = snapshot({
      nodes: [{
        ...snapshot().nodes[0]!,
        name: "n".repeat(1_048_576),
      }],
    });
    const snapshotHarness = await connect({ current: oversizedSnapshot });
    await expect(snapshotHarness.client.readResource({
      uri: snapshotHarness.exporter.snapshotUri,
    })).rejects.toThrow("snapshot is unavailable");

    const catalogNodes = Array.from({ length: 9 }, (_, index) => ({
      id: `target-${index}`,
      role: "button",
      name: `Target ${index}`,
      state: {},
      actions: [{
        name: "run",
        risk: "read" as const,
        inputSchema: {
          type: "string",
          description: "d".repeat(30_000),
        },
      }],
    }));
    expect(() => createAgentSurfaceMcpServer({
      snapshot: () => snapshot({ nodes: catalogNodes }),
      performSafe: async (request) => succeeded(request),
    }, {
      serverName: "dual-surface-ui",
      serverVersion: "0.1.0",
      surfaceRef: "large-catalog",
      principalRef: "test-principal",
      bindings: catalogNodes.map((node, index) => ({
        name: `catalog.tool-${index}`,
        description: `Catalog tool ${index}`,
        elementId: node.id,
        action: "run",
      })),
      authorize: () => true,
    })).toThrow("catalog exceeds");

    const resultSnapshot = snapshot({
      nodes: [{
        ...snapshot().nodes[0]!,
        actions: [{
          name: "activate",
          risk: "read",
          outputSchema: { type: "string" },
        }],
      }],
    });
    const resultExporter = createAgentSurfaceMcpServer({
      snapshot: () => resultSnapshot,
      performSafe: async (request) => ({
        schemaVersion: "0.1",
        surfaceId: request.surfaceId,
        previousRevision: request.revision,
        revision: request.revision,
        status: "succeeded",
        action: request.action,
        targetId: request.elementId,
        targetPresent: true,
        output: "o".repeat(262_144),
      }),
    }, {
      serverName: "dual-surface-ui",
      serverVersion: "0.1.0",
      surfaceRef: "large-result",
      principalRef: "test-principal",
      bindings: [{
        name: "result.large",
        description: "Return a projected result",
        elementId: "submit",
        action: "activate",
        projectOutput: (output) => output,
      }],
      authorize: () => true,
    });
    const resultClient = new Client({ name: "large-result", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      resultExporter.server.connect(serverTransport),
      resultClient.connect(clientTransport),
    ]);
    connected.push({ client: resultClient, exporter: resultExporter });
    await expect(resultClient.callTool({
      name: "result.large",
      arguments: { revision: "7" },
    })).resolves.toMatchObject({
      isError: true,
      structuredContent: { error: { code: "internal_error" } },
    });
  });

  it("closes idempotently and retained clients cannot execute", async () => {
    const performSafe = vi.fn(async (request: AgentActionRequest) => succeeded(request));
    const { client, exporter } = await connect({ performSafe });

    await exporter.dispose();
    await exporter.dispose();
    await expect(client.callTool({
      name: binding.name,
      arguments: {
        revision: "7",
        input: { note: "approved" },
        idempotencyKey: "order-7",
      },
    })).rejects.toThrow();
    expect(performSafe).not.toHaveBeenCalled();
  });

  it("fails closed when disposal races asynchronous authorization", async () => {
    let releaseAuthorization!: (allowed: boolean) => void;
    let markAuthorizationStarted!: () => void;
    const authorizationStarted = new Promise<void>((resolve) => {
      markAuthorizationStarted = resolve;
    });
    const authorize = vi.fn(() => {
      markAuthorizationStarted();
      return new Promise<boolean>((resolve) => {
        releaseAuthorization = resolve;
      });
    });
    const snapshotSpy = vi.fn(snapshot);
    const exporter = createAgentSurfaceMcpServer({
      snapshot: snapshotSpy,
      performSafe: vi.fn(),
    }, {
      serverName: "dual-surface-ui",
      serverVersion: "0.1.0",
      surfaceRef: "dispose-race",
      principalRef: "test-principal",
      bindings: [binding],
      authorize,
    });
    const client = new Client({ name: "dispose-race", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      exporter.server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    connected.push({ client, exporter });

    const listing = client.listTools();
    await authorizationStarted;
    const disposing = exporter.dispose();
    releaseAuthorization(true);
    await Promise.allSettled([listing, disposing]);

    expect(snapshotSpy).toHaveBeenCalledTimes(1);
  });

  it("does not execute when a tool call is cancelled during authorization", async () => {
    let releaseAuthorization!: () => void;
    let markAuthorizationStarted!: () => void;
    const authorizationStarted = new Promise<void>((resolve) => {
      markAuthorizationStarted = resolve;
    });
    const performSafe = vi.fn(async (request: AgentActionRequest) => succeeded(request));
    const exporter = createAgentSurfaceMcpServer({
      snapshot,
      performSafe,
    }, {
      serverName: "dual-surface-ui",
      serverVersion: "0.1.0",
      surfaceRef: "cancel-call",
      principalRef: "test-principal",
      bindings: [binding],
      authorize(request) {
        if (request.operation !== "tools.call") return true;
        markAuthorizationStarted();
        return new Promise<boolean>((resolve) => {
          releaseAuthorization = () => resolve(true);
        });
      },
    });
    const client = new Client({ name: "cancel-call", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      exporter.server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    connected.push({ client, exporter });
    const controller = new AbortController();
    const call = client.callTool({
      name: binding.name,
      arguments: {
        revision: "7",
        input: { note: "approved" },
        idempotencyKey: "cancelled-call",
      },
    }, { signal: controller.signal });
    await authorizationStarted;
    controller.abort();
    releaseAuthorization();

    await expect(call).rejects.toThrow();
    expect(performSafe).not.toHaveBeenCalled();
  });
});
