// @vitest-environment jsdom
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAgentSurface } from "../src/index.js";
import { createAgentSurfaceMcpServer } from "../src/mcp/index.js";
import {
  exportAgentSurfaceToWebMcp,
  type WebMcpModelContext,
  type WebMcpTool,
} from "../src/webmcp/index.js";

const clients: Client[] = [];
const disposers: Array<() => Promise<void>> = [];

async function connect(
  surface: ReturnType<typeof createAgentSurface>,
): Promise<Client> {
  const exporter = createAgentSurfaceMcpServer(surface, {
    serverName: "dual-surface-ui",
    serverVersion: "0.1.0",
    surfaceRef: "orders",
    principalRef: "integration-principal",
    bindings: [{
      name: "orders.submit",
      description: "Submit the reviewed order",
      elementId: "submit",
      action: "submit_order",
      projectOutput: (output) => output,
    }],
    authorize: () => true,
  });
  const client = new Client({ name: "core-integration", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    exporter.server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  clients.push(client);
  disposers.push(() => exporter.dispose());
  return client;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close().catch(() => undefined)));
  await Promise.all(disposers.splice(0).map((dispose) => dispose().catch(() => undefined)));
});

describe("MCP and AgentSurface integration", () => {
  beforeEach(() => {
    document.body.innerHTML = `<button>Submit</button>`;
    window.history.replaceState({}, "", "/orders?private=token#secret");
  });

  it("cannot use MCP arguments to bypass trusted confirmation", async () => {
    const handler = vi.fn(() => ({ accepted: true }));
    const surface = createAgentSurface({
      surfaceId: "internal-orders",
      policy: () => ({ outcome: "require_confirmation" }),
      confirm: () => false,
    });
    surface.register(document.querySelector("button")!, {
      id: "submit",
      actions: {
        submit_order: {
          risk: "consequential",
          requiresConfirmation: true,
          inputSchema: {
            type: "object",
            additionalProperties: false,
            properties: { confirmed: { type: "boolean" } },
            required: ["confirmed"],
          },
          outputSchema: {
            type: "object",
            additionalProperties: false,
            properties: { accepted: { type: "boolean" } },
            required: ["accepted"],
          },
          handler,
        },
      },
    });
    const revision = surface.snapshot().revision;
    const client = await connect(surface);

    const result = await client.callTool({
      name: "orders.submit",
      arguments: { revision, input: { confirmed: true } },
    });

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        status: "failed",
        error: { code: "confirmation_required" },
      },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("preserves keyed replay and stale-revision protection", async () => {
    const handler = vi.fn((_input: unknown, element: Element) => {
      element.textContent = "Submitted";
      return { accepted: true };
    });
    const surface = createAgentSurface({
      surfaceId: "internal-orders",
      policy: () => ({ outcome: "allow" }),
      verifyEffect: () => true,
    });
    surface.register(document.querySelector("button")!, {
      id: "submit",
      actions: {
        submit_order: {
          risk: "write",
          idempotency: "keyed",
          effects: ["order_submitted"],
          inputSchema: {
            type: "object",
            additionalProperties: false,
            properties: { orderId: { type: "string" } },
            required: ["orderId"],
          },
          outputSchema: {
            type: "object",
            additionalProperties: false,
            properties: { accepted: { type: "boolean" } },
            required: ["accepted"],
          },
          handler,
        },
      },
    });
    const revision = surface.snapshot().revision;
    const client = await connect(surface);
    const request = {
      name: "orders.submit",
      arguments: {
        revision,
        input: { orderId: "order-1" },
        idempotencyKey: "order-1",
      },
    };

    const [first, replay] = await Promise.all([
      client.callTool(request),
      client.callTool(request),
    ]);
    const conflict = await client.callTool({
      name: "orders.submit",
      arguments: {
        revision,
        input: { orderId: "conflicting-order" },
        idempotencyKey: "order-1",
      },
    });
    const stale = await client.callTool({
      name: "orders.submit",
      arguments: {
        revision,
        input: { orderId: "order-2" },
        idempotencyKey: "order-2",
      },
    });

    expect(first).toMatchObject({
      structuredContent: { status: "succeeded" },
    });
    expect(first.structuredContent).toEqual(replay.structuredContent);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(conflict).toMatchObject({
      isError: true,
      structuredContent: { error: { code: "idempotency_conflict" } },
    });
    expect(stale).toMatchObject({
      isError: true,
      structuredContent: {
        status: "failed",
        error: { code: "stale_revision" },
      },
    });
  });

  it("keeps MCP and WebMCP outcomes aligned on one authoritative surface", async () => {
    const handler = vi.fn((input: unknown) => ({ echoed: input }));
    const surface = createAgentSurface({
      surfaceId: "shared-surface",
      policy: () => ({ outcome: "allow" }),
    });
    surface.register(document.querySelector("button")!, {
      id: "submit",
      actions: {
        submit_order: {
          risk: "read",
          idempotency: "keyed",
          inputSchema: { type: "string" },
          outputSchema: {
            type: "object",
            additionalProperties: false,
            properties: { echoed: { type: "string" } },
            required: ["echoed"],
          },
          handler,
        },
      },
    });
    let webTool: WebMcpTool | undefined;
    const modelContext: WebMcpModelContext = {
      registerTool(tool) {
        webTool = tool;
      },
    };
    const webHandle = await exportAgentSurfaceToWebMcp(surface, {
      modelContext,
      bindings: [{
        name: "orders.submit",
        description: "Read the reviewed order",
        elementId: "submit",
        action: "submit_order",
      }],
    });
    const exporter = createAgentSurfaceMcpServer(surface, {
      serverName: "dual-surface-ui",
      serverVersion: "0.1.0",
      surfaceRef: "shared-public",
      principalRef: "shared-principal",
      bindings: [{
        name: "orders.submit",
        description: "Read the reviewed order",
        elementId: "submit",
        action: "submit_order",
        projectOutput: (output) => output,
      }],
      authorize: () => true,
    });
    const client = new Client({ name: "parity", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      exporter.server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    clients.push(client);
    disposers.push(() => exporter.dispose());

    const revision = surface.snapshot().revision;
    const webOutcome = await webTool!.execute({
      input: "same-input",
      idempotencyKey: "cross-protocol",
    });
    const mcpOutcome = await client.callTool({
      name: "orders.submit",
      arguments: {
        revision,
        input: "same-input",
        idempotencyKey: "cross-protocol",
      },
    });
    const conflict = await client.callTool({
      name: "orders.submit",
      arguments: {
        revision,
        input: "different-input",
        idempotencyKey: "cross-protocol",
      },
    });

    expect(webOutcome).toMatchObject({
      status: "succeeded",
      previousRevision: revision,
      revision,
      action: "submit_order",
      targetId: "submit",
      output: { echoed: "same-input" },
    });
    expect(mcpOutcome.structuredContent).toMatchObject({
      status: webOutcome.status,
      previousRevision: revision,
      revision,
      action: "submit_order",
      targetId: "submit",
      output: { echoed: "same-input" },
    });
    expect(conflict).toMatchObject({
      isError: true,
      structuredContent: { error: { code: "idempotency_conflict" } },
    });
    expect(surface.snapshot()).toMatchObject({ revision, surfaceId: "shared-surface" });
    expect(handler).toHaveBeenCalledTimes(1);
    webHandle.dispose();
  });
});
