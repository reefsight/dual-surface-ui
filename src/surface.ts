import {
  accessibleNameOf,
  boundsOf,
  inferredActions,
  isEffectivelyDisabled,
  isSemanticCandidate,
  isValidNativeActionInput,
  roleOf,
  runNativeAction,
  stateOf,
} from "./dom.js";
import { isValidAgentAuditIdentifier } from "./audit.js";
import {
  AgentActionNotFoundError,
  AgentAuthorizationRequiredError,
  AgentConfirmationRequiredError,
  AgentDuplicateElementIdError,
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
} from "./errors.js";
import {
  assertIdempotencyKeySyntax,
  fingerprintActionRequest,
} from "./idempotency.js";
import { decideAgentAction } from "./policy.js";
import { AGENT_CONTRACT_SCHEMA_VERSION } from "./schema.js";
import type {
  AgentAuditEvent,
  AgentAuditEventName,
  AgentAuditOutcome,
} from "./audit.js";
import type {
  AgentActionRequest,
  AgentActionOutcome,
  AgentActionResult,
  AgentActionSnapshot,
  AgentElementDefinition,
  AgentElementSnapshot,
  AgentJsonValue,
  AgentPrincipal,
  AgentPolicyRequest,
  AgentSnapshot,
  AgentSurfaceOptions,
} from "./types.js";
import {
  validateActionInput,
  validateActionOutput,
} from "./validation.js";

interface AgentReplayRecord {
  actionName: string;
  fingerprint: string;
  promise: Promise<AgentActionResult>;
  settled: boolean;
}

interface AgentAuditContext {
  action?: string;
  correlationId: string;
  sequence: number;
  startedAt: number;
}

function cloneActionResult(result: AgentActionResult): AgentActionResult {
  return JSON.parse(JSON.stringify(result)) as AgentActionResult;
}

export class AgentSurface {
  readonly #root: ParentNode;
  readonly #surfaceId: string;
  readonly #authorize: AgentSurfaceOptions["authorize"];
  readonly #checkPrecondition: AgentSurfaceOptions["checkPrecondition"];
  readonly #confirm: AgentSurfaceOptions["confirm"];
  readonly #getPrincipal: AgentSurfaceOptions["getPrincipal"];
  readonly #idempotencyCacheSize: number;
  readonly #createCorrelationId: AgentSurfaceOptions["createCorrelationId"];
  readonly #onAudit: AgentSurfaceOptions["onAudit"];
  readonly #policy: AgentSurfaceOptions["policy"];
  readonly #verifyEffect: AgentSurfaceOptions["verifyEffect"];
  readonly #definitions = new WeakMap<Element, AgentElementDefinition>();
  readonly #elementsById = new Map<string, Element>();
  readonly #generatedIds = new WeakMap<Element, string>();
  readonly #replays = new Map<string, AgentReplayRecord>();
  #nextId = 1;
  #nextCorrelationId = 1;
  #revision = 0;
  #semanticSignature: string | undefined;
  #emittingAudit = false;

