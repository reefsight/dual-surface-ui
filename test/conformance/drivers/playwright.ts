import type { Page } from "@playwright/test";
import { randomBytes } from "node:crypto";

import type { AgentAuditEvent } from "../../../src/audit.js";
import type { createPlaywrightSurface } from "../../../src/playwright/index.js";
import type { CanonicalJson } from "../../../src/delta/canonical.js";
import { ConformanceValidationError, isRecord } from "../canonical.js";
import type {
  ConformanceCaseBinding,
  ConformanceDriver,
  ConformanceDriverInput,
  ConformanceExecutionPlan,
  ConformanceTarget,
} from "../types.js";
import { loadInstalledPackageApis } from "../installed-package.js";
import { createDriverInput, requestsFromDriverInput, type RawDriverResult, type ScenarioRequest } from "./shared.js";

const INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    decision: { type: "string", enum: ["approve", "reject"] },
    note: { type: "string" },
  },
  required: ["decision"],
} as const;

function outcomeRecord(operation: number, outcome: Awaited<ReturnType<ReturnType<typeof createPlaywrightSurface>["performSafe"]>>) {
  if (outcome.status === "succeeded") {
    return {
      operation,
      status: "succeeded",
      previousRevision: outcome.previousRevision,
      revision: outcome.revision,
      actionRef: outcome.action,
      targetPresent: outcome.targetPresent,
      ...(outcome.output === undefined ? {} : { output: outcome.output }),
    };
  }
  return {
    operation,
    status: "failed",
    revision: outcome.revision,
    code: outcome.error.code,
  };
}

/**
 * Creates one fresh, real browser-backed Playwright fixture. Expected outcomes
 * never cross this boundary; the driver receives only the detached execution
 * input assembled by the harness.
 */
