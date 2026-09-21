import { createAgentSurface, normalizeAgentFailure } from "dual-surface-ui";
import { exportAgentSurfaceToWebMcp, type WebMcpSurface } from "dual-surface-ui/webmcp";
import type { CanonicalJson } from "../../src/delta/canonical.js";
import type { createAgentSurface as SourceCreateAgentSurface } from "../../src/surface.js";
import type { AgentActionOutcome } from "../../src/types.js";
import type {
  ConformanceCaseBinding,
  ConformanceDriver,
  ConformanceDriverInput,
  ConformanceExecutionPlan,
  ConformanceTarget,
} from "../../test/conformance/types.js";
import type { InstalledPackageBinding } from "../../test/conformance/installed-package.js";
import {
  bindingFor,
  createCoreFixturePorts,
  recordAdapterFailure,
  requestsFromDriverInput,
  type DriverFixtureRuntime,
} from "../../test/conformance/drivers/shared.js";

interface NativeTool {
  readonly name: string;
}

interface NativeModelContext {
  registerTool: (...args: unknown[]) => unknown;
  getTools(): Promise<readonly NativeTool[]>;
  executeTool(
    tool: NativeTool,
    input: unknown,
    options?: { readonly signal?: AbortSignal },
  ): Promise<unknown>;
}

interface NativeDocument extends Document {
  readonly modelContext?: NativeModelContext;
}

function nativeModelContext(): NativeModelContext | undefined {
  const context = (document as NativeDocument).modelContext;
  return context &&
    typeof context.registerTool === "function" &&
    typeof context.getTools === "function" &&
    typeof context.executeTool === "function"
    ? context
    : undefined;
}

function encodeNativeExecuteInput(input: unknown): unknown {
  const match = /(?:Chrome|Chromium)\/(\d+)/.exec(navigator.userAgent);
  const chromeMajor = match ? Number(match[1]) : undefined;
  return chromeMajor !== undefined && chromeMajor < 155 ? JSON.stringify(input) : input;
}

function parseNativeExecuteResult(value: unknown): unknown {
  if (value !== null && typeof value === "object") return value;
  if (typeof value !== "string") throw new TypeError("invalid_native_result");
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new TypeError("invalid_native_result");
  }
}

function asActionOutcome(value: unknown): AgentActionOutcome {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("invalid_native_result");
  }
  const status = (value as { readonly status?: unknown }).status;
  if (status !== "succeeded" && status !== "failed") {
    throw new TypeError("invalid_native_result");
  }
  return value as AgentActionOutcome;
}

export function hasNativeWebMcpApi(): boolean {
  return nativeModelContext() !== undefined;
}

function envelopeFor(request: {
  readonly input?: CanonicalJson;
  readonly idempotencyKey?: string;
}): Record<string, CanonicalJson> {
  return {
    ...(request.input === undefined ? {} : { input: request.input }),
    ...(request.idempotencyKey === undefined ? {} : { idempotencyKey: request.idempotencyKey }),
  };
}

async function registeredTool(context: NativeModelContext): Promise<NativeTool> {
  const tools = await context.getTools();
  const tool = tools.find((candidate) => candidate.name === "conformance.approve");
  if (!tool) throw new TypeError("native_tool_unavailable");
  return tool;
}

async function waitForActionStarted(
  lifecycle: readonly Record<string, unknown>[],
  operation: number,
  settled: Promise<unknown>,
): Promise<boolean> {
  let invocationSettled = false;
  void settled.then(() => { invocationSettled = true; });
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (lifecycle.some((event) =>
      event.operation === operation && event.event === "action_started"
    )) return true;
    if (invocationSettled) return false;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new TypeError("native_start_boundary_unavailable");
}

function recordObservedDisposedFailure(
  fixture: DriverFixtureRuntime,
  operation: number,
): void {
  const revision = fixture.surface.snapshot().revision;
  fixture.raw.outcomes.push({ operation, status: "failed", revision, code: "stale_revision" });
  fixture.raw.lifecycle.push({
    operation,
    event: "action_failed",
    outcome: "stale_revision",
    sequence: 1,
    revision,
  });
}