  constructor(options: AgentSurfaceOptions = {}) {
    const root = options.root ?? globalThis.document;
    if (!root) throw new Error("AgentSurface requires a DOM root");
    this.#root = root;
    this.#surfaceId = options.surfaceId ?? this.#defaultSurfaceId();
    if (options.onAudit && !isValidAgentAuditIdentifier(this.#surfaceId)) {
      throw new RangeError(
        "onAudit requires an opaque URL-safe surfaceId of 1-128 characters",
      );
    }
    this.#authorize = options.authorize;
    this.#checkPrecondition = options.checkPrecondition;
    this.#confirm = options.confirm;
    this.#createCorrelationId = options.createCorrelationId;
    this.#getPrincipal = options.getPrincipal;
    this.#idempotencyCacheSize = options.idempotencyCacheSize ?? 256;
    if (
      !Number.isInteger(this.#idempotencyCacheSize) ||
      this.#idempotencyCacheSize < 1
    ) {
      throw new RangeError("idempotencyCacheSize must be a positive integer");
    }
    this.#policy = options.policy;
    this.#onAudit = options.onAudit;
    this.#verifyEffect = options.verifyEffect;
  }

  register(element: Element, definition: AgentElementDefinition): () => void {
    const existing = this.#elementsById.get(definition.id);
    if (existing && existing !== element) {
      throw new Error(`Duplicate agent element id: ${definition.id}`);
    }

    this.#definitions.set(element, definition);
    this.#elementsById.set(definition.id, element);
    element.setAttribute("data-agent-id", definition.id);

    return () => {
      this.#definitions.delete(element);
      this.#elementsById.delete(definition.id);
      if (element.getAttribute("data-agent-id") === definition.id) {
        element.removeAttribute("data-agent-id");
      }
    };
  }

  snapshot(): AgentSnapshot {
    const snapshot = this.#captureSnapshot();
    const audit = this.#newAuditContext();
    this.#emitAudit(
      audit,
      "surface_observed",
      "observed",
      snapshot.revision,
    );
    return snapshot;
  }

  #captureSnapshot(): AgentSnapshot {
    const document = this.#document();
    const nodes = this.#snapshotNodes();
    this.#refreshRevision(nodes);
    const focusedElement = document.activeElement;
    const focusedElementId =
      focusedElement instanceof Element
        ? this.#idFor(focusedElement)
        : undefined;

    return {
      schemaVersion: AGENT_CONTRACT_SCHEMA_VERSION,
      surfaceId: this.#surfaceId,
      revision: String(this.#revision),
      title: document.title,
      url: document.location?.href ?? "",
      generatedAt: new Date().toISOString(),
      ...(focusedElementId ? { focusedElementId } : {}),
      capabilities: ["snapshot", "perform"],
      nodes,
    };
  }

  async perform(request: AgentActionRequest): Promise<AgentActionResult> {
    const audit = this.#newAuditContext();
    try {
      return await this.#performRequest(request, audit);
    } catch (error) {
      if (audit) {
        let revision = String(this.#revision);
        try {
          revision = this.#captureSnapshot().revision;
        } catch {
          // Audit failure reporting uses the last safely observed revision.
        }
        this.#emitAudit(
          audit,
          "action_failed",
          normalizeAgentFailure(error).code,
          revision,
        );
      }
      throw error;
    }
  }

  async #performRequest(
    request: AgentActionRequest,
    audit: AgentAuditContext | undefined,
  ): Promise<AgentActionResult> {
    if (request.surfaceId !== this.#surfaceId) {
      throw new AgentSurfaceMismatchError(
        `Action surface "${request.surfaceId}" does not match "${this.#surfaceId}"`,
      );
    }
    if (request.idempotencyKey !== undefined) {
      assertIdempotencyKeySyntax(request.idempotencyKey);
    }

    const origin = this.#document().location?.origin ?? "null";
    const replayScope = request.idempotencyKey
      ? this.#replayScope(request)
      : undefined;
    const replay = replayScope ? this.#replays.get(replayScope) : undefined;
    if (replay) {
      if (audit) audit.action = replay.actionName;
      this.#emitAudit(
        audit,
        "action_requested",
        "requested",
        String(this.#revision),
      );
      const principal = await this.#getPrincipal?.();
      const result = await this.#resolveReplay(
        replay,
        request,
        principal,
        origin,
      );
      this.#emitAudit(
        audit,
        "action_verified",
        "replayed",
        result.revision,
      );
      return result;
    }

    const before = this.#captureSnapshot();
    if (request.revision !== before.revision) {
      throw new AgentStaleRevisionError(
        `Action revision "${request.revision}" is stale; current revision is "${before.revision}"`,
      );
    }

    const element = this.#findElement(request.elementId);
    const snapshot = this.#snapshotElement(element);
    const action = snapshot.actions.find((item) => item.name === request.action);
    if (!action) {
      throw new AgentActionNotFoundError(
        `Action "${request.action}" is not available on "${request.elementId}"`,
      );
    }

    if (audit) audit.action = action.name;
    this.#emitAudit(
      audit,
      "action_requested",
      "requested",
      before.revision,
    );

    validateActionInput(action, request.input);
    if (!isValidNativeActionInput(element, action.name, request.input)) {
      throw new AgentInputValidationError(action.name);
    }
    this.#assertIdempotencyPolicy(action, request.idempotencyKey);

    const principal = await this.#getPrincipal?.();
    if (action.idempotency === "keyed") {
      const fingerprint = await fingerprintActionRequest(
        request,
        principal,
        origin,
      );
      const scope = replayScope!;
      const concurrent = this.#replays.get(scope);
      if (concurrent) {
        if (concurrent.fingerprint !== fingerprint) {
          throw new AgentIdempotencyConflictError();
        }
        const result = cloneActionResult(await concurrent.promise);
        this.#emitAudit(
          audit,
          "action_verified",
          "replayed",
          result.revision,
        );
        return result;
      }

      const execution = this.#performOnce(
        request,
        before,
        element,
        snapshot,
        action,
        principal,
        origin,
        audit,
      ).then(cloneActionResult);
      const record: AgentReplayRecord = {
        actionName: action.name,
        fingerprint,
        promise: execution,
        settled: false,
      };
      this.#replays.set(scope, record);
      void execution.then(
        () => {
          record.settled = true;
          this.#pruneReplayCache();
        },
        () => {
          if (this.#replays.get(scope) === record) this.#replays.delete(scope);
        },
      );
      return cloneActionResult(await execution);
    }

    return this.#performOnce(
      request,
      before,
      element,
      snapshot,
      action,
      principal,
      origin,
      audit,
    );
  }

  async performSafe(request: AgentActionRequest): Promise<AgentActionOutcome> {
    try {
      return await this.perform(request);
    } catch (error) {
      let revision = String(this.#revision);
      try {
        revision = this.#captureSnapshot().revision;
      } catch {
        // Failure normalization must still succeed when observation fails.
      }
      return {
        schemaVersion: AGENT_CONTRACT_SCHEMA_VERSION,
        surfaceId: this.#surfaceId,
        revision,
        status: "failed",
        error: normalizeAgentFailure(error),
      };
    }
  }

  async #performOnce(
    request: AgentActionRequest,
    before: AgentSnapshot,
    element: Element,
    elementSnapshot: AgentElementSnapshot,
    action: AgentActionSnapshot,
    principal: AgentPrincipal | undefined,
    origin: string,
    audit: AgentAuditContext | undefined,
  ): Promise<AgentActionResult> {
    const policyRequest = {
      ...request,
      risk: action.risk,
      element: elementSnapshot,
      origin,
      ...(principal ? { principal } : {}),
    };
    const decision = await decideAgentAction(
      policyRequest,
      this.#policy,
      this.#authorize,
    );
    this.#emitAudit(
      audit,
      "policy_decided",
      decision.outcome,
      before.revision,
    );
    if (decision.outcome === "deny") {
      throw new AgentAuthorizationRequiredError(
        `Action "${request.action}" requires authorization`,
      );
    }

    if (
      action.requiresConfirmation === true ||
      decision.outcome === "require_confirmation"
    ) {
      this.#emitAudit(
        audit,
        "confirmation_requested",
        "requested",
        before.revision,
      );
      const confirmed = await this.#confirm?.({
        ...policyRequest,
        decision,
      });
      if (!confirmed) {
        throw new AgentConfirmationRequiredError(request.action);
      }
    }

    const current = this.#captureSnapshot();
    if (current.revision !== before.revision) {
      throw new AgentStaleRevisionError(
        `Action revision "${request.revision}" is stale; current revision is "${current.revision}"`,
      );
    }

    await this.#checkActionPreconditions(action, policyRequest, current);
    const ready = this.#captureSnapshot();
    if (ready.revision !== before.revision) {
      throw new AgentStaleRevisionError(
        `Action revision "${request.revision}" is stale; current revision is "${ready.revision}"`,
      );
    }

    const customHandler =
      this.#definitions.get(element)?.actions?.[request.action]?.handler;
    this.#assertVerificationAvailable(action, customHandler !== undefined);
    this.#emitAudit(
      audit,
      "action_started",
      "started",
      ready.revision,
    );
    let handlerOutput: unknown;
    if (customHandler) {
      handlerOutput = await customHandler(request.input, element);
    } else {
      runNativeAction(element, request.action, request.input);
    }

    let output: AgentJsonValue | undefined;
    let outputError: unknown;
    if (action.outputSchema) {
      try {
        output = validateActionOutput(action, handlerOutput);
      } catch (error) {
        outputError = error;
      }
    }

    let after = this.#captureSnapshot();
    await this.#verifyAction(
      action,
      policyRequest,
      ready,
      after,
      customHandler !== undefined,
      request.input,
    );
    if (outputError) throw outputError;
    after = this.#captureSnapshot();
    const node = after.nodes.find((item) => item.id === request.elementId);
    const result: AgentActionResult = {
      schemaVersion: AGENT_CONTRACT_SCHEMA_VERSION,
      surfaceId: this.#surfaceId,
      previousRevision: before.revision,
      revision: after.revision,
      status: "succeeded",
      action: request.action,
      targetId: request.elementId,
      targetPresent: !!node,
      ...(node ? { node } : {}),
      ...(output !== undefined ? { output } : {}),
    };
    this.#emitAudit(
      audit,
      "action_verified",
      "succeeded",
      result.revision,
    );
    return result;
  }

  #assertIdempotencyPolicy(
    action: AgentActionSnapshot,
    key: string | undefined,
  ): void {
    const policy = action.idempotency ?? "none";
    if (policy === "keyed") {
      if (!key) throw new AgentIdempotencyKeyRequiredError(action.name);
      return;
    }
    if (key !== undefined) throw new AgentInvalidIdempotencyKeyError();
  }

  #replayScope(request: AgentActionRequest): string {
    return [
      request.surfaceId,
      request.elementId,
      request.action,
      request.idempotencyKey,
    ].join("\u0000");
  }

  async #resolveReplay(
    record: AgentReplayRecord,
    request: AgentActionRequest,
    principal: AgentPrincipal | undefined,
    origin: string,
  ): Promise<AgentActionResult> {
    const fingerprint = await fingerprintActionRequest(
      request,
      principal,
      origin,
    );
    if (fingerprint !== record.fingerprint) {
      throw new AgentIdempotencyConflictError();
    }
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
    if (!this.#onAudit || this.#emittingAudit) return undefined;
    return {
      correlationId: this.#newCorrelationId(),
      sequence: 0,
      startedAt: this.#monotonicNow(),
    };
  }

  #newCorrelationId(): string {
    try {
      const candidate =
        this.#createCorrelationId?.() ?? globalThis.crypto?.randomUUID?.();
      if (isValidAgentAuditIdentifier(candidate)) return candidate;
    } catch {
      // A trusted factory cannot make observation or execution fail.
    }
    return `audit-${this.#nextCorrelationId++}`;
  }

  #monotonicNow(): number {
    try {
      const value = globalThis.performance?.now();
      if (Number.isFinite(value)) return value;
    } catch {
      // Fall back to a coarse clock when the platform clock is unavailable.
    }
    return Date.now();
  }

  #emitAudit(
    context: AgentAuditContext | undefined,
    eventName: AgentAuditEventName,
    outcome: AgentAuditOutcome,
    revision: string,
  ): void {
    if (!context || !this.#onAudit || this.#emittingAudit) return;

    try {
      const elapsed = this.#monotonicNow() - context.startedAt;
      const event: AgentAuditEvent = Object.freeze({
        schemaVersion: AGENT_CONTRACT_SCHEMA_VERSION,
        event: eventName,
        correlationId: context.correlationId,
        surfaceId: this.#surfaceId,
        revision,
        sequence: ++context.sequence,
        timestamp: new Date().toISOString(),
        durationMs: Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0,
        outcome,
        ...(context.action ? { action: context.action } : {}),
      });

      this.#emittingAudit = true;
      try {
        const result = this.#onAudit(event);
        void Promise.resolve(result).catch(() => undefined);
      } finally {
        this.#emittingAudit = false;
      }
    } catch {
      this.#emittingAudit = false;
    }
  }

  #defaultSurfaceId(): string {
    const document = this.#document();
    return document.location?.href || "document";
  }

  async #checkActionPreconditions(
    action: AgentActionSnapshot,
    request: AgentPolicyRequest,
    snapshot: AgentSnapshot,
  ): Promise<void> {
    for (const precondition of action.preconditions ?? []) {
      let satisfied = false;
      try {
        satisfied =
          (await this.#checkPrecondition?.({
            ...request,
            precondition,
            snapshot,
          })) === true;
      } catch {
        satisfied = false;
      }
      if (!satisfied) {
        throw new AgentPreconditionFailedError(action.name);
      }
    }
  }

  async #verifyAction(
    action: AgentActionSnapshot,
    request: AgentPolicyRequest,
    before: AgentSnapshot,
    after: AgentSnapshot,
    custom: boolean,
    input: unknown,
  ): Promise<void> {
    if (action.effects?.length) {
      for (const effect of action.effects) {
        let verified = false;
        try {
          verified =
            (await this.#verifyEffect?.({
              ...request,
              effect,
              before,
              after,
            })) === true;
        } catch {
          verified = false;
        }
        if (!verified) throw new AgentVerificationFailedError(action.name);
      }
      return;
    }

    if (action.risk === "read") return;
    if (custom) throw new AgentVerificationFailedError(action.name);

    const previousNode = before.nodes.find(
      (item) => item.id === request.elementId,
    );
    const nextNode = after.nodes.find((item) => item.id === request.elementId);
    if (action.name === "set_value" && typeof input === "string" && nextNode) {
      const verified = nextNode.state.sensitive
        ? nextNode.state.valuePresent === (input.length > 0)
        : nextNode.state.value === input;
      if (verified) return;
    } else if (
      action.name === "select" &&
      typeof input === "string" &&
      nextNode
    ) {
      const target = this.#elementsById.get(request.elementId);
      if (target instanceof HTMLSelectElement && target.value === input) return;
    } else if (
      action.name === "toggle" &&
      previousNode?.state.checked !== undefined &&
      nextNode?.state.checked === !previousNode.state.checked
    ) {
      return;
    } else if (
      (action.name === "click" || action.name === "submit") &&
      after.revision !== before.revision
    ) {
      return;
    }

    throw new AgentVerificationFailedError(action.name);
  }

  #assertVerificationAvailable(
    action: AgentActionSnapshot,
    custom: boolean,
  ): void {
    if (action.effects?.length) {
      if (!this.#verifyEffect) {
        throw new AgentVerificationFailedError(action.name);
      }
      return;
    }
    if (action.risk === "read") return;
    if (custom) throw new AgentVerificationFailedError(action.name);
  }

  #document(): Document {
    if (this.#root instanceof Document) return this.#root;
    return this.#root.ownerDocument ?? document;
  }

  #allElements(): Element[] {
    const descendants = Array.from(this.#root.querySelectorAll("*"));
    return this.#root instanceof Element
      ? [this.#root, ...descendants]
      : descendants;
  }

  #snapshotNodes(): AgentElementSnapshot[] {
    const ids = new Set<string>();
    const nodes: AgentElementSnapshot[] = [];

    for (const element of this.#allElements().filter(isSemanticCandidate)) {
      const node = this.#snapshotElement(element);
      if (ids.has(node.id)) {
        throw new AgentDuplicateElementIdError(
          `Duplicate agent element id: ${node.id}`,
        );
      }
      ids.add(node.id);
      nodes.push(node);
    }

    return nodes;
  }

  #refreshRevision(nodes: AgentElementSnapshot[]): void {
    const signature = JSON.stringify(
      nodes.map(({ bounds: _bounds, ...semanticNode }) => semanticNode),
    );
    if (
      this.#semanticSignature !== undefined &&
      signature !== this.#semanticSignature
    ) {
      this.#revision += 1;
    }
    this.#semanticSignature = signature;
  }

  #idFor(element: Element): string {
    const definition = this.#definitions.get(element);
    if (definition) return definition.id;

    const declaredId = element.getAttribute("data-agent-id")?.trim();
    if (declaredId) {
      this.#elementsById.set(declaredId, element);
      return declaredId;
    }

    const existing = this.#generatedIds.get(element);
    if (existing) return existing;
    const generated = `auto-${this.#nextId++}`;
    this.#generatedIds.set(element, generated);
    this.#elementsById.set(generated, element);
    return generated;
  }

  #actionsFor(element: Element): AgentActionSnapshot[] {
    if (isEffectivelyDisabled(element)) return [];
    const definition = this.#definitions.get(element);
    if (!definition?.actions) return inferredActions(element);

    return Object.entries(definition.actions).map(([name, value]) => ({
      name,
      risk: value.risk ?? "write",
      ...(value.description ? { description: value.description } : {}),
      ...(value.inputSchema ? { inputSchema: value.inputSchema } : {}),
      ...(value.outputSchema ? { outputSchema: value.outputSchema } : {}),
      ...(value.preconditions
        ? { preconditions: value.preconditions }
        : {}),
      ...(value.effects ? { effects: value.effects } : {}),
      ...(value.requiresConfirmation !== undefined
        ? { requiresConfirmation: value.requiresConfirmation }
        : {}),
      ...(value.idempotency ? { idempotency: value.idempotency } : {}),
    }));
  }

  #snapshotElement(element: Element): AgentElementSnapshot {
    const definition = this.#definitions.get(element);
    const bounds = boundsOf(element);
    return {
      id: this.#idFor(element),
      role: roleOf(element),
      name: accessibleNameOf(element),
      ...(definition?.description
        ? { description: definition.description }
        : {}),
      state: stateOf(element),
      actions: this.#actionsFor(element),
      ...(bounds ? { bounds } : {}),
    };
  }

  #findElement(id: string): Element {
    const cached = this.#elementsById.get(id);
    if (
      cached?.isConnected &&
      isSemanticCandidate(cached) &&
      this.#idFor(cached) === id
    ) {
      return cached;
    }

    const match = this.#allElements().find(
      (element) =>
        element.getAttribute("data-agent-id") === id ||
        this.#generatedIds.get(element) === id,
    );
    if (!match || !isSemanticCandidate(match)) {
      throw new AgentElementNotFoundError(`Agent element not found: ${id}`);
    }
    this.#elementsById.set(id, match);
    return match;
  }
}

export function createAgentSurface(
  options: AgentSurfaceOptions = {},
): AgentSurface {
  return new AgentSurface(options);
}
