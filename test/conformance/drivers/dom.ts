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
  requestFor,
  requestsFromDriverInput,
} from "./shared.js";

export async function createDomConformanceBinding(
  plan: Readonly<ConformanceExecutionPlan>,
  target: ConformanceTarget,
): Promise<ConformanceCaseBinding> {
  if (target.targetId !== "dom-jsdom" || target.family !== "dom" || target.tier !== "in-process") {
    throw new TypeError("DOM conformance binding requires the dom-jsdom target");
  }
  const scenarioId = plan.scenarioId;
  const apis = await loadInstalledPackageApis();
  const { runtime, execution } = createCoreFixturePorts(plan, apis);
  const driver: ConformanceDriver = {
    targetId: "dom-jsdom",
    family: "dom",
    tier: "in-process",
    async run(input: Readonly<ConformanceDriverInput>, signal: AbortSignal) {
      const requests = requestsFromDriverInput(input, scenarioId, runtime.packageBinding);
      if (signal.aborted) throw signal.reason;
      for (const request of requests) {
        runtime.setOperation(request);
        if (scenarioId === "STALE-01") runtime.makeRevisionStale();
        const actionRequest = requestFor(runtime, request);
        const outcome = await runtime.surface.performSafe(
          scenarioId === "SURFACE-01"
            ? { ...actionRequest, surfaceId: "wrong-surface" }
            : actionRequest,
        );
        runtime.recordOutcome(request.operation, outcome);
      }
      return runtime.raw;
    },
  };
  return bindingFor(target, execution, driver);
}
