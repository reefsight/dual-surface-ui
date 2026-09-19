import { isValidAgentAuditIdentifier } from "../audit.js";
import type { AgentAuditEvent, AgentAuditEventName, AgentAuditOutcome } from "../audit.js";
import {
  AgentAuthorizationRequiredError,
  AgentConfirmationRequiredError,
  AgentActionNotFoundError,
  AgentElementNotFoundError,
  AgentIdempotencyConflictError,
  AgentIdempotencyKeyRequiredError,
  AgentInputValidationError,
  AgentInvalidIdempotencyKeyError,
  AgentPreconditionFailedError,
  AgentStaleRevisionError,
  AgentSurfaceMismatchError,
  AgentVerificationFailedError,
  normalizeAgentFailure,
} from "../errors.js";
import { assertIdempotencyKeySyntax, fingerprintActionRequest } from "../idempotency.js";
import { decideAgentAction } from "../policy.js";
import { AGENT_CONTRACT_SCHEMA_VERSION } from "../schema.js";
import type {
  AgentActionOutcome,
  AgentActionRequest,
  AgentActionResult,
  AgentActionSnapshot,
  AgentElementSnapshot,
  AgentJsonValue,
  AgentPolicyRequest,
  AgentPrincipal,
  AgentSnapshot,
  AgentSurfaceOptions,
} from "../types.js";
import { preflightActionSchemas, validateActionInput, validateActionOutput } from "../validation.js";

type MaybePromise<T> = T | Promise<T>;

interface AgentLifecycleContext {
  generation: string;
  origin: string;
  replayGeneration?: string;
}

interface AgentAuditContext {
  action?: string;
  correlationId: string;
  sequence: number;
  startedAt: number;
}

interface AgentReplayRecord {
  actionName: string;
  fingerprint: string;
  generation: string;
  origin: string;
  promise: Promise<AgentActionResult>;
  settled: boolean;
}

export interface ResolvedAgentTarget<TTarget> {
  execute: (input: unknown) => MaybePromise<unknown>;
  isCurrent?: () => MaybePromise<boolean>;
  release?: () => MaybePromise<void>;
  verifyPostExecution?: () => MaybePromise<boolean>;
  target: TTarget;
  verifyDefault?: (context: {
    action: AgentActionSnapshot;
    after: AgentSnapshot;
    before: AgentSnapshot;
    input: unknown;
    request: AgentPolicyRequest;
    target: TTarget;
  }) => MaybePromise<boolean>;
}

export interface AgentLifecycleExecutionOptions {
  signal?: AbortSignal;
}

type SelectedAgentAction<TTarget> = ResolvedAgentTarget<TTarget> & {
  action: AgentActionSnapshot;
  targetSnapshot: AgentElementSnapshot;
};

export interface AgentActionLifecycleBackend<TTarget> {
  /**
   * Captures backend identity/navigation lifetime only. Ordinary semantic state
   * belongs in snapshot revisions so expected action effects do not invalidate
   * their own generation.
   */
  captureContext: () => MaybePromise<AgentLifecycleContext>;
  captureSnapshot: (signal?: AbortSignal) => MaybePromise<AgentSnapshot>;
  lastKnownRevision: () => string;
  resolveTarget: (
    snapshot: AgentSnapshot,
    request: AgentActionRequest,
    targetSnapshot: AgentElementSnapshot,
    action: AgentActionSnapshot,
    signal?: AbortSignal,
  ) => MaybePromise<ResolvedAgentTarget<TTarget>>;
  surfaceId: string;
  settleContext?: () => MaybePromise<void>;
  validateTargetInput?: (
    resolved: ResolvedAgentTarget<TTarget>,
    action: AgentActionSnapshot,
    input: unknown,
  ) => MaybePromise<boolean>;
}

export interface AgentActionLifecycleCoordinatorOptions<TTarget> {
  backend: AgentActionLifecycleBackend<TTarget>;
  hooks: Pick<
    AgentSurfaceOptions,
    | "authorize"
    | "checkPrecondition"
    | "confirm"
    | "createCorrelationId"
    | "getPrincipal"
    | "onAudit"
    | "policy"
    | "verifyEffect"
  >;
  idempotencyCacheSize: number;
}

