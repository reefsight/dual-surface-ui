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
  AgentDuplicateElementIdError,
  AgentElementNotFoundError,
  AgentStaleRevisionError,
} from "./errors.js";
import { AGENT_CONTRACT_SCHEMA_VERSION } from "./schema.js";
import { AgentActionLifecycleCoordinator } from "./internal/action-lifecycle.js";
import {
  captureRegisteredElementDefinition,
  cloneRegisteredMetadata,
} from "./definition.js";
import type {
  AgentActionRequest,
  AgentActionOutcome,
  AgentActionResult,
  AgentActionSnapshot,
  AgentElementDefinition,
  AgentElementSnapshot,
  AgentSnapshot,
  AgentSurfaceOptions,
} from "./types.js";

interface DomTargetVersion {
  readonly sequence: number;
}

interface LoggedDomMutation {
  readonly record: MutationRecord;
  readonly sequence: number;
}

class DomMutationTracker {
  readonly #observer: MutationObserver;
  readonly #records: LoggedDomMutation[] = [];
  #discardedThrough = 0;
  #sequence = 0;

  constructor(root: Node, Observer: typeof MutationObserver) {
    this.#observer = new Observer((records) => this.#record(records));
    this.#observer.observe(root, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
  }

  capture(target: Element): DomTargetVersion {
    this.#flush();
    return { sequence: this.#sequence };
  }

  isCurrent(captured: DomTargetVersion, target: Element): boolean {
    this.#flush();
    if (captured.sequence < this.#discardedThrough) return false;
    return !this.#records.some(
      ({ record, sequence }) =>
        sequence > captured.sequence && this.#affects(record, target),
    );
  }

  #flush(): void {
    this.#record(this.#observer.takeRecords());
  }

  #record(records: readonly MutationRecord[]): void {
    for (const record of records) {
      this.#records.push({ record, sequence: ++this.#sequence });
      if (this.#records.length > 1024) {
        this.#discardedThrough = this.#records.shift()!.sequence;
      }
    }
  }

  #affects(record: MutationRecord, target: Element): boolean {
    const related = (node: Node) =>
      node === target || target.contains(node) || node.contains(target);
    if (record.type === "childList") {
      if (record.target === target || target.contains(record.target)) return true;
      return [...record.addedNodes, ...record.removedNodes].some(related);
    }
    return related(record.target);
  }
}

const mutationTrackers = new WeakMap<Node, DomMutationTracker>();

class DocumentNavigationTracker {
  #currentUrl: string;
  #sequence = 0;

  constructor(document: Document) {
    const view = document.defaultView;
    this.#currentUrl = view?.location.href ?? document.location?.href ?? "";
    if (!view) return;
    this.#patchHistory(view.history, "pushState", () => view.location.href);
    this.#patchHistory(view.history, "replaceState", () => view.location.href);
    view.addEventListener("popstate", () => {
      this.#recordUrl(view.location.href);
    });
    view.addEventListener("hashchange", (event) => {
      if (event.oldURL !== this.#currentUrl) return;
      this.#currentUrl = event.newURL;
      this.#advance();
    });
    const navigation = (view as Window & { navigation?: EventTarget })
      .navigation;
    navigation?.addEventListener("navigate", () => this.#advance());
  }

  capture(): number {
    return this.#sequence;
  }

  #advance(): void {
    this.#sequence += 1;
  }

  #patchHistory(
    history: History,
    method: "pushState" | "replaceState",
    currentUrl: () => string,
  ): void {
    const original = history[method];
    const recordUrl = (url: string) => this.#recordUrl(url);
    history[method] = function (
      this: History,
      data: unknown,
      unused: string,
      url?: string | URL | null,
    ): void {
      Reflect.apply(original, this, [data, unused, url]);
      recordUrl(currentUrl());
    };
  }

  #recordUrl(url: string): void {
    if (url === this.#currentUrl) return;
    this.#currentUrl = url;
    this.#advance();
  }
}

const navigationTrackers = new WeakMap<Document, DocumentNavigationTracker>();

function navigationTrackerFor(
  document: Document,
): DocumentNavigationTracker {
  const existing = navigationTrackers.get(document);
  if (existing) return existing;
  const tracker = new DocumentNavigationTracker(document);
  navigationTrackers.set(document, tracker);
  return tracker;
}

function mutationTrackerFor(root: Node): DomMutationTracker | undefined {
  const Observer = root.ownerDocument?.defaultView?.MutationObserver ??
    (root instanceof Document ? root.defaultView?.MutationObserver : undefined);
  if (!Observer) return undefined;
  const existing = mutationTrackers.get(root);
  if (existing) return existing;
  const tracker = new DomMutationTracker(root, Observer);
  mutationTrackers.set(root, tracker);
  return tracker;
}