export async function createPlaywrightConformanceBinding(
  plan: Readonly<ConformanceExecutionPlan>,
  target: ConformanceTarget,
  page: Page,
): Promise<ConformanceCaseBinding> {
  if (
    target.targetId !== "playwright-managed" ||
    target.family !== "playwright" ||
    target.tier !== "managed-engine"
  ) throw new TypeError("Playwright conformance binding requires the managed-engine target");

  const apis = await loadInstalledPackageApis();
  const scenarioId = plan.scenarioId;
  const driverInput = createDriverInput(plan, apis.binding);
  const retainedState = structuredClone(plan.initialState) as Record<string, CanonicalJson>;
  const mutationBindingName = `__dsuiAuthenticatedMutation_${randomBytes(16).toString("hex")}`;
  const mutationCapability = randomBytes(32).toString("hex");
  const committedOperations = new Set<number>();
  const mutationWaiters = new Map<number, () => void>();
  let fixtureActive = true;
  await page.exposeBinding(
    mutationBindingName,
    (source, presentedCapability: unknown, decision: unknown) => {
      if (
        !fixtureActive || presentedCapability !== mutationCapability ||
        source.page !== page || source.frame !== page.mainFrame() ||
        !activeRequest || activeRequest.controls.effect === false
      ) return false;
      const expectedDecision = isRecord(activeRequest.input) && activeRequest.input.decision === "reject"
        ? "rejected"
        : "approved";
      if (decision !== expectedDecision || committedOperations.has(currentOperation)) return false;
      retainedState.decision = expectedDecision;
      retainedState.mutations = Number(retainedState.mutations ?? 0) + 1;
      committedOperations.add(currentOperation);
      mutationWaiters.get(currentOperation)?.();
      mutationWaiters.delete(currentOperation);
      return true;
    },
  );
  const installFixture = async () => {
    await page.setContent(`<!doctype html>
    <html><body>
      <label>Approval <input aria-label="Approval" value=""></label>
      <output role="status">pending</output>
    </body></html>`);
    await page.evaluate(
      ({ bindingName, capability }) => {
        const scope = globalThis as typeof globalThis & Record<string, unknown> & {
          __dsuiConformance?: { input: { decision?: unknown }; effect: boolean };
        };
        const commit = scope[bindingName];
        if (typeof commit !== "function") throw new TypeError("authenticated mutation binding unavailable");
        const fixture = { input: { decision: "approve" }, effect: true };
        scope.__dsuiConformance = fixture;
        document.querySelector("input")?.addEventListener("input", () => {
          if (!fixture.effect) {
            (document.querySelector("input") as HTMLInputElement).value = "";
            return;
          }
          const decision = fixture.input.decision === "reject" ? "rejected" : "approved";
          document.querySelector("output")!.textContent = decision;
          void (commit as (...args: unknown[]) => Promise<unknown>)(capability, decision);
        });
      },
      { bindingName: mutationBindingName, capability: mutationCapability },
    );
  };
  await installFixture();

  const raw: RawDriverResult = { discovery: [], outcomes: [], lifecycle: [] };
  let currentOperation = 0;
  let activeRequest: ScenarioRequest | undefined;
  let replaced = false;
  let operationController: AbortController | undefined;
  let surface!: ReturnType<typeof createPlaywrightSurface>;
  surface = apis.createPlaywrightSurface({
    page,
    surfaceId: `conformance-${scenarioId.toLowerCase()}`,
    allowedOrigins: [
      new URL(page.url()).origin,
      `http://localhost:${new URL(page.url()).port}`,
    ],
    bindings: [{
      id: "approval",
      target: { role: "textbox", name: "Approval" },
      actions: {
        approve: {
          // The managed engine accepts a scalar fill value. The driver maps
          // the canonical object request onto this closed browser operation.
          operation: { type: "fill" },
          risk: "consequential",
          requiresConfirmation: scenarioId === "CONFIRM-01" || scenarioId === "CONFIRM-02",
          ...(["REPLAY-01", "CONFLICT-01", "ORIGIN-01", "PRINCIPAL-01"].includes(scenarioId)
            ? { idempotency: "keyed" as const }
            : {}),
          ...(scenarioId === "PRE-01" || scenarioId === "PRE-02"
            ? { preconditions: ["approval_ready"] }
            : {}),
          effects: ["decision_recorded"],
        },
      },
    }],
    createCorrelationId: () => `case-${scenarioId.toLowerCase()}-${currentOperation}`,
    getPrincipal: () => ({ id: activeRequest?.controls.principalRef ?? "principal-a" }),
    policy: async () => {
      if (!activeRequest) return { outcome: "deny" as const };
      if (scenarioId === "REPLACED-01" && !replaced) {
        replaced = true;
        await page.getByRole("textbox", { name: "Approval", exact: true }).evaluate((input) => {
          const replacement = input.cloneNode(true) as HTMLInputElement;
          replacement.value = "replaced";
          input.replaceWith(replacement);
        });
      }
      return { outcome: activeRequest.controls.policy };
    },
    confirm: () => activeRequest?.controls.confirmation === true,
    checkPrecondition: () => activeRequest?.controls.precondition !== false,
    verifyEffect: async () => {
      if (activeRequest?.controls.effect === false) return false;
      const decisionStatus = isRecord(activeRequest?.input) && activeRequest.input.decision === "reject"
        ? "rejected"
        : "approved";
      const verified = await page.getByRole("status").textContent() === decisionStatus;
      if (verified && !committedOperations.has(currentOperation)) {
        const operation = currentOperation;
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            mutationWaiters.delete(operation);
            reject(new ConformanceValidationError("authenticated_mutation_missing"));
          }, 5_000);
          mutationWaiters.set(operation, () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      }
      // This hook runs only after the real browser mutation and the lifecycle's
      // first post-execution snapshot. Disposal here preserves the committed
      // revision while the adapter still rejects the in-flight operation.
      if (verified && activeRequest?.controls.disposeTiming === "after_start") surface.dispose();
      return verified;
    },
    onAudit(event: AgentAuditEvent) {
      if (event.event === "surface_observed" || currentOperation === 0) return;
      raw.lifecycle.push({
        operation: currentOperation,
        event: event.event,
        outcome: event.outcome,
        sequence: event.sequence,
        revision: event.revision,
        ...(event.action ? { actionRef: event.action } : {}),
      });
      if (event.event === "action_started") {
        if (activeRequest?.controls.cancelTiming === "after_start") operationController?.abort();
      }
    },
  });

  const initialSnapshot = await surface.snapshot();
  const action = initialSnapshot.nodes.find((node) => node.id === "approval")
    ?.actions.find((candidate) => candidate.name === "approve");
  if (!action) throw new ConformanceValidationError("missing_fixture_action");
  raw.discovery.push({
    actionRef: action.name,
    risk: action.risk,
    requiresConfirmation: action.requiresConfirmation === true,
    idempotency: action.idempotency ?? "none",
    inputSchema: INPUT_SCHEMA,
  });

  // The untrusted driver closes over this execution-only port, never Page or
  // the authoritative-state reader. Page evaluation and state access stay in
  // harness-owned closures that are not properties of the driver/port.
  const transport = Object.freeze({
    async configure(request: ScenarioRequest) {
      const requestedDecision = isRecord(request.input) &&
        (typeof request.input.decision === "string" || typeof request.input.decision === "number")
        ? request.input.decision
        : null;
      await page.evaluate((control: { decision: string | number | null; effect: boolean }) => {
        const fixture = (globalThis as typeof globalThis & {
          __dsuiConformance: { input: unknown; effect: boolean };
        }).__dsuiConformance;
        fixture.input = { decision: control.decision };
        fixture.effect = control.effect;
      }, { decision: requestedDecision, effect: request.controls.effect !== false });
    },
    async changeOrigin() {
      const current = new URL(page.url());
      const alternateOrigin = `http://localhost:${current.port}`;
      if (current.origin === alternateOrigin) return;
      await page.goto(`${alternateOrigin}/__health`);
      await installFixture();
    },
    async makeStale() {
      await page.getByRole("textbox", { name: "Approval", exact: true })
        .evaluate((element) => { (element as HTMLInputElement).value = "stale"; });
    },
    perform(
      request: Parameters<typeof surface.performSafe>[0],
      signal: AbortSignal,
    ) {
      return surface.performSafe(request, { signal });
    },
    dispose() { surface.dispose(); },
  });

  const driver: ConformanceDriver = {
    targetId: "playwright-managed",
    family: "playwright",
    tier: "managed-engine",
    async run(input: Readonly<ConformanceDriverInput>, signal: AbortSignal) {
      const requests = requestsFromDriverInput(input, scenarioId, apis.binding);
      if (signal.aborted) throw signal.reason;
      for (const request of requests) {
        currentOperation = request.operation;
        activeRequest = request;
        if (scenarioId === "ORIGIN-01" && request.operation > 1) await transport.changeOrigin();
        await transport.configure(request);

        if (scenarioId === "STALE-01") await transport.makeStale();
        if (request.controls.cancelTiming === "before_start") {
          const controller = new AbortController();
          controller.abort();
          const outcome = await transport.perform({
            surfaceId: initialSnapshot.surfaceId,
            revision: initialSnapshot.revision,
            elementId: request.elementId,
            action: request.action,
            input: isRecord(request.input) ? request.input.decision : undefined,
          }, controller.signal);
          raw.outcomes.push(outcomeRecord(request.operation, outcome));
          continue;
        }
        if (request.controls.disposeTiming === "before_start") transport.dispose();
        const actionRequest = {
          surfaceId: scenarioId === "SURFACE-01" ? "wrong-surface" : initialSnapshot.surfaceId,
          revision: initialSnapshot.revision,
          elementId: request.elementId,
          action: request.action,
          input: isRecord(request.input) ? request.input.decision : undefined,
          ...(request.idempotencyKey === undefined ? {} : { idempotencyKey: request.idempotencyKey }),
        };
        operationController = new AbortController();
        const outcome = await transport.perform(actionRequest, operationController.signal);
        raw.outcomes.push(outcomeRecord(request.operation, outcome));
        operationController = undefined;
      }
      return raw;
    },
  };

  return Object.freeze({
    driver: Object.freeze(driver),
    execution: Object.freeze({
      scenarioId,
      driverInput,
      readAuthoritativeState: async () => {
        return structuredClone(retainedState);
      },
      dispose: () => {
        fixtureActive = false;
        mutationWaiters.clear();
        surface.dispose();
      },
    }),
  });
}