function cloneActionResult(result: AgentActionResult): AgentActionResult {
  return JSON.parse(JSON.stringify(result)) as AgentActionResult;
}

export class AgentActionLifecycleCoordinator<TTarget> {
  readonly #backend: AgentActionLifecycleBackend<TTarget>;
  readonly #hooks: AgentActionLifecycleCoordinatorOptions<TTarget>["hooks"];
  readonly #idempotencyCacheSize: number;
  readonly #replays = new Map<string, AgentReplayRecord>();
  #emittingAudit = false;
  #nextCorrelationId = 1;

  constructor(options: AgentActionLifecycleCoordinatorOptions<TTarget>) {
    this.#backend = options.backend;
    this.#hooks = options.hooks;
    this.#idempotencyCacheSize = options.idempotencyCacheSize;
  }

  observe(snapshot: AgentSnapshot): void {
    const audit = this.#newAuditContext();
    this.#emitAudit(audit, "surface_observed", "observed", snapshot.revision);
  }

  async perform(
    request: AgentActionRequest,
    options: AgentLifecycleExecutionOptions = {},
  ): Promise<AgentActionResult> {
    const audit = this.#newAuditContext();
    try {
      this.#assertNotAborted(options.signal);
      return await this.#performRequest(request, audit, options.signal);
    } catch (error) {
      if (audit) {
        let revision = this.#backend.lastKnownRevision();
        if (!options.signal?.aborted) {
          try {
            revision = (await this.#captureSnapshot(options.signal)).revision;
          } catch {
            // Failure audit remains available when observation fails.
          }
        }
        this.#emitAudit(audit, "action_failed", normalizeAgentFailure(error).code, revision);
      }
      throw error;
    }
  }

  async performSafe(
    request: AgentActionRequest,
    options: AgentLifecycleExecutionOptions = {},
  ): Promise<AgentActionOutcome> {
    try {
      return await this.perform(request, options);
    } catch (error) {
      let revision = this.#backend.lastKnownRevision();
      if (!options.signal?.aborted) {
        try {
          revision = (await this.#captureSnapshot(options.signal)).revision;
        } catch {
          // Failure normalization remains available when observation fails.
        }
      }
      return {
        schemaVersion: AGENT_CONTRACT_SCHEMA_VERSION,
        surfaceId: this.#backend.surfaceId,
        revision,
        status: "failed",
        error: normalizeAgentFailure(error),
      };
    }
  }

  async #performRequest(
    request: AgentActionRequest,
    audit: AgentAuditContext | undefined,
    signal: AbortSignal | undefined,
  ): Promise<AgentActionResult> {
    if (request.surfaceId !== this.#backend.surfaceId) {
      throw new AgentSurfaceMismatchError(
        `Action surface "${request.surfaceId}" does not match "${this.#backend.surfaceId}"`,
      );
    }
    if (request.idempotencyKey !== undefined) assertIdempotencyKeySyntax(request.idempotencyKey);

    const context = await this.#captureContext();
    const { generation, origin } = context;
    const replayScope = request.idempotencyKey ? this.#replayScope(request) : undefined;
    const replay = replayScope ? this.#replays.get(replayScope) : undefined;
    if (replay) {
      await this.#assertContext(context, request, signal);
      if (
        replay.generation !== this.#replayGeneration(context) ||
        replay.origin !== origin
      ) {
        throw await this.#staleRevision(request);
      }
      if (audit) audit.action = replay.actionName;
      this.#emitAudit(
        audit,
        "action_requested",
        "requested",
        this.#backend.lastKnownRevision(),
      );
      const principal = await this.#hooks.getPrincipal?.();
      await this.#assertContext(context, request, signal);
      const result = await this.#resolveReplay(replay, request, principal, origin);
      this.#emitAudit(audit, "action_verified", "replayed", result.revision);
      return result;
    }

    const before = await this.#captureSnapshot(signal);
    this.#assertNotAborted(signal);
    this.#assertSnapshotOrigin(context.origin, before.url);
    if (request.revision !== before.revision) {
      throw new AgentStaleRevisionError(
        `Action revision "${request.revision}" is stale; current revision is "${before.revision}"`,
      );
    }
    const targetSnapshot = before.nodes.find(
      (node) => node.id === request.elementId,
    );
    if (!targetSnapshot) {
      throw new AgentElementNotFoundError(
        `No element found for id "${request.elementId}"`,
      );
    }
    const action = targetSnapshot.actions.find(
      (candidate) => candidate.name === request.action,
    );
    if (!action) {
      throw new AgentActionNotFoundError(
        `Action "${request.action}" is not available on "${request.elementId}"`,
      );
    }
    const resolvedTarget = await this.#backend.resolveTarget(
      before,
      request,
      targetSnapshot,
      action,
      signal,
    );
    const resolved: SelectedAgentAction<TTarget> = {
      ...resolvedTarget,
      action,
      targetSnapshot,
    };
    try {
      this.#assertNotAborted(signal);
      if (audit) audit.action = action.name;
      this.#emitAudit(audit, "action_requested", "requested", before.revision);
      preflightActionSchemas(resolved.action);
      validateActionInput(resolved.action, request.input);
      if (this.#backend.validateTargetInput && !(await this.#backend.validateTargetInput(resolved, action, request.input))) {
        throw new AgentInputValidationError(resolved.action.name);
      }
      this.#assertIdempotencyPolicy(resolved.action, request.idempotencyKey);
      const principal = await this.#hooks.getPrincipal?.();
      this.#assertNotAborted(signal);
      if (resolved.action.idempotency === "keyed") {
      const fingerprint = await fingerprintActionRequest(request, principal, origin);
      const scope = replayScope!;
      let concurrent = this.#replays.get(scope);
      if (concurrent) {
        await this.#assertReplayContext(context, request, signal);
        return this.#joinConcurrent(
          concurrent,
          fingerprint,
          context,
          request,
          audit,
        );
      }
      await this.#assertContext(context, request, signal);
      concurrent = this.#replays.get(scope);
      if (concurrent) {
        return this.#joinConcurrent(
          concurrent,
          fingerprint,
          context,
          request,
          audit,
        );
      }

