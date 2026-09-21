import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";

import type { McpSurface } from "../../../src/mcp/index.js";
import { isRecord } from "../canonical.js";
import type {
  ConformanceCaseBinding,
  ConformanceDriver,
  ConformanceDriverInput,
  ConformanceExecutionPlan,
  ConformanceTarget,
} from "../types.js";
import { loadInstalledPackageApis } from "../installed-package.js";
import {
  bindingFor,
  createCoreFixturePorts,
  recordAdapterFailure,
  requestsFromDriverInput,
} from "./shared.js";

export async function createMcpConformanceBinding(
  plan: Readonly<ConformanceExecutionPlan>,
  target: ConformanceTarget,
): Promise<ConformanceCaseBinding> {
  if (target.targetId !== "mcp-sdk" || target.family !== "mcp" || target.tier !== "protocol") {
    throw new TypeError("MCP conformance binding requires the mcp-sdk target");
  }
  const scenarioId = plan.scenarioId;
  const apis = await loadInstalledPackageApis();
  const { runtime, execution } = createCoreFixturePorts(plan, apis);
  const surface: McpSurface = scenarioId === "SURFACE-01"
    ? {
        snapshot: () => ({ ...runtime.initialSnapshot, surfaceId: "wrong-surface" }),
        performSafe: async (request) => ({
          ...await runtime.surface.performSafe(request),
          // The facade owns its advertised identity. The core still produces
          // the real surface-mismatch failure; rebinding only the envelope ID
          // keeps the McpSurface contract internally consistent for projection.
          surfaceId: "wrong-surface",
        }),
      }
    : runtime.surface;
  const exporter = apis.createAgentSurfaceMcpServer(surface, {
    serverName: "dual-surface-ui-conformance",
    serverVersion: "0.1.0",
    surfaceRef: "conformance-surface",
    principalRef: "conformance-principal",
    bindings: [{
      name: "conformance.approve",
      description: "Approve the conformance fixture",
      elementId: "approval",
      action: "approve",
    }],
    authorize: () => true,
  });
  const client = new Client({ name: "conformance-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    exporter.server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  const listed = await client.listTools();
  if (!listed.tools.some((tool) => tool.name === "conformance.approve")) {
    throw new TypeError("MCP fixture tool was not discoverable");
  }

  const recordResult = (operation: number, value: unknown) => {
    if (!isRecord(value)) throw new TypeError("MCP result omitted structured content");
    if (value.status === "succeeded") {
      runtime.raw.outcomes.push({
        operation,
        status: "succeeded",
        previousRevision: value.previousRevision,
        revision: value.revision,
        actionRef: value.action,
        targetPresent: value.targetPresent,
        ...(value.output === undefined ? {} : { output: value.output }),
      });
      return;
    }
    const error = value.error;
    if (!isRecord(error) || typeof error.code !== "string") {
      throw new TypeError("MCP failure omitted its normalized code");
    }
    runtime.raw.outcomes.push({
      operation,
      status: "failed",
      revision: value.revision,
      code: error.code,
    });
  };

  const driver: ConformanceDriver = {
    targetId: "mcp-sdk",
    family: "mcp",
    tier: "protocol",
    async run(input: Readonly<ConformanceDriverInput>, signal: AbortSignal) {
      const requests = requestsFromDriverInput(input, scenarioId, runtime.packageBinding);
      if (signal.aborted) throw signal.reason;
      for (const request of requests) {
        runtime.setOperation(request);
        if (scenarioId === "STALE-01") runtime.makeRevisionStale();
        const call = {
          name: "conformance.approve",
          arguments: {
            revision: runtime.initialSnapshot.revision,
            ...(request.input === undefined ? {} : { input: request.input }),
            ...(request.idempotencyKey === undefined ? {} : { idempotencyKey: request.idempotencyKey }),
          },
        };
        if (request.controls.cancelTiming === "before_start") {
          const controller = new AbortController();
          controller.abort();
          try {
            const result = await client.callTool(call, { signal: controller.signal });
            recordResult(request.operation, result.structuredContent);
          } catch (error) {
            recordAdapterFailure(runtime, request.operation, error, "cancelled_invocation");
          }
          continue;
        }
        if (request.controls.disposeTiming === "before_start") {
          await exporter.dispose();
          try {
            const result = await client.callTool(call);
            recordResult(request.operation, result.structuredContent);
          } catch (error) {
            recordAdapterFailure(runtime, request.operation, error, "disposed_registration");
          }
          continue;
        }
        const controller = new AbortController();
        if (request.controls.cancelTiming === "after_start") {
          runtime.setActionStartedHook(() => controller.abort("cancelled-after-start"));
        } else if (request.controls.disposeTiming === "after_start") {
          runtime.setActionStartedHook(() => { void exporter.dispose(); });
        }
        try {
          const result = await client.callTool(call, { signal: controller.signal });
          recordResult(request.operation, result.structuredContent);
        } catch (error) {
          if (
            request.controls.cancelTiming === "after_start" ||
            request.controls.disposeTiming === "after_start"
          ) {
            await runtime.waitForSettlement(request.operation);
            if (runtime.recordVerifiedOutcome(request.operation)) continue;
          }
          recordAdapterFailure(
            runtime,
            request.operation,
            error,
            request.controls.disposeTiming === "after_start"
              ? "disposed_registration"
              : "cancelled_invocation",
          );
        }
      }
      return runtime.raw;
    },
  };
  return bindingFor(target, execution, driver, async () => {
    await client.close().catch(() => undefined);
    await exporter.dispose().catch(() => undefined);
  });
}
