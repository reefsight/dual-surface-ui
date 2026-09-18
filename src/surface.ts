import {
  accessibleNameOf,
  boundsOf,
  inferredActions,
  isSemanticCandidate,
  roleOf,
  runNativeAction,
  stateOf,
} from "./dom.js";
import { AGENT_CONTRACT_SCHEMA_VERSION } from "./schema.js";
import type {
  AgentActionRequest,
  AgentActionResult,
  AgentActionSnapshot,
  AgentElementDefinition,
  AgentElementSnapshot,
  AgentSnapshot,
  AgentSurfaceOptions,
} from "./types.js";

export class AgentElementNotFoundError extends Error {}
export class AgentActionNotFoundError extends Error {}
export class AgentAuthorizationRequiredError extends Error {}
export class AgentDuplicateElementIdError extends Error {}
export class AgentSurfaceMismatchError extends Error {}
export class AgentStaleRevisionError extends Error {}

export class AgentSurface {
  readonly #root: ParentNode;
  readonly #surfaceId: string;
  readonly #authorize: AgentSurfaceOptions["authorize"];
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

    if (action.risk !== "read") {
      const allowed = await this.#authorize?.({
        ...request,
        risk: action.risk,
        element: snapshot,
      });
      if (!allowed) {
        throw new AgentAuthorizationRequiredError(
          `Action "${request.action}" requires authorization`,
        );
      }
    }

    const customHandler =
      this.#definitions.get(element)?.actions?.[request.action]?.handler;
    if (customHandler) {
      await customHandler(request.input, element);
    } else {
      runNativeAction(element, request.action, request.input);
    }

    const after = this.snapshot();
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
    };
  }

  #defaultSurfaceId(): string {
    const document = this.#document();
    return document.location?.href || "document";
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