      let actionStarted = false;
      const execution = this.#performOnce(
        request,
        before,
        resolved,
        principal,
        context,
        audit,
        signal,
        () => { actionStarted = true; },
      ).then(cloneActionResult);
      const record: AgentReplayRecord = {
        actionName: resolved.action.name,
        fingerprint,
        generation: this.#replayGeneration(context),
        origin,
        promise: execution,
        settled: false,
      };
      this.#replays.set(scope, record);
      void execution.then(
        () => { record.settled = true; this.#pruneReplayCache(); },
        () => {
          if (actionStarted) { record.settled = true; this.#pruneReplayCache(); }
          else if (this.#replays.get(scope) === record) this.#replays.delete(scope);
        },
      );
        return cloneActionResult(await execution);
      }

      await this.#assertContext(context, request, signal);
      return await this.#performOnce(request, before, resolved, principal, context, audit, signal);
    } finally {
      try { await resolved.release?.(); } catch { /* Resource cleanup cannot change the action outcome. */ }
    }
  }

  async #joinConcurrent(
    record: AgentReplayRecord,
    fingerprint: string,
    context: AgentLifecycleContext,
    request: AgentActionRequest,
    audit: AgentAuditContext | undefined,
  ): Promise<AgentActionResult> {
    if (
      record.generation !== this.#replayGeneration(context) ||
      record.origin !== context.origin
    ) {
      throw await this.#staleRevision(request);
    }
    if (record.fingerprint !== fingerprint) {
      throw new AgentIdempotencyConflictError();
    }
    const result = cloneActionResult(await record.promise);
    this.#emitAudit(audit, "action_verified", "replayed", result.revision);
    return result;
  }

  async #performOnce(
    request: AgentActionRequest,
    before: AgentSnapshot,
    resolved: SelectedAgentAction<TTarget>,
    principal: AgentPrincipal | undefined,
    context: AgentLifecycleContext,
    audit: AgentAuditContext | undefined,
    signal?: AbortSignal,
    onActionStarted?: () => void,
  ): Promise<AgentActionResult> {
    const policyRequest: AgentPolicyRequest = {
      ...request,
      risk: resolved.action.risk,
      element: resolved.targetSnapshot,
      origin: context.origin,
      ...(principal ? { principal } : {}),
    };
    const decision = await decideAgentAction(policyRequest, this.#hooks.policy, this.#hooks.authorize);
    this.#emitAudit(audit, "policy_decided", decision.outcome, before.revision);
    if (decision.outcome === "deny") {
      throw new AgentAuthorizationRequiredError(`Action "${request.action}" requires authorization`);
    }
    await this.#assertContext(context, request, signal);

    if (resolved.action.requiresConfirmation === true || decision.outcome === "require_confirmation") {
      this.#emitAudit(audit, "confirmation_requested", "requested", before.revision);
      const confirmed = await this.#hooks.confirm?.({ ...policyRequest, decision });
      if (!confirmed) throw new AgentConfirmationRequiredError(request.action);
      await this.#assertContext(context, request, signal);
    }

    const current = await this.#captureSnapshot(signal);
    this.#assertRevision(request, before, current);
    await this.#checkPreconditions(
      resolved.action,
      policyRequest,
      current,
      before,
      context,
      request,
      signal,
    );
    const ready = await this.#captureSnapshot(signal);
    this.#assertRevision(request, before, ready);
    if (resolved.action.effects?.length && !this.#hooks.verifyEffect) {
      throw new AgentVerificationFailedError(resolved.action.name);
    }
    if (resolved.action.risk !== "read" && !resolved.action.effects?.length && !resolved.verifyDefault) {
      throw new AgentVerificationFailedError(resolved.action.name);
    }

    await this.#assertContext(context, request, signal);
    if (resolved.isCurrent && !(await resolved.isCurrent())) {
      throw await this.#staleRevision(request);
    }
    this.#assertNotAborted(signal);
    await this.#assertContext(context, request, signal);
    this.#assertNotAborted(signal);
    onActionStarted?.();
    let execution: MaybePromise<unknown>;
    try {
      execution = resolved.execute(request.input);
    } finally {
      this.#emitAudit(audit, "action_started", "started", ready.revision);
    }
    const rawOutput = await execution;
    await this.#backend.settleContext?.();
    await this.#assertPostExecution(resolved);
    let output: AgentJsonValue | undefined;
    let outputError: unknown;
    if (resolved.action.outputSchema) {
      try { output = validateActionOutput(resolved.action, rawOutput); }
      catch (error) { outputError = error; }
    }

    let after = await this.#captureSnapshot();
    await this.#verifyAction(
      resolved,
      policyRequest,
      ready,
      after,
      request.input,
    );
    await this.#backend.settleContext?.();
    await this.#assertPostExecution(resolved);
    if (outputError) throw outputError;
    after = await this.#captureSnapshot();
    await this.#backend.settleContext?.();
    await this.#assertPostExecution(resolved);
    const node = after.nodes.find((item) => item.id === request.elementId);
    const result: AgentActionResult = {
      schemaVersion: AGENT_CONTRACT_SCHEMA_VERSION,
      surfaceId: this.#backend.surfaceId,
      previousRevision: before.revision,
      revision: after.revision,
      status: "succeeded",
      action: request.action,
      targetId: request.elementId,
      targetPresent: !!node,
      ...(node ? { node } : {}),
      ...(output !== undefined ? { output } : {}),
    };
    this.#emitAudit(audit, "action_verified", "succeeded", result.revision);
    return result;
  }

  async #assertPostExecution(resolved: SelectedAgentAction<TTarget>): Promise<void> {
    if (
      resolved.verifyPostExecution &&
      !(await resolved.verifyPostExecution())
    ) {
      throw new AgentVerificationFailedError(resolved.action.name);
    }
  }

  async #checkPreconditions(
    action: AgentActionSnapshot,
    request: AgentPolicyRequest,
    snapshot: AgentSnapshot,
    expected: AgentSnapshot,
    context: AgentLifecycleContext,
    actionRequest: AgentActionRequest,
    signal?: AbortSignal,
  ): Promise<void> {
    for (const precondition of action.preconditions ?? []) {
      let satisfied = false;
      try {
        satisfied = (await this.#hooks.checkPrecondition?.({ ...request, precondition, snapshot })) === true;
      } catch { satisfied = false; }
      if (!satisfied) throw new AgentPreconditionFailedError(action.name);
      await this.#assertContext(context, actionRequest, signal);
      const observed = await this.#captureSnapshot(signal);
      this.#assertRevision(actionRequest, expected, observed);
    }
  }

  async #verifyAction(
    resolved: SelectedAgentAction<TTarget>,
    request: AgentPolicyRequest,
    before: AgentSnapshot,
    after: AgentSnapshot,
    input: unknown,
  ): Promise<void> {
    if (resolved.action.effects?.length) {
      for (const effect of resolved.action.effects) {
        let verified = false;
        try {
          verified = (await this.#hooks.verifyEffect?.({ ...request, effect, before, after })) === true;
        } catch { verified = false; }
        if (!verified) throw new AgentVerificationFailedError(resolved.action.name);
      }
      return;
    }
    if (resolved.action.risk === "read") return;
    let verified = false;
    try {
      verified = (await resolved.verifyDefault?.({
        action: resolved.action,
        after,
        before,
        input,
        request,
        target: resolved.target,
      })) === true;
    } catch { verified = false; }
    if (!verified) throw new AgentVerificationFailedError(resolved.action.name);
  }

  async #assertContext(
    expected: AgentLifecycleContext,
    request: AgentActionRequest,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.#backend.settleContext?.();
    const current = await this.#captureContext();
    if (
      current.generation !== expected.generation ||
      current.origin !== expected.origin
    ) {
      throw await this.#staleRevision(request);
    }
    this.#assertNotAborted(signal);
  }

  #assertNotAborted(signal: AbortSignal | undefined): void {
    if (!signal?.aborted) return;
    const error = new Error("The action was aborted before execution");
    error.name = "AbortError";
    throw error;
  }

  async #assertReplayContext(
    expected: AgentLifecycleContext,
    request: AgentActionRequest,
    signal?: AbortSignal,
  ): Promise<void> {
    const current = await this.#captureContext();
    if (
      this.#replayGeneration(current) !== this.#replayGeneration(expected) ||
      current.origin !== expected.origin
    ) {
      throw await this.#staleRevision(request);
    }
    this.#assertNotAborted(signal);
  }

  async #captureContext(): Promise<AgentLifecycleContext> {
    const captured = await this.#backend.captureContext();
    return Object.freeze({
      generation: captured.generation,
      origin: captured.origin,
      ...(captured.replayGeneration !== undefined
        ? { replayGeneration: captured.replayGeneration }
        : {}),
    });
  }

  #replayGeneration(context: AgentLifecycleContext): string {
    return context.replayGeneration ?? context.generation;
  }

  #assertSnapshotOrigin(origin: string, url: string): void {
    let snapshotOrigin: string;
    try {
      snapshotOrigin = new URL(url).origin;
    } catch {
      throw new AgentSurfaceMismatchError(
        "Snapshot URL cannot be bound to the backend origin",
      );
    }
    if (snapshotOrigin !== origin) {
      throw new AgentSurfaceMismatchError(
        "Snapshot URL does not match the backend origin",
      );
    }
  }

  #assertRevision(request: AgentActionRequest, before: AgentSnapshot, current: AgentSnapshot): void {
    if (current.revision !== before.revision) {
      throw new AgentStaleRevisionError(
        `Action revision "${request.revision}" is stale; current revision is "${current.revision}"`,
      );
    }
  }

  async #captureSnapshot(signal?: AbortSignal): Promise<AgentSnapshot> {
    this.#assertNotAborted(signal);
    const snapshot = await this.#backend.captureSnapshot(signal);
    this.#assertNotAborted(signal);
    if (snapshot.surfaceId !== this.#backend.surfaceId) {
      throw new AgentSurfaceMismatchError(
        `Snapshot surface "${snapshot.surfaceId}" does not match "${this.#backend.surfaceId}"`,
      );
    }
    return snapshot;
  }

  async #staleRevision(request: AgentActionRequest): Promise<Error> {
    const current = await this.#captureSnapshot();
    return new AgentStaleRevisionError(
      `Action revision "${request.revision}" is stale; current revision is "${current.revision}"`,
    );
  }

  #assertIdempotencyPolicy(action: AgentActionSnapshot, key: string | undefined): void {
    const policy = action.idempotency ?? "none";
    if (policy === "keyed") {
      if (!key) throw new AgentIdempotencyKeyRequiredError(action.name);
      return;
    }
    if (key !== undefined) throw new AgentInvalidIdempotencyKeyError();
  }

  #replayScope(request: AgentActionRequest): string {
    return [request.surfaceId, request.elementId, request.action, request.idempotencyKey].join("\u0000");
  }

  async #resolveReplay(
    record: AgentReplayRecord,
    request: AgentActionRequest,
    principal: AgentPrincipal | undefined,
    origin: string,
  ): Promise<AgentActionResult> {
    const fingerprint = await fingerprintActionRequest(request, principal, origin);
    if (fingerprint !== record.fingerprint) throw new AgentIdempotencyConflictError();
    return cloneActionResult(await record.promise);
  }

  #pruneReplayCache(): void {
    if (this.#replays.size <= this.#idempotencyCacheSize) return;
    for (const [scope, record] of this.#replays) {
      if (record.settled) this.#replays.delete(scope);
      if (this.#replays.size <= this.#idempotencyCacheSize) break;
    }
  }

  #newAuditContext(): AgentAuditContext | undefined {
    if (!this.#hooks.onAudit || this.#emittingAudit) return undefined;
    return { correlationId: this.#newCorrelationId(), sequence: 0, startedAt: this.#monotonicNow() };
  }

  #newCorrelationId(): string {
    try {
      const candidate = this.#hooks.createCorrelationId?.() ?? globalThis.crypto?.randomUUID?.();
      if (isValidAgentAuditIdentifier(candidate)) return candidate;
    } catch {
      // A trusted factory cannot make execution fail.
    }
    return `audit-${this.#nextCorrelationId++}`;
  }

  #monotonicNow(): number {
    try {
      const value = globalThis.performance?.now();
      if (Number.isFinite(value)) return value;
    } catch {
      // Fall through to coarse clock.
    }
    return Date.now();
  }

  #emitAudit(
    context: AgentAuditContext | undefined,
    eventName: AgentAuditEventName,
    outcome: AgentAuditOutcome,
    revision: string,
  ): void {
    if (!context || !this.#hooks.onAudit || this.#emittingAudit) return;
    try {
      const elapsed = this.#monotonicNow() - context.startedAt;
      const event: AgentAuditEvent = Object.freeze({
        schemaVersion: AGENT_CONTRACT_SCHEMA_VERSION,
        event: eventName,
        correlationId: context.correlationId,
        surfaceId: this.#backend.surfaceId,
        revision,
        sequence: ++context.sequence,
        timestamp: new Date().toISOString(),
        durationMs: Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0,
        outcome,
        ...(context.action ? { action: context.action } : {}),
      });
      this.#emittingAudit = true;
      try {
        const result = this.#hooks.onAudit(event);
        void Promise.resolve(result).catch(() => undefined);
      } finally { this.#emittingAudit = false; }
    } catch { this.#emittingAudit = false; }
  }
}
