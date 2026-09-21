import type { WebMcpModelContext, WebMcpSurface, WebMcpTool } from "../../../src/webmcp/index.js";
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

export async function createWebMcpConformanceBinding(
  plan: Readonly<ConformanceExecutionPlan>,
  target: ConformanceTarget,
): Promise<ConformanceCaseBinding> {
  if (target.targetId !== "webmcp-compat" || target.family !== "webmcp" || target.tier !== "compatibility") {
    throw new TypeError("WebMCP conformance binding requires the compatibility target");
  }
  const scenarioId = plan.scenarioId;
  const apis = await loadInstalledPackageApis();
  const { runtime, execution } = createCoreFixturePorts(plan, apis);
  let registered: WebMcpTool | undefined;
  const modelContext: WebMcpModelContext = {
    registerTool(tool) { registered = tool; },
  };
  const surface: WebMcpSurface = scenarioId === "SURFACE-01"
    ? {
        snapshot: () => ({ ...runtime.initialSnapshot, surfaceId: "wrong-surface" }),
        performSafe: (request) => runtime.surface.performSafe(request),
      }
    : runtime.surface;
  const handle = await apis.exportAgentSurfaceToWebMcp(surface, {
    document,
    modelContext,
    bindings: [{
      name: "conformance.approve",
      description: "Approve the conformance fixture",
      elementId: "approval",
      action: "approve",
    }],
  });
  if (!registered || !handle.supported) throw new TypeError("WebMCP fixture tool was not registered");
  const tool: WebMcpTool = registered;

  const driver: ConformanceDriver = {
    targetId: "webmcp-compat",
    family: "webmcp",
    tier: "compatibility",
    async run(input: Readonly<ConformanceDriverInput>, signal: AbortSignal) {
      const requests = requestsFromDriverInput(input, scenarioId, runtime.packageBinding);
      if (signal.aborted) throw signal.reason;
      for (const request of requests) {
        runtime.setOperation(request);
        if (scenarioId === "STALE-01") runtime.makeRevisionStale();
        const envelope = {
          ...(request.input === undefined ? {} : { input: request.input }),
          ...(request.idempotencyKey === undefined ? {} : { idempotencyKey: request.idempotencyKey }),
        };
        if (request.controls.cancelTiming === "before_start") {
          const controller = new AbortController();
          controller.abort();
          try { runtime.recordOutcome(request.operation, await tool.execute(envelope, { signal: controller.signal })); }
          catch (error) { recordAdapterFailure(runtime, request.operation, error, "cancelled_invocation"); }
          continue;
        }
        if (request.controls.disposeTiming === "before_start") {
          handle.dispose();
          try { runtime.recordOutcome(request.operation, await tool.execute(envelope)); }
          catch (error) { recordAdapterFailure(runtime, request.operation, error, "disposed_registration"); }
          continue;
        }
        const controller = new AbortController();
        if (request.controls.cancelTiming === "after_start") {
          runtime.setActionStartedHook(() => controller.abort("cancelled-after-start"));
        } else if (request.controls.disposeTiming === "after_start") {
          runtime.setActionStartedHook(() => handle.dispose());
        }
        const outcome = await tool.execute(envelope, { signal: controller.signal });
        runtime.recordOutcome(request.operation, outcome);
      }
      return runtime.raw;
    },
  };
  return bindingFor(target, execution, driver, () => handle.dispose());
}
