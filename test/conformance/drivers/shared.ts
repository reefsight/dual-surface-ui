import type { AgentAuditEvent } from "../../../src/audit.js";
import type { AgentActionOutcome, AgentSnapshot, createAgentSurface } from "../../../src/index.js";
import type { CanonicalJson } from "../../../src/delta/canonical.js";
import { captureConformanceJson, ConformanceValidationError, isRecord } from "../canonical.js";
import type { InstalledPackageApis, InstalledPackageBinding } from "../installed-package.js";
import type {
  ConformanceCaseBinding,
  ConformanceDriver,
  ConformanceDriverInput,
  ConformanceExecutionPlan,
  ConformanceTarget,
} from "../types.js";

export interface ScenarioControls {
  policy: "allow" | "deny" | "require_confirmation";
  confirmation?: boolean;
  precondition?: boolean;
  effect?: boolean;
  cancelTiming?: "none" | "before_start" | "after_start";
  disposeTiming?: "none" | "before_start" | "after_start";
  originRef?: string;
  principalRef?: string;
}

export interface ScenarioRequest {
  operation: number;
  elementId: string;
  action: string;
  input?: CanonicalJson;
  idempotencyKey?: string;
  controls: ScenarioControls;
}

export interface RawDriverResult {
  discovery: Array<Record<string, unknown>>;
  outcomes: Array<Record<string, unknown>>;
  lifecycle: Array<Record<string, unknown>>;
}

export type AdapterFailureBoundary = "cancelled_invocation" | "disposed_registration";

export interface DriverFixtureRuntime {
  readonly packageBinding: InstalledPackageBinding;
  readonly surface: Pick<ReturnType<typeof createAgentSurface>, "snapshot" | "performSafe">;
  readonly initialSnapshot: AgentSnapshot;
  readonly raw: RawDriverResult;
  readonly button: HTMLButtonElement;
  setOperation(request: ScenarioRequest): void;
  setActionStartedHook(hook: (() => void) | undefined): void;
  replaceTarget(): void;
  makeRevisionStale(): void;
  recordOutcome(operation: number, outcome: AgentActionOutcome): void;
  waitForSettlement(operation: number): Promise<void>;
  recordVerifiedOutcome(operation: number): boolean;
  normalizeFailure(error: unknown): { readonly code: string };
}

interface HarnessFixtureExecutionPort {
  readonly scenarioId: ConformanceExecutionPlan["scenarioId"];
  readonly driverInput: CanonicalJson;
  readAuthoritativeState(): CanonicalJson;
  disposeFixture(): void;
}

export interface CoreFixturePorts {
  readonly runtime: DriverFixtureRuntime;
  readonly execution: HarnessFixtureExecutionPort;
}

export interface CoreFixtureOptions {
  readonly onAuthoritativeState?: (state: CanonicalJson) => void | Promise<void>;
}

function parseRequests(value: readonly CanonicalJson[]): readonly ScenarioRequest[] {
  return value.map((item) => {
    if (!isRecord(item) || !isRecord(item.controls) ||
      !Number.isSafeInteger(item.operation) || typeof item.elementId !== "string" ||
      typeof item.action !== "string" || typeof item.controls.policy !== "string") {
      throw new ConformanceValidationError("invalid_driver_input");
    }
    return item as unknown as ScenarioRequest;
  });
}

function mutableState(value: CanonicalJson): Record<string, CanonicalJson> {
  if (!isRecord(value)) throw new ConformanceValidationError("invalid_driver_state");
  return structuredClone(value) as Record<string, CanonicalJson>;
}