export class AgentSurface {
  readonly #root: ParentNode;
  readonly #surfaceId: string;
  readonly #coordinator: AgentActionLifecycleCoordinator<Element>;
  readonly #definitions = new WeakMap<Element, AgentElementDefinition>();
  readonly #registeredIds = new WeakMap<Element, string>();
  readonly #registrationTokens = new WeakMap<Element, symbol>();
  readonly #elementsById = new Map<string, Element>();
  readonly #generatedIds = new WeakMap<Element, string>();
  readonly #mutationTracker: DomMutationTracker | undefined;
  readonly #navigationTracker: DocumentNavigationTracker;
  #nextId = 1;
  #bindingGeneration = 0;
  #navigationEpoch = 0;
  #observedUrl: string | undefined;
  #revision = 0;
  #semanticSignature: string | undefined;

  constructor(options: AgentSurfaceOptions = {}) {
    const root = options.root ?? globalThis.document;
    if (!root) throw new Error("AgentSurface requires a DOM root");
    this.#root = root;
    this.#surfaceId = options.surfaceId ?? this.#defaultSurfaceId();
    this.#mutationTracker = mutationTrackerFor(this.#root);
    this.#navigationTracker = navigationTrackerFor(this.#document());
    if (options.onAudit && !isValidAgentAuditIdentifier(this.#surfaceId)) {
      throw new RangeError(
        "onAudit requires an opaque URL-safe surfaceId of 1-128 characters",
      );
    }
    const idempotencyCacheSize = options.idempotencyCacheSize ?? 256;
    if (
      !Number.isInteger(idempotencyCacheSize) ||
      idempotencyCacheSize < 1
    ) {
      throw new RangeError("idempotencyCacheSize must be a positive integer");
    }
    this.#coordinator = new AgentActionLifecycleCoordinator<Element>({
      backend: {
        captureContext: () => this.#captureContext(),
        captureSnapshot: () => this.#captureSnapshot(),
        lastKnownRevision: () => String(this.#revision),
        resolveTarget: (_snapshot, request, _targetSnapshot, action) => {
          const element = this.#findElement(request.elementId);
          const targetVersion = this.#mutationTracker?.capture(element);
          const customHandler =
            this.#definitions.get(element)?.actions?.[request.action]?.handler;
          const isCurrent = () => {
            try {
              return (
                this.#findElement(request.elementId) === element &&
                (!targetVersion ||
                  this.#mutationTracker?.isCurrent(targetVersion, element) ===
                    true)
              );
            } catch {
              return false;
            }
          };
          return {
            execute: async (input: unknown) => {
              if (!isCurrent()) {
                throw new AgentStaleRevisionError(
                  `Action revision "${request.revision}" is stale`,
                );
              }
              if (customHandler) return customHandler(input, element);
              runNativeAction(element, request.action, input);
            },
            isCurrent,
            target: element,
            ...(!customHandler
              ? {
                  verifyDefault: ({
                    after,
                    before,
                    input,
                  }: {
                    after: AgentSnapshot;
                    before: AgentSnapshot;
                    input: unknown;
                  }) =>
                    this.#verifyNativeAction(
                      action,
                      request,
                      before,
                      after,
                      input,
                    ),
                }
              : {}),
          };
        },
        surfaceId: this.#surfaceId,
        settleContext: () =>
          new Promise<void>((resolve) => {
            const view = this.#document().defaultView;
            if (view) view.setTimeout(resolve, 0);
            else globalThis.setTimeout(resolve, 0);
          }),
        validateTargetInput: (resolved, action, input) =>
          isValidNativeActionInput(
            resolved.target,
            action.name,
            input,
          ),
      },
      hooks: {
        ...(options.authorize ? { authorize: options.authorize } : {}),
        ...(options.checkPrecondition
          ? { checkPrecondition: options.checkPrecondition }
          : {}),
        ...(options.confirm ? { confirm: options.confirm } : {}),
        ...(options.createCorrelationId
          ? { createCorrelationId: options.createCorrelationId }
          : {}),
        ...(options.getPrincipal
          ? { getPrincipal: options.getPrincipal }
          : {}),
        ...(options.onAudit ? { onAudit: options.onAudit } : {}),
        ...(options.policy ? { policy: options.policy } : {}),
        ...(options.verifyEffect
          ? { verifyEffect: options.verifyEffect }
          : {}),
      },
      idempotencyCacheSize,
    });
  }

  register(element: Element, definition: AgentElementDefinition): () => void {
    const registeredDefinition = captureRegisteredElementDefinition(definition);
    const registeredId = registeredDefinition.id;
    const existing = this.#elementsById.get(registeredId);
    if (existing && existing !== element) {
      throw new Error(`Duplicate agent element id: ${registeredId}`);
    }

    const previousId = this.#registeredIds.get(element);
    if (
      previousId &&
      previousId !== registeredId &&
      this.#elementsById.get(previousId) === element
    ) {
      this.#elementsById.delete(previousId);
    }
    const token = Symbol(registeredId);
    this.#definitions.set(element, registeredDefinition);
    this.#registeredIds.set(element, registeredId);
    this.#registrationTokens.set(element, token);
    this.#elementsById.set(registeredId, element);
    element.setAttribute("data-agent-id", registeredId);
    this.#bindingGeneration += 1;

    return () => {
      if (this.#registrationTokens.get(element) !== token) return;
      this.#registrationTokens.delete(element);
      this.#registeredIds.delete(element);
      this.#definitions.delete(element);
      if (this.#elementsById.get(registeredId) === element) {
        this.#elementsById.delete(registeredId);
      }
      if (element.getAttribute("data-agent-id") === registeredId) {
        element.removeAttribute("data-agent-id");
      }
      this.#bindingGeneration += 1;
    };
  }

  snapshot(): AgentSnapshot {
    const snapshot = this.#captureSnapshot();
    this.#coordinator.observe(snapshot);
    return snapshot;
  }

  #captureSnapshot(): AgentSnapshot {
    const document = this.#document();
    const nodes = this.#snapshotNodes();
    const url = document.location?.href ?? "";
    this.#observeNavigation(url);
    this.#refreshRevision(nodes, url);
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
      url,
      generatedAt: new Date().toISOString(),
      ...(focusedElementId ? { focusedElementId } : {}),
      capabilities: ["snapshot", "perform"],
      nodes,
    };
  }

  async perform(request: AgentActionRequest): Promise<AgentActionResult> {
    return this.#coordinator.perform(request);
  }

  async performSafe(request: AgentActionRequest): Promise<AgentActionOutcome> {
    return this.#coordinator.performSafe(request);
  }

  #defaultSurfaceId(): string {
    const document = this.#document();
    return document.location?.href || "document";
  }

  #verifyNativeAction(
    action: AgentActionSnapshot,
    request: AgentActionRequest,
    before: AgentSnapshot,
    after: AgentSnapshot,
    input: unknown,
  ): boolean {
    const previousNode = before.nodes.find(
      (item) => item.id === request.elementId,
    );
    const nextNode = after.nodes.find((item) => item.id === request.elementId);
    if (action.name === "set_value" && typeof input === "string" && nextNode) {
      const verified = nextNode.state.sensitive
        ? nextNode.state.valuePresent === (input.length > 0)
        : nextNode.state.value === input;
      if (verified) return true;
    } else if (
      action.name === "select" &&
      typeof input === "string" &&
      nextNode
    ) {
      const target = this.#elementsById.get(request.elementId);
      if (target instanceof HTMLSelectElement && target.value === input) return true;
    } else if (
      action.name === "toggle" &&
      previousNode?.state.checked !== undefined &&
      nextNode?.state.checked === !previousNode.state.checked
    ) {
      return true;
    } else if (
      (action.name === "click" || action.name === "submit") &&
      after.revision !== before.revision
    ) {
      return true;
    }
    return false;
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

  #refreshRevision(nodes: AgentElementSnapshot[], url: string): void {
    const signature = JSON.stringify(
      {
        url,
        nodes: nodes.map(({ bounds: _bounds, ...semanticNode }) => semanticNode),
      },
    );
    if (
      this.#semanticSignature !== undefined &&
      signature !== this.#semanticSignature
    ) {
      this.#revision += 1;
    }
    this.#semanticSignature = signature;
  }

  #observeNavigation(url: string): void {
    if (this.#observedUrl !== undefined && this.#observedUrl !== url) {
      this.#navigationEpoch += 1;
    }
    this.#observedUrl = url;
  }

  #captureContext(): {
    generation: string;
    origin: string;
    replayGeneration: string;
  } {
    const url = this.#document().location?.href ?? "";
    this.#observeNavigation(url);
    const trackedNavigation = this.#navigationTracker.capture();
    const historyLength = this.#document().defaultView?.history.length ?? 0;
    return {
      generation: [
        trackedNavigation,
        historyLength,
        this.#navigationEpoch,
        url,
        this.#bindingGeneration,
      ].join("\u0000"),
      origin: this.#document().location?.origin ?? "null",
      replayGeneration: [
        trackedNavigation,
        historyLength,
        this.#navigationEpoch,
        url,
      ].join("\u0000"),
    };
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
      ...(value.inputSchema
        ? { inputSchema: cloneRegisteredMetadata(value.inputSchema) }
        : {}),
      ...(value.outputSchema
        ? { outputSchema: cloneRegisteredMetadata(value.outputSchema) }
        : {}),
      ...(value.preconditions
        ? { preconditions: [...value.preconditions] }
        : {}),
      ...(value.effects ? { effects: [...value.effects] } : {}),
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
