import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAgentSurfaceMcpServer } from "../src/mcp/index.js";
import type { AgentActionRequest, AgentSnapshot } from "../src/types.js";

describe("MCP 2026-07-28 transport", () => {
  const cleanup: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanup.splice(0).map((close) => close().catch(() => undefined)));
  });

  it("negotiates the modern protocol and serves list, read, and call without a socket", async () => {
    let allowed = true;
    const performSafe = vi.fn(async (request: AgentActionRequest) => ({
      schemaVersion: "0.1" as const,
      surfaceId: request.surfaceId,
      previousRevision: request.revision,
      revision: request.revision,
      status: "succeeded" as const,
      action: request.action,
      targetId: request.elementId,
      targetPresent: true,
    }));
    const current: AgentSnapshot = {
      schemaVersion: "0.1",
      surfaceId: "internal-modern",
      revision: "12",
      title: "Modern",
      url: "https://example.test/private?token=secret#fragment",
      generatedAt: "2026-09-19T00:00:00.000Z",
      capabilities: ["snapshot", "perform"],
      nodes: [{
        id: "status",
        role: "status",
        name: "Order status",
        state: {},
        actions: [{ name: "refresh", risk: "read", idempotency: "safe-retry" }],
      }],
    };
    const handler = createMcpHandler(() => createAgentSurfaceMcpServer({
      snapshot: () => current,
      performSafe,
    }, {
      serverName: "dual-surface-ui",
      serverVersion: "0.1.0",
      surfaceRef: "modern-surface",
      principalRef: "modern-principal",
      bindings: [{
        name: "orders.refresh",
        description: "Refresh the current order status",
        elementId: "status",
        action: "refresh",
      }],
      authorize: () => allowed,
    }).server, { legacy: "reject", responseMode: "json" });
    const transport = new StreamableHTTPClientTransport(
      new URL("https://mcp.test/endpoint"),
      {
        fetch: (input, init) => handler.fetch(new Request(input, init)),
      },
    );
    const client = new Client(
      { name: "modern-test", version: "0.1.0" },
      { versionNegotiation: { mode: "auto" } },
    );
    await client.connect(transport);
    cleanup.push(() => client.close(), () => handler.close());

    expect(client.getNegotiatedProtocolVersion()).toBe("2026-07-28");
    await expect(client.listResources()).resolves.toMatchObject({
      resources: [{ uri: "dual-surface://surface/modern-surface/snapshot" }],
      ttlMs: 0,
      cacheScope: "private",
    });
    await expect(client.listTools()).resolves.toMatchObject({
      tools: [{
        name: "orders.refresh",
        annotations: { idempotentHint: true, openWorldHint: true },
      }],
      ttlMs: 0,
      cacheScope: "private",
    });
    const resource = await client.readResource({
      uri: "dual-surface://surface/modern-surface/snapshot",
    });
    expect(JSON.stringify(resource)).not.toContain("secret");
    await expect(client.callTool({
      name: "orders.refresh",
      arguments: { revision: "12" },
    })).resolves.toMatchObject({
      structuredContent: { status: "succeeded", surfaceRef: "modern-surface" },
    });
    expect(performSafe).toHaveBeenCalledTimes(1);

    allowed = false;
    await expect(client.listTools(undefined, { cacheMode: "reload" })).resolves.toMatchObject({
      tools: [],
    });
  });
});
