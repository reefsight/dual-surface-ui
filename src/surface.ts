import {
  accessibleNameOf,
  boundsOf,
  inferredActions,
  isSemanticCandidate,
  roleOf,
  runNativeAction,
  stateOf,
} from "./dom.js";
import {
  AgentActionNotFoundError,
  AgentAuthorizationRequiredError,
  AgentConfirmationRequiredError,
  AgentDuplicateElementIdError,
  AgentElementNotFoundError,
  AgentPreconditionFailedError,
  AgentStaleRevisionError,
  AgentSurfaceMismatchError,
  AgentVerificationFailedError,
} from "./errors.js";
import { decideAgentAction } from "./policy.js";
import { AGENT_CONTRACT_SCHEMA_VERSION } from "./schema.js";
import type {
  AgentActionRequest,
  AgentActionResult,
  AgentActionSnapshot,
  AgentElementDefinition,
  AgentElementSnapshot,
  AgentJsonValue,
  AgentPolicyRequest,
  AgentSnapshot,
  AgentSurfaceOptions,
} from "./types.js";
import {
  validateActionInput,
  validateActionOutput,
} from "./validation.js";

export class AgentSurface {
  readonly #root: ParentNode;
  readonly #surfaceId: string;
  readonly #authorize: AgentSurfaceOptions["authorize"];
  readonly #checkPrecondition: AgentSurfaceOptions["checkPrecondition"];
  readonly #confirm: AgentSurfaceOptions["confirm"];
  readonly #getPrincipal: AgentSurfaceOptions["getPrincipal"];
  readonly #policy: AgentSurfaceOptions["policy"];
  readonly #verifyEffect: AgentSurfaceOptions["verifyEffect"];
  readonly #definitions = new WeakMap<Element, AgentElementDefinition>();
  readonly #elementsById = new Map<string, Element>();
  readonly #generatedIds = new WeakMap<Element, string>();
  #nextId = 1;
  #revision = 0;
  #semanticSignature: string | undefined;

  constructor(options: AgentSurfaceOptions = {}) {
    const root = options.root ?? globalThis.document;
    if (!root) throw new Error("AgentSurface requires a DOM root");
    this.#root = root;
    this.#surfaceId = options.surfaceId ?? this.#defaultSurfaceId();
    this.#authorize = options.authorize;
    this.#checkPrecondition = options.checkPrecondition;
    this.#confirm = options.confirm;
    this.#getPrincipal = options.getPrincipal;
    this.#policy = options.policy;
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
    const before = this.snapshot();
    if (request.surfaceId !== this.#surfaceId) {
      throw new AgentSurfaceMismatchError(
        `Action surface "${request.surfaceId}" does not match "${this.#surfaceId}"`,
      );
    }
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

    validateActionInput(action, request.input);

    const principal = await this.#getPrincipal?.();
    const policyRequest = {
      ...request,
      risk: action.risk,
      element: snapshot,
      origin: this.#document().location?.origin ?? "null",
      ...(principal ? { principal } : {}),
    };
    const decision = await decideAgentAction(
      policyRequest,
      this.#policy,
      this.#authorize,
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
      const confirmed = await this.#confirm?.({
        ...policyRequest,
        decision,
      });
      if (!confirmed) {
        throw new AgentConfirmationRequiredError(request.action);
      }
    }

    const current = this.snapshot();
    if (current.revision !== before.revision) {
      throw new AgentStaleRevisionError(
        `Action revision "${request.revision}" is stale; current revision is "${current.revision}"`,
      );
    }

    await this.#checkActionPreconditions(action, policyRequest, current);
    const ready = this.snapshot();
    if (ready.revision !== before.revision) {
      throw new AgentStaleRevisionError(
        `Action revision "${request.revision}" is stale; current revision is "${ready.revision}"`,
      );
    }

    const customHandler =
      this.#definitions.get(element)?.actions?.[request.action]?.handler;
    this.#assertVerificationAvailable(action, customHandler !== undefined);
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

    let after = this.snapshot();
    await this.#verifyAction(
      action,
      policyRequest,
      ready,
      after,
      customHandler !== undefined,
      request.input,
    );
    if (outputError) throw outputError;
    after = this.snapshot();
    const node = after.nodes.find((item) => item.id === request.elementId);
    return {
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
      action.name === "toggle" &&
      previousNode?.state.checked !== undefined &&
      nextNode?.state.checked === !previousNode.state.checked
    ) {
      return;
    } else if (action.name === "click" && after.revision !== before.revision) {
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
    if (cached?.isConnected && this.#idFor(cached) === id) return cached;

    const match = this.#allElements().find(
      (element) =>
        element.getAttribute("data-agent-id") === id ||
        this.#generatedIds.get(element) === id,
    );
    if (!match) {
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