export function createCoreFixturePorts(
  plan: Readonly<ConformanceExecutionPlan>,
  apis: Pick<InstalledPackageApis, "binding" | "createAgentSurface" | "normalizeAgentFailure">,
  options: CoreFixtureOptions = {},
): CoreFixturePorts {
  const scenarioId = plan.scenarioId;
  const state = mutableState(plan.initialState);
  const container = document.createElement("section");
  const button = document.createElement("button");
  button.textContent = "Approve";
  container.append(button);
  document.body.append(container);
  let activeRequest: ScenarioRequest | undefined;
  let currentOperation = 0;
  let replaced = false;
  let actionStartedHook: (() => void) | undefined;
  const settledOperations = new Set<number>();
  const settlementResolvers = new Map<number, () => void>();
  const raw: RawDriverResult = { discovery: [], outcomes: [], lifecycle: [] };

  const onAudit = (event: AgentAuditEvent) => {
      if (event.event === "surface_observed" || currentOperation === 0) return;
      raw.lifecycle.push({
        operation: currentOperation,
        event: event.event,
        outcome: event.outcome,
        sequence: event.sequence,
        revision: event.revision,
        ...(event.action ? { actionRef: event.action } : {}),
      });
      if (event.event === "action_started") actionStartedHook?.();
      if (event.event === "action_verified" || event.event === "action_failed") {
        settledOperations.add(currentOperation);
        settlementResolvers.get(currentOperation)?.();
        settlementResolvers.delete(currentOperation);
        void options.onAuthoritativeState?.(structuredClone(state) as CanonicalJson);
      }
  };

  const keyed = ["REPLAY-01", "CONFLICT-01", "ORIGIN-01", "PRINCIPAL-01"].includes(scenarioId);
  const confirmation = scenarioId === "CONFIRM-01" || scenarioId === "CONFIRM-02";
  const precondition = scenarioId === "PRE-01" || scenarioId === "PRE-02";
  const inputSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      decision: { type: "string", enum: ["approve", "reject"] },
      note: { type: "string" },
    },
    required: ["decision"],
  } as const;
  const mutate = (input: unknown) => {
    if (activeRequest?.controls.effect === false) return undefined;
    const decision = isRecord(input) && input.decision === "reject" ? "rejected" : "approved";
    state.decision = decision;
    state.mutations = Number(state.mutations ?? 0) + 1;
    button.dataset.conformanceMutation = String(state.mutations);
    button.textContent = decision === "approved" ? "Approved" : "Rejected";
    return undefined;
  };
  if (scenarioId === "ORIGIN-01") {
    // AgentSurface derives authority from the root's owner document. This
    // test-only document seam keeps the real installed lifecycle/replay
    // implementation while allowing one surface to cross an actual origin
    // boundary without mutating the process-global jsdom location.
    const authorityDocument = new Proxy(document, {
      get(target, property) {
        if (property === "location") {
        const origin = activeRequest?.controls.originRef === "origin-b"
          ? "https://origin-b.test"
          : document.location.origin;
        return { href: `${origin}/fixture`, origin };
        }
        if (property === "defaultView") return null;
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    Object.defineProperty(container, "ownerDocument", {
      configurable: true,
      value: authorityDocument,
    });
  }
  let surface: Pick<ReturnType<typeof createAgentSurface>, "snapshot" | "performSafe">;
  {
    const agentSurface = apis.createAgentSurface({
      root: container,
      surfaceId: `conformance-${scenarioId.toLowerCase()}`,
      createCorrelationId: () => `case-${scenarioId.toLowerCase()}-${currentOperation}`,
      getPrincipal: () => ({ id: activeRequest?.controls.principalRef ?? "principal-a" }),
      policy: () => {
        if (!activeRequest) return { outcome: "deny" };
        if (scenarioId === "REPLACED-01" && !replaced) {
          replaced = true;
          button.replaceWith(button.cloneNode(true));
        }
        return { outcome: activeRequest.controls.policy };
      },
      confirm: () => activeRequest?.controls.confirmation === true,
      checkPrecondition: () => activeRequest?.controls.precondition !== false,
      verifyEffect: () => activeRequest?.controls.effect !== false,
      onAudit,
    });
    agentSurface.register(button, {
      id: "approval",
      actions: {
        approve: {
          risk: "consequential",
          requiresConfirmation: confirmation,
          ...(keyed ? { idempotency: "keyed" as const } : {}),
          inputSchema,
          ...(precondition ? { preconditions: ["approval_ready"] } : {}),
          effects: ["decision_recorded"],
          handler: mutate,
        },
      },
    });
    surface = agentSurface;
  }
  const initialSnapshot = surface.snapshot();
  const action = initialSnapshot.nodes
    .find((node) => node.id === "approval")?.actions
    .find((candidate) => candidate.name === "approve");
  if (!action) throw new ConformanceValidationError("missing_fixture_action");
  raw.discovery.push({
    actionRef: action.name,
    risk: action.risk,
    requiresConfirmation: action.requiresConfirmation === true,
    idempotency: action.idempotency ?? "none",
    inputSchema,
  });

  const runtime: DriverFixtureRuntime = {
    packageBinding: apis.binding,
    surface,
    initialSnapshot,
    raw,
    button,
    setOperation(request) {
      activeRequest = request;
      currentOperation = request.operation;
      actionStartedHook = undefined;
    },
    setActionStartedHook(hook) { actionStartedHook = hook; },
    replaceTarget() {
      if (!replaced) {
        replaced = true;
        button.replaceWith(button.cloneNode(true));
      }
    },
    makeRevisionStale() {
      button.setAttribute("aria-expanded", "true");
      surface.snapshot();
    },
    recordOutcome(operation, outcome) {
      if (outcome.status === "succeeded") {
        raw.outcomes.push({
          operation,
          status: "succeeded",
          previousRevision: outcome.previousRevision,
          revision: outcome.revision,
          actionRef: outcome.action,
          targetPresent: outcome.targetPresent,
          ...(outcome.output === undefined ? {} : { output: outcome.output }),
        });
      } else {
        raw.outcomes.push({
          operation,
          status: "failed",
          revision: outcome.revision,
          code: outcome.error.code,
        });
      }
    },
    waitForSettlement(operation) {
      if (settledOperations.has(operation)) return Promise.resolve();
      return new Promise<void>((resolve) => settlementResolvers.set(operation, resolve));
    },
    recordVerifiedOutcome(operation) {
      const started = raw.lifecycle.find((event) =>
        event.operation === operation && event.event === "action_started");
      const verified = raw.lifecycle.find((event) =>
        event.operation === operation && event.event === "action_verified");
      if (!started || !verified) return false;
      const snapshot = surface.snapshot();
      raw.outcomes.push({
        operation,
        status: "succeeded",
        previousRevision: started.revision,
        revision: verified.revision,
        actionRef: verified.actionRef ?? "approve",
        targetPresent: snapshot.nodes.some((node) => node.id === "approval"),
      });
      return true;
    },
    normalizeFailure: apis.normalizeAgentFailure,
  };
  const execution: HarnessFixtureExecutionPort = {
    scenarioId,
    driverInput: createDriverInput(plan, apis.binding),
    readAuthoritativeState: () => structuredClone(state) as CanonicalJson,
    disposeFixture: () => container.remove(),
  };
  return Object.freeze({ runtime: Object.freeze(runtime), execution: Object.freeze(execution) });
}

export function requestFor(
  fixture: DriverFixtureRuntime,
  request: ScenarioRequest,
  revision = fixture.initialSnapshot.revision,
) {
  return {
    surfaceId: fixture.initialSnapshot.surfaceId,
    revision,
    elementId: request.elementId,
    action: request.action,
    ...(request.input === undefined ? {} : { input: request.input }),
    ...(request.idempotencyKey === undefined ? {} : { idempotencyKey: request.idempotencyKey }),
  };
}

export function recordAdapterFailure(
  fixture: DriverFixtureRuntime,
  operation: number,
  error: unknown,
  boundary: AdapterFailureBoundary,
): void {
  const normalized = fixture.normalizeFailure(error);
  const isAbort = error instanceof Error && error.name === "AbortError";
  const isDisconnected = error instanceof Error && error.message === "Not connected";
  const code = boundary === "disposed_registration" && (isAbort || isDisconnected)
    ? "stale_revision"
    : normalized.code;
  fixture.raw.outcomes.push({
    operation,
    status: "failed",
    revision: fixture.surface.snapshot().revision,
    code,
  });
  fixture.raw.lifecycle.push({
    operation,
    event: "action_failed",
    outcome: code,
    sequence: 1,
    revision: fixture.surface.snapshot().revision,
  });
}

export function requestsFromDriverInput(
  input: Readonly<ConformanceDriverInput>,
  scenarioId: ConformanceExecutionPlan["scenarioId"],
  expectedPackage: InstalledPackageBinding,
): readonly ScenarioRequest[] {
  if (input.scenarioId !== scenarioId || !isRecord(input.driverInput)) {
    throw new ConformanceValidationError("driver_input_mismatch");
  }
  const driverInput = input.driverInput;
  if (Object.keys(driverInput).sort().join("\0") !== ["actions", "packageEvidence", "requests", "scenarioId"].sort().join("\0") ||
    driverInput.scenarioId !== scenarioId || !Array.isArray(driverInput.actions) || !Array.isArray(driverInput.requests) ||
    !isRecord(driverInput.packageEvidence) ||
    !/^sha256:[0-9a-f]{64}$/.test(String(driverInput.packageEvidence.tarballDigest)) ||
    !/^sha256:[0-9a-f]{64}$/.test(String(driverInput.packageEvidence.installedManifestDigest)) ||
    driverInput.packageEvidence.tarballDigest !== expectedPackage.tarballDigest ||
    driverInput.packageEvidence.installedManifestDigest !== expectedPackage.installedManifestDigest) {
    throw new ConformanceValidationError("driver_input_mismatch");
  }
  return parseRequests(driverInput.requests);
}

export function createDriverInput(
  plan: Readonly<ConformanceExecutionPlan>,
  packageEvidence: InstalledPackageBinding,
): CanonicalJson {
  return captureConformanceJson({
    actions: plan.actions as unknown as CanonicalJson,
    packageEvidence: packageEvidence as unknown as CanonicalJson,
    requests: plan.requests as unknown as CanonicalJson,
    scenarioId: plan.scenarioId,
  });
}

export function bindingFor(
  target: ConformanceTarget,
  execution: HarnessFixtureExecutionPort,
  driver: ConformanceDriver,
  disposeTransport?: () => void | Promise<void>,
): ConformanceCaseBinding {
  return Object.freeze({
    driver: Object.freeze(driver),
    execution: Object.freeze({
      scenarioId: execution.scenarioId,
      driverInput: execution.driverInput,
      readAuthoritativeState: () => execution.readAuthoritativeState(),
      dispose: async () => {
        try { await disposeTransport?.(); } finally { execution.disposeFixture(); }
      },
    }),
  });
}