export async function createNativeWebMcpConformanceBinding(
  plan: Readonly<ConformanceExecutionPlan>,
  target: ConformanceTarget,
  packageBinding: InstalledPackageBinding,
  onAuthoritativeState?: (state: CanonicalJson) => void | Promise<void>,
): Promise<ConformanceCaseBinding> {
  if (target.targetId !== "webmcp-native" || target.family !== "webmcp" || target.tier !== "native-webmcp") {
    throw new TypeError("invalid_native_target");
  }
  const modelContext = nativeModelContext();
  if (!modelContext) throw new TypeError("native_api_unavailable");

  const { runtime: fixture, execution } = createCoreFixturePorts(plan, {
    binding: packageBinding,
    // The verified installed package has a distinct module identity from the
    // workspace declaration graph; bridge only this reviewed factory type.
    createAgentSurface: createAgentSurface as unknown as typeof SourceCreateAgentSurface,
    normalizeAgentFailure,
  }, {
    onAuthoritativeState,
  });
  const scenarioId = plan.scenarioId;
  const surface: WebMcpSurface = scenarioId === "SURFACE-01"
    ? {
        snapshot: () => ({ ...fixture.initialSnapshot, surfaceId: "wrong-surface" }),
        performSafe: (request) => fixture.surface.performSafe(request),
      }
    : fixture.surface;
  // Intentionally omit the compatibility seam. This registration must resolve
  // the browser-owned document.modelContext object or the target is not native.
  const handle = await exportAgentSurfaceToWebMcp(surface, {
    document,
    bindings: [{
      name: "conformance.approve",
      description: "Approve the native conformance fixture",
      elementId: "approval",
      action: "approve",
    }],
  });
  if (!handle.supported) throw new TypeError("native_api_unavailable");
  await registeredTool(modelContext);

  const driver: ConformanceDriver = {
    targetId: "webmcp-native",
    family: "webmcp",
    tier: "native-webmcp",
    async run(input: Readonly<ConformanceDriverInput>, signal: AbortSignal) {
      if (signal.aborted) throw signal.reason;
      const requests = requestsFromDriverInput(input, scenarioId, fixture.packageBinding);

      for (const request of requests) {
        fixture.setOperation(request);
        if (scenarioId === "STALE-01") fixture.makeRevisionStale();
        let tool = await registeredTool(modelContext);
        const encoded = encodeNativeExecuteInput(envelopeFor(request));

        if (request.controls.cancelTiming === "before_start") {
          const controller = new AbortController();
          controller.abort();
          try {
            const result = await modelContext.executeTool(tool, encoded, { signal: controller.signal });
            fixture.recordOutcome(request.operation, asActionOutcome(parseNativeExecuteResult(result)));
          } catch (error) {
            recordAdapterFailure(fixture, request.operation, error, "cancelled_invocation");
          }
          continue;
        }
        if (request.controls.disposeTiming === "before_start") {
          handle.dispose();
          const stillRegistered = (await modelContext.getTools()).some((item) => item.name === tool.name);
          if (stillRegistered) throw new TypeError("native_disposal_failed");
          try {
            const result = await modelContext.executeTool(tool, encoded);
            fixture.recordOutcome(request.operation, asActionOutcome(parseNativeExecuteResult(result)));
          } catch {
            // The native catalog read-back above proves that this exact tool
            // registration was removed before executeTool rejected it. Project
            // that observed transport boundary without reflecting Chrome's
            // intentionally generic UnknownError text.
            recordObservedDisposedFailure(fixture, request.operation);
          }
          continue;
        }

        const controller = new AbortController();
        const invocation = modelContext.executeTool(tool, encoded, { signal: controller.signal })
          .then(
            (value) => ({ status: "fulfilled" as const, value }),
            (error) => ({ status: "rejected" as const, error }),
          );
        if (request.controls.cancelTiming === "after_start" || request.controls.disposeTiming === "after_start") {
          const started = await waitForActionStarted(fixture.raw.lifecycle, request.operation, invocation);
          if (!started) throw new TypeError("native_start_boundary_unavailable");
          if (request.controls.cancelTiming === "after_start") controller.abort();
          if (request.controls.disposeTiming === "after_start") handle.dispose();
        }
        const settled = await invocation;
        if (settled.status === "fulfilled") {
          const outcome = asActionOutcome(parseNativeExecuteResult(settled.value));
          fixture.recordOutcome(request.operation, outcome);
        } else if (request.controls.cancelTiming === "after_start") {
          // Chrome may reject executeTool as soon as its invocation signal is
          // aborted while the already-started core action continues. Wait for
          // the fixture's real audit settlement and derive the outcome only
          // from its observed action_started/action_verified events.
          await fixture.waitForSettlement(request.operation);
          if (!fixture.recordVerifiedOutcome(request.operation)) {
            recordAdapterFailure(
              fixture,
              request.operation,
              settled.error,
              "cancelled_invocation",
            );
          }
        } else if (request.controls.disposeTiming === "after_start") {
          if ((await modelContext.getTools()).some((item) => item.name === tool.name)) {
            throw new TypeError("native_disposal_failed");
          }
          recordObservedDisposedFailure(fixture, request.operation);
        } else {
          recordAdapterFailure(fixture, request.operation, settled.error, "cancelled_invocation");
        }
        if (request.controls.disposeTiming === "after_start") {
          if ((await modelContext.getTools()).some((item) => item.name === tool.name)) {
            throw new TypeError("native_disposal_failed");
          }
        }
      }
      return fixture.raw;
    },
  };
  return bindingFor(target, execution, driver, () => handle.dispose());
}
