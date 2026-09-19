import type { Dialog, Download, ElementHandle, Frame, JSHandle, Locator, Page } from "playwright-core";

import { isValidAgentAuditIdentifier } from "../audit.js";
import {
  captureRegisteredElementDefinition,
  cloneRegisteredMetadata,
} from "../definition.js";
import {
  AgentError,
  AgentAuthorizationRequiredError,
  AgentDuplicateElementIdError,
  AgentElementNotFoundError,
  AgentStaleRevisionError,
  AgentSurfaceMismatchError,
  AgentVerificationFailedError,
} from "../errors.js";
import { AgentActionLifecycleCoordinator } from "../internal/action-lifecycle.js";
import { AGENT_CONTRACT_SCHEMA_VERSION } from "../schema.js";
import type {
  AgentActionDefinition,
  AgentActionOutcome,
  AgentActionRequest,
  AgentActionResult,
  AgentActionSnapshot,
  AgentElementSnapshot,
  AgentSnapshot,
} from "../types.js";
import type {
  PlaywrightActionBinding,
  PlaywrightElementBinding,
  PlaywrightOperation,
  PlaywrightSurface as PlaywrightSurfaceContract,
  PlaywrightSurfaceOptions,
  PlaywrightAriaRole,
  PlaywrightSemanticTarget,
  PlaywrightVisualCandidate,
} from "./types.js";
import {
  createVisualCandidateSelection,
  MAX_VISUAL_MASKS,
  type PlaywrightVisualCandidateBox,
} from "./visual.js";

export type * from "./types.js";

const MAX_BINDINGS = 256;
const MAX_ORIGINS = 32;
const MAX_NAME_LENGTH = 500;
const ACTION_TIMEOUT_MS = 5_000;
const INPUT_STRING_SCHEMA = Object.freeze({ type: "string" });
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const ARIA_ROLES = new Set<PlaywrightAriaRole>([
  "alert", "alertdialog", "application", "article", "banner", "blockquote", "button", "caption", "cell", "checkbox", "code", "columnheader", "combobox", "complementary", "contentinfo", "definition", "deletion", "dialog", "directory", "document", "emphasis", "feed", "figure", "form", "generic", "grid", "gridcell", "group", "heading", "img", "insertion", "link", "list", "listbox", "listitem", "log", "main", "marquee", "math", "meter", "menu", "menubar", "menuitem", "menuitemcheckbox", "menuitemradio", "navigation", "none", "note", "option", "paragraph", "presentation", "progressbar", "radio", "radiogroup", "region", "row", "rowgroup", "rowheader", "scrollbar", "search", "searchbox", "separator", "slider", "spinbutton", "status", "strong", "subscript", "superscript", "switch", "tab", "table", "tablist", "tabpanel", "term", "textbox", "time", "timer", "toolbar", "tooltip", "tree", "treegrid", "treeitem",
]);

interface CapturedActionBinding {
  readonly definition: AgentActionDefinition;
  readonly operation: PlaywrightOperation;
}

interface CapturedElementBinding {
  readonly id: string;
  readonly target: Readonly<{ role: Parameters<Page["getByRole"]>[0]; name: string }>;
  readonly description?: string;
  readonly sensitive: boolean;
  readonly actions: ReadonlyMap<string, CapturedActionBinding>;
}

interface ResolvedPlaywrightTarget {
  readonly binding: CapturedElementBinding;
  readonly handle: ElementHandle;
  readonly locator: Locator;
  readonly operation: PlaywrightOperation;
  readonly request: AgentActionRequest;
  readonly signal?: AbortSignal;
  readonly ownerFrame: Frame;
  readonly mutationEpoch: number;
  startedProhibitedEventEpoch?: number;
}

interface PlaywrightMutationState {
  epoch: number;
  observer: MutationObserver;
  advance: () => void;
  events: string[];
}

interface CapturedVisualOptions {
  readonly selectCandidate: NonNullable<PlaywrightSurfaceOptions["visual"]>["selectCandidate"];
  readonly sensitiveMasks: readonly Readonly<PlaywrightSemanticTarget>[];
}

function invalidConfiguration(message = "Invalid Playwright surface configuration"): never {
  throw new TypeError(message);
}

function dataProperty(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
    return invalidConfiguration();
  }
  return descriptor.value;
}

function optionalDataProperty(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return undefined;
  if (!("value" in descriptor) || !descriptor.enumerable) {
    return invalidConfiguration();
  }
  return descriptor.value;
}

function enumerableDataEntries(value: object): Array<[string, unknown]> {
  const entries: Array<[string, unknown]> = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return invalidConfiguration();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      return invalidConfiguration();
    }
    entries.push([key, descriptor.value]);
  }
  return entries;
}

function assertOnlyKeys(value: object, keys: readonly string[]): void {
  const allowed = new Set(keys);
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string" || !allowed.has(key))) {
    invalidConfiguration();
  }
}

function captureOperation(value: unknown): PlaywrightOperation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalidConfiguration();
  }
  const type = dataProperty(value, "type");
  if (type === "click" || type === "fill" || type === "select-option") {
    assertOnlyKeys(value, ["type"]);
    return Object.freeze({ type });
  }
  if (type === "set-checked") {
    assertOnlyKeys(value, ["type", "checked"]);
    const checked = dataProperty(value, "checked");
    if (typeof checked !== "boolean") return invalidConfiguration();
    return Object.freeze({ type, checked });
  }
  return invalidConfiguration();
}

function captureSemanticTarget(value: unknown): Readonly<PlaywrightSemanticTarget> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalidConfiguration();
  assertOnlyKeys(value, ["role", "name"]);
  const role = dataProperty(value, "role");
  const name = dataProperty(value, "name");
  if (
    typeof role !== "string" || !ARIA_ROLES.has(role as PlaywrightAriaRole) ||
    typeof name !== "string" || name.length === 0 || name.length > MAX_NAME_LENGTH ||
    name.trim() !== name || CONTROL_CHARACTER_PATTERN.test(name)
  ) return invalidConfiguration();
  return Object.freeze({ role: role as PlaywrightAriaRole, name });
}

function captureVisualOptions(value: unknown): CapturedVisualOptions | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalidConfiguration();
  assertOnlyKeys(value, ["selectCandidate", "sensitiveMasks"]);
  const selectCandidate = dataProperty(value, "selectCandidate");
  const masks = dataProperty(value, "sensitiveMasks");
  if (typeof selectCandidate !== "function" || !Array.isArray(masks) || masks.length > MAX_VISUAL_MASKS) {
    return invalidConfiguration("visual requires a selector and bounded sensitiveMasks");
  }
  const seen = new Set<string>();
  const sensitiveMasks = masks.map((mask) => {
    const target = captureSemanticTarget(mask);
    const key = `${target.role}\u0000${target.name}`;
    if (seen.has(key)) return invalidConfiguration("visual sensitiveMasks must be unique");
    seen.add(key);
    return target;
  });
  return Object.freeze({
    selectCandidate: selectCandidate as CapturedVisualOptions["selectCandidate"],
    sensitiveMasks: Object.freeze(sensitiveMasks),
  });
}

function captureActionBinding(name: string, value: unknown): CapturedActionBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalidConfiguration();
  }
  assertOnlyKeys(value, [
    "description",
    "risk",
    "inputSchema",
    "outputSchema",
    "preconditions",
    "effects",
    "requiresConfirmation",
    "idempotency",
    "operation",
  ]);
  const operation = captureOperation(dataProperty(value, "operation"));
  const actionRecord: Record<string, unknown> = Object.create(null);
  for (const [key, item] of enumerableDataEntries(value)) {
    if (key !== "operation") actionRecord[key] = item;
  }
  if (actionRecord.outputSchema !== undefined) {
    return invalidConfiguration("Playwright operations cannot expose outputSchema");
  }
  if (actionRecord.risk === "credential") {
    return invalidConfiguration("Credential-risk Playwright actions are prohibited");
  }
  if (operation.type === "click" || operation.type === "set-checked") {
    if (actionRecord.inputSchema !== undefined) {
      return invalidConfiguration("This Playwright operation does not accept input");
    }
  } else if (actionRecord.inputSchema === undefined) {
    actionRecord.inputSchema = INPUT_STRING_SCHEMA;
  }
  const captured = captureRegisteredElementDefinition({
    id: "playwright-binding",
    actions: { [name]: actionRecord },
  }).actions?.[name];
  if (!captured) return invalidConfiguration();
  return Object.freeze({
    definition: Object.freeze(captured),
    operation,
  });
}

function captureBindings(bindings: readonly PlaywrightElementBinding[]): readonly CapturedElementBinding[] {
  if (!Array.isArray(bindings) || bindings.length === 0 || bindings.length > MAX_BINDINGS) {
    return invalidConfiguration("bindings must contain 1-256 entries");
  }
  const captured: CapturedElementBinding[] = [];
  const ids = new Set<string>();
  const semanticTargets = new Set<string>();
  for (const source of bindings) {
    if (!source || typeof source !== "object" || Array.isArray(source)) return invalidConfiguration();
    assertOnlyKeys(source, ["id", "target", "description", "sensitive", "actions"]);
    const id = dataProperty(source, "id");
    const target = dataProperty(source, "target");
    const description = optionalDataProperty(source, "description");
    const sensitive = optionalDataProperty(source, "sensitive");
    const sourceActions = dataProperty(source, "actions");
    if (typeof id !== "string" || !IDENTIFIER_PATTERN.test(id) || ids.has(id)) {
      return invalidConfiguration("Playwright binding IDs must be unique opaque identifiers");
    }
    ids.add(id);
    const capturedTarget = captureSemanticTarget(target);
    const { role, name } = capturedTarget;
    const semanticKey = `${role}\u0000${name}`;
    if (semanticTargets.has(semanticKey)) {
      return invalidConfiguration("Playwright semantic targets must be unique");
    }
    semanticTargets.add(semanticKey);
    if (
      description !== undefined &&
      (typeof description !== "string" || description.length > 500 || CONTROL_CHARACTER_PATTERN.test(description))
    ) return invalidConfiguration();
    if (sensitive !== undefined && typeof sensitive !== "boolean") return invalidConfiguration();
    if (!sourceActions || typeof sourceActions !== "object" || Array.isArray(sourceActions)) {
      return invalidConfiguration();
    }
    const actions = new Map<string, CapturedActionBinding>();
    for (const [actionName, action] of enumerableDataEntries(sourceActions)) {
      const capturedAction = captureActionBinding(actionName, action);
      const operationType = capturedAction.operation.type;
      const compatible =
        (operationType === "click" && new Set(["button", "link", "menuitem", "menuitemcheckbox", "menuitemradio", "tab", "option", "checkbox", "radio", "switch"]).has(role)) ||
        (operationType === "fill" && new Set(["textbox", "searchbox", "spinbutton", "combobox"]).has(role)) ||
        (operationType === "set-checked" && new Set(["checkbox", "radio"]).has(role)) ||
        (operationType === "select-option" && new Set(["combobox", "listbox"]).has(role));
      if (!compatible) return invalidConfiguration("Playwright operation is incompatible with its semantic role");
      if (
        operationType === "set-checked" && role === "radio" &&
        capturedAction.operation.type === "set-checked" &&
        capturedAction.operation.checked === false
      ) {
        return invalidConfiguration("Radio controls cannot be unchecked through Playwright");
      }
      if (operationType === "click" && !capturedAction.definition.effects?.length) {
        return invalidConfiguration("Playwright click actions require a declared trusted effect");
      }
      actions.set(actionName, capturedAction);
    }
    if ((actions.size === 0 && sensitive !== true) || actions.size > 64) return invalidConfiguration();
    if (sensitive === true && actions.size !== 0) {
      return invalidConfiguration("Sensitive Playwright bindings cannot expose actions");
    }
    captured.push(Object.freeze({
      id,
      target: Object.freeze({ role: role as Parameters<Page["getByRole"]>[0], name }),
      ...(description !== undefined ? { description: description as string } : {}),
      sensitive: sensitive === true,
      actions,
    }));
  }
  return Object.freeze(captured.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

function captureOrigins(origins: readonly string[]): ReadonlySet<string> {
  if (!Array.isArray(origins) || origins.length === 0 || origins.length > MAX_ORIGINS) {
    return invalidConfiguration("allowedOrigins must contain 1-32 origins");
  }
  const captured = new Set<string>();
  for (const value of origins) {
    if (typeof value !== "string") return invalidConfiguration();
    let parsed: URL;
    try { parsed = new URL(value); } catch { return invalidConfiguration(); }
    if (
      parsed.origin === "null" || parsed.origin !== value ||
      (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    ) return invalidConfiguration("allowedOrigins must contain canonical HTTP(S) origins");
    captured.add(value);
  }
  return captured;
}

function actionSnapshot(name: string, action: CapturedActionBinding): AgentActionSnapshot {
  const value = action.definition;
  return {
    name,
    risk: value.risk ?? "write",
    ...(value.description ? { description: value.description } : {}),
    ...(value.inputSchema ? { inputSchema: cloneRegisteredMetadata(value.inputSchema) } : {}),
    ...(value.preconditions ? { preconditions: [...value.preconditions] } : {}),
    ...(value.effects ? { effects: [...value.effects] } : {}),
    ...(value.requiresConfirmation !== undefined ? { requiresConfirmation: value.requiresConfirmation } : {}),
    ...(value.idempotency ? { idempotency: value.idempotency } : {}),
  };
}

function currentOrigin(url: string): string {
  try { return new URL(url).origin; }
  catch { throw new AgentSurfaceMismatchError("The Playwright page URL has no authorized origin"); }
}

function cancellableOptions(signal?: AbortSignal): { signal?: AbortSignal; timeout: number } {
  return signal ? { signal, timeout: ACTION_TIMEOUT_MS } : { timeout: ACTION_TIMEOUT_MS };
}

export class PlaywrightSurface implements PlaywrightSurfaceContract {
  readonly #page: Page;
  readonly #surfaceId: string;
  readonly #allowedOrigins: ReadonlySet<string>;
  readonly #bindings: readonly CapturedElementBinding[];
  readonly #bindingsById: ReadonlyMap<string, CapturedElementBinding>;
  readonly #visual: CapturedVisualOptions | undefined;
  readonly #coordinator: AgentActionLifecycleCoordinator<ResolvedPlaywrightTarget>;
  declare readonly selectVisualCandidate?: (
    options?: { signal?: AbortSignal },
  ) => Promise<string | undefined>;
  readonly #removeListeners: Array<() => void> = [];
  #disposed = false;
  #lifecycleEpoch = 0;
  #prohibitedEventEpoch = 0;
  #navigationEpoch = 0;
  #revision = 0;
  #semanticSignature: string | undefined;
  #operationTail: Promise<void> = Promise.resolve();
  #mutationState: JSHandle<PlaywrightMutationState> | undefined;
  #mutationStateFrame: Frame | undefined;

  constructor(options: PlaywrightSurfaceOptions) {
    if (!options || typeof options !== "object") invalidConfiguration();
    const page = dataProperty(options, "page") as Page;
    const surfaceId = dataProperty(options, "surfaceId");
    const allowedOrigins = dataProperty(options, "allowedOrigins") as readonly string[];
    const bindings = dataProperty(options, "bindings") as readonly PlaywrightElementBinding[];
    const visual = captureVisualOptions(optionalDataProperty(options, "visual"));
    const idempotencyCacheSizeValue = optionalDataProperty(options, "idempotencyCacheSize");
    const authorize = optionalDataProperty(options, "authorize") as PlaywrightSurfaceOptions["authorize"];
    const checkPrecondition = optionalDataProperty(options, "checkPrecondition") as PlaywrightSurfaceOptions["checkPrecondition"];
    const confirm = optionalDataProperty(options, "confirm") as PlaywrightSurfaceOptions["confirm"];
    const createCorrelationId = optionalDataProperty(options, "createCorrelationId") as PlaywrightSurfaceOptions["createCorrelationId"];
    const getPrincipal = optionalDataProperty(options, "getPrincipal") as PlaywrightSurfaceOptions["getPrincipal"];
    const onAudit = optionalDataProperty(options, "onAudit") as PlaywrightSurfaceOptions["onAudit"];
    const policy = optionalDataProperty(options, "policy") as PlaywrightSurfaceOptions["policy"];
    const verifyEffect = optionalDataProperty(options, "verifyEffect") as PlaywrightSurfaceOptions["verifyEffect"];
    if (!page || typeof page.getByRole !== "function" || typeof page.mainFrame !== "function") {
      invalidConfiguration("page must be a caller-owned Playwright Page");
    }
    if (!isValidAgentAuditIdentifier(surfaceId)) {
      throw new RangeError("surfaceId must be an opaque URL-safe identifier of 1-128 characters");
    }
    if (
      idempotencyCacheSizeValue !== undefined &&
      (typeof idempotencyCacheSizeValue !== "number" ||
        !Number.isInteger(idempotencyCacheSizeValue) ||
        idempotencyCacheSizeValue < 1)
    ) {
      throw new RangeError("idempotencyCacheSize must be a positive integer");
    }
    const idempotencyCacheSize = idempotencyCacheSizeValue ?? 256;
    this.#page = page;
    this.#surfaceId = surfaceId;
    this.#allowedOrigins = captureOrigins(allowedOrigins);
    this.#bindings = captureBindings(bindings);
    this.#bindingsById = new Map(this.#bindings.map((binding) => [binding.id, binding]));
    this.#visual = visual;
    this.#assertUsableOrigin();
    this.#listen();
    this.#coordinator = new AgentActionLifecycleCoordinator({
      backend: {
        captureContext: () => this.#captureContext(),
        captureSnapshot: (signal) => this.#captureSnapshot(signal),
        lastKnownRevision: () => String(this.#revision),
        resolveTarget: (snapshot, request, targetSnapshot, action, signal) =>
          this.#resolveTarget(snapshot, request, targetSnapshot, action, signal),
        surfaceId: this.#surfaceId,
        settleContext: () => this.#settleEvents(),
        validateTargetInput: (resolved, _action, input) =>
          this.#validateOperationInput(resolved.target.operation, input),
      },
      hooks: {
        ...(authorize ? { authorize } : {}),
        ...(checkPrecondition ? { checkPrecondition } : {}),
        ...(confirm ? { confirm } : {}),
        ...(createCorrelationId ? { createCorrelationId } : {}),
        ...(getPrincipal ? { getPrincipal } : {}),
        ...(onAudit ? { onAudit } : {}),
        ...(policy ? { policy } : {}),
        ...(verifyEffect ? { verifyEffect } : {}),
      },
      idempotencyCacheSize,
    });
    if (visual) {
      Object.defineProperty(this, "selectVisualCandidate", {
        configurable: false,
        enumerable: false,
        writable: false,
        value: (selectionOptions: { signal?: AbortSignal } = {}) => this.#enqueue(async () => {
          try {
            return await this.#selectVisualCandidate(selectionOptions.signal);
          } catch {
            this.#assertNotAborted(selectionOptions.signal);
            return undefined;
          }
        }),
      });
    }
  }

  snapshot(options: { signal?: AbortSignal } = {}): Promise<AgentSnapshot> {
    return this.#enqueue(async () => {
      this.#assertNotAborted(options.signal);
      const snapshot = await this.#captureSnapshot(options.signal);
      this.#assertNotAborted(options.signal);
      this.#coordinator.observe(snapshot);
      return snapshot;
    });
  }

  perform(request: AgentActionRequest, options: { signal?: AbortSignal } = {}): Promise<AgentActionResult> {
    return this.#enqueue(() => this.#coordinator.perform(request, options));
  }

  performSafe(request: AgentActionRequest, options: { signal?: AbortSignal } = {}): Promise<AgentActionOutcome> {
    return this.#enqueue(() => this.#coordinator.performSafe(request, options));
  }

  async #selectVisualCandidate(signal?: AbortSignal): Promise<string | undefined> {
    const visual = this.#visual;
    if (!visual) return undefined;
    this.#assertNotAborted(signal);
    const snapshot = await this.#captureSnapshot(signal);
    const expected = await this.#captureContext();
    const candidates: PlaywrightVisualCandidate[] = snapshot.nodes
      .filter((node) => node.state.sensitive !== true && node.state.disabled !== true && node.actions.length > 0)
      .map((node, index) => Object.freeze({
        id: node.id,
        role: node.role,
        name: node.name,
        marker: `#${(((index + 1) * 2654435761) & 0xffffff).toString(16).padStart(6, "0")}`,
      }));
    // Explicit host masks must resolve, even though the synthetic map contains no page pixels.
    for (const target of visual.sensitiveMasks) {
      if (await this.#page.getByRole(target.role as Parameters<Page["getByRole"]>[0], {
        name: target.name,
        exact: true,
      }).count() !== 1) return undefined;
    }
    const candidateSources = candidates.map((candidate) => this.#locator(this.#bindingsById.get(candidate.id)!));
    const candidateBoxes: PlaywrightVisualCandidateBox[] = [];
    for (const source of candidateSources) {
      if (await source.count() !== 1) return undefined;
      const box = await source.boundingBox(cancellableOptions(signal));
      if (!box) return undefined;
      candidateBoxes.push(box);
    }
    const beforeCapture = await this.#captureContext();
    if (beforeCapture.generation !== expected.generation || beforeCapture.origin !== expected.origin) return undefined;
    const stability = await this.#visualStability();
    if (!stability.stable) return undefined;
    let callbackContext: { generation: string; origin: string; replayGeneration: string } | undefined;
    let selected: string | undefined;
    selected = await createVisualCandidateSelection({
        page: this.#page,
        candidateBoxes,
        candidates,
        selectCandidate: visual.selectCandidate,
        validateBeforeCallback: async () => {
        await this.#settleEvents();
        const current = await this.#captureContext();
        const currentCandidateBoxes: PlaywrightVisualCandidateBox[] = [];
        for (const source of candidateSources) {
          if (await source.count() !== 1) return false;
          const box = await source.boundingBox(cancellableOptions(signal));
          if (!box) return false;
          currentCandidateBoxes.push(box);
        }
        const currentStability = await this.#visualStability();
        if (
          current.generation !== expected.generation ||
          current.origin !== expected.origin || this.#disposed ||
          !currentStability.stable ||
          JSON.stringify(currentStability) !== JSON.stringify(stability) ||
          JSON.stringify(currentCandidateBoxes) !== JSON.stringify(candidateBoxes)
        ) return false;
        callbackContext = current;
        return true;
        },
        ...(signal ? { signal } : {}),
      });
    this.#assertNotAborted(signal);
    await this.#settleEvents();
    const after = await this.#captureContext();
    if (
      !callbackContext || after.generation !== callbackContext.generation ||
      after.origin !== callbackContext.origin || !selected
    ) return undefined;
    const current = await this.#captureSnapshot(signal);
    const node = current.nodes.find((candidate) => candidate.id === selected);
    const selectedBinding = this.#bindingsById.get(selected);
    const finalContext = await this.#captureContext();
    if (
      finalContext.generation !== callbackContext.generation ||
      finalContext.origin !== callbackContext.origin ||
      !selectedBinding || await this.#locator(selectedBinding).count() !== 1
    ) return undefined;
    return node && node.state.sensitive !== true && node.state.disabled !== true && node.actions.length > 0
      ? selected : undefined;
  }

  async #visualStability(): Promise<{
    stable: boolean;
    scrollX: number;
    scrollY: number;
    viewportWidth: number;
    viewportHeight: number;
  }> {
    return this.#page.evaluate(() => ({
      stable:
        document.getAnimations().length === 0 &&
        document.fonts.status === "loaded" &&
        [...document.images].every((image) => image.complete),
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    }));
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#lifecycleEpoch += 1;
    this.#prohibitedEventEpoch += 1;
    void this.#disposeMutationState();
    for (const remove of this.#removeListeners.splice(0)) remove();
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#operationTail.then(operation, operation);
    this.#operationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  #assertNotAborted(signal: AbortSignal | undefined): void {
    if (!signal?.aborted) return;
    const error = new Error("The Playwright operation was aborted before mutation");
    error.name = "AbortError";
    throw error;
  }

  #listen(): void {
    const invalidate = () => {
      this.#lifecycleEpoch += 1;
      this.#prohibitedEventEpoch += 1;
    };
    const navigated = (frame: Frame) => {
      invalidate();
      if (frame === this.#page.mainFrame()) {
        this.#navigationEpoch += 1;
        void this.#disposeMutationState();
      }
    };
    const dialog = (value: Dialog) => {
      invalidate();
      void value.dismiss().catch(() => undefined);
    };
    const download = (_download: Download) => invalidate();
    const popup = (_page: Page) => invalidate();
    const frame = (_frame: Frame) => invalidate();
    this.#page.on("close", invalidate);
    this.#page.on("crash", invalidate);
    this.#page.on("dialog", dialog);
    this.#page.on("download", download);
    this.#page.on("popup", popup);
    this.#page.on("frameattached", frame);
    this.#page.on("framedetached", frame);
    this.#page.on("framenavigated", navigated);
    const context = this.#page.context();
    const browser = context.browser();
    context.on("close", invalidate);
    browser?.on("disconnected", invalidate);
    this.#removeListeners.push(
      () => this.#page.off("close", invalidate),
      () => this.#page.off("crash", invalidate),
      () => this.#page.off("dialog", dialog),
      () => this.#page.off("download", download),
      () => this.#page.off("popup", popup),
      () => this.#page.off("frameattached", frame),
      () => this.#page.off("framedetached", frame),
      () => this.#page.off("framenavigated", navigated),
      () => context.off("close", invalidate),
      ...(
        browser
          ? [() => browser.off("disconnected", invalidate)]
          : []
      ),
    );
  }

  async #settleEvents(): Promise<void> {
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
  }

  async #disposeMutationState(): Promise<void> {
    const state = this.#mutationState;
    this.#mutationState = undefined;
    this.#mutationStateFrame = undefined;
    if (!state) return;
    try {
      await state.evaluate((value) => {
        value.observer.disconnect();
        for (const event of value.events) {
          document.removeEventListener(event, value.advance, true);
        }
      });
    } catch {
      // A navigation may already have destroyed the instrumentation context.
    }
    try { await state.dispose(); } catch { /* Already detached or disposed. */ }
  }

  async #mutationEpoch(): Promise<{ epoch: number; frame: Frame }> {
    try {
      const frame = this.#page.mainFrame();
      if (!this.#mutationState || this.#mutationStateFrame !== frame) {
        await this.#disposeMutationState();
        const state = await frame.evaluateHandle(() => {
          const value: PlaywrightMutationState = {
            epoch: 0,
            observer: undefined as unknown as MutationObserver,
            advance: () => undefined,
            events: ["input", "change", "click", "toggle"],
          };
          value.advance = () => { value.epoch += 1; };
          value.observer = new MutationObserver(value.advance);
          value.observer.observe(document, {
            attributes: true,
            characterData: true,
            childList: true,
            subtree: true,
          });
          for (const event of value.events) {
            document.addEventListener(event, value.advance, true);
          }
          return value;
        });
        if (frame !== this.#page.mainFrame()) {
          await state.dispose();
          throw new AgentStaleRevisionError("The Playwright main frame changed during instrumentation");
        }
        this.#mutationState = state;
        this.#mutationStateFrame = frame;
      }
      return {
        epoch: await this.#mutationState.evaluate((value) => value.epoch),
        frame,
      };
    } catch (error) {
      if (error instanceof AgentError) throw error;
      throw new AgentStaleRevisionError("The Playwright page mutation epoch is unavailable");
    }
  }

  #assertUsableOrigin(): string {
    if (this.#disposed || this.#page.isClosed()) {
      throw new AgentStaleRevisionError("The Playwright surface is no longer active");
    }
    const origin = currentOrigin(this.#page.url());
    if (!this.#allowedOrigins.has(origin)) {
      throw new AgentAuthorizationRequiredError("The Playwright page origin is not authorized");
    }
    return origin;
  }

  async #captureContext(): Promise<{ generation: string; origin: string; replayGeneration: string }> {
    const frame = this.#page.mainFrame();
    const before = this.#lifecycleEpoch;
    const url = this.#page.url();
    const origin = this.#assertUsableOrigin();
    const mutation = await this.#mutationEpoch();
    if (
      frame !== this.#page.mainFrame() || frame !== mutation.frame ||
      url !== this.#page.url() || before !== this.#lifecycleEpoch
    ) {
      throw new AgentStaleRevisionError("The Playwright page changed while its context was captured");
    }
    const generation = [this.#navigationEpoch, this.#lifecycleEpoch, mutation.epoch, url].join("\u0000");
    const replayGeneration = [this.#navigationEpoch, this.#lifecycleEpoch, url].join("\u0000");
    return { generation, origin, replayGeneration };
  }

  async #captureSnapshot(signal?: AbortSignal): Promise<AgentSnapshot> {
    try {
      return await this.#captureSnapshotUnsafe(signal);
    } catch (error) {
      if (error instanceof AgentError) throw error;
      throw new AgentStaleRevisionError("The Playwright page could not be observed safely");
    }
  }

  async #captureSnapshotUnsafe(signal?: AbortSignal): Promise<AgentSnapshot> {
    this.#assertNotAborted(signal);
    const context = await this.#captureContext();
    this.#assertNotAborted(signal);
    const title = (await this.#page.title())
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .slice(0, 500);
    this.#assertNotAborted(signal);
    const nodes: AgentElementSnapshot[] = [];
    const targetSignatures: string[] = [];
    for (const binding of this.#bindings) {
      const observed = await this.#snapshotBinding(binding, signal);
      if (observed) {
        nodes.push(observed.node);
        targetSignatures.push(observed.signature);
      }
    }
    const after = await this.#captureContext();
    if (after.generation !== context.generation || after.origin !== context.origin) {
      throw new AgentStaleRevisionError("The Playwright page changed while it was observed");
    }
    const url = `${context.origin}/`;
    const signature = JSON.stringify({ origin: context.origin, nodes, targetSignatures });
    if (this.#semanticSignature !== undefined && signature !== this.#semanticSignature) this.#revision += 1;
    this.#semanticSignature = signature;
    return {
      schemaVersion: AGENT_CONTRACT_SCHEMA_VERSION,
      surfaceId: this.#surfaceId,
      revision: String(this.#revision),
      title,
      url,
      generatedAt: new Date().toISOString(),
      capabilities: ["snapshot", "perform"],
      nodes,
    };
  }

  #locator(binding: CapturedElementBinding): Locator {
    return this.#page.getByRole(binding.target.role, {
      name: binding.target.name,
      exact: true,
    });
  }

  async #snapshotBinding(
    binding: CapturedElementBinding,
    signal?: AbortSignal,
  ): Promise<{ node: AgentElementSnapshot; signature: string } | undefined> {
    const locator = this.#locator(binding);
    this.#assertNotAborted(signal);
    const count = await locator.count();
    this.#assertNotAborted(signal);
    if (count === 0) return undefined;
    if (count !== 1) throw new AgentDuplicateElementIdError(`Playwright target is ambiguous: ${binding.id}`);
    const visible = await locator.isVisible({ timeout: ACTION_TIMEOUT_MS });
    this.#assertNotAborted(signal);
    const enabled = visible && await locator.isEnabled(cancellableOptions(signal));
    const sensitive = binding.sensitive || await this.#isCredentialControl(binding, locator, signal);
    const state: AgentElementSnapshot["state"] = {
      ...(!enabled ? { disabled: true } : {}),
      ...(sensitive ? { sensitive: true } : {}),
    };
    const operationTypes = new Set([...binding.actions.values()].map((action) => action.operation.type));
    if (!sensitive && (binding.target.role === "checkbox" || binding.target.role === "radio")) {
      try { state.checked = await locator.isChecked(cancellableOptions(signal)); }
      catch { this.#assertNotAborted(signal); }
    }
    let privateValue = "";
    if (!sensitive && (operationTypes.has("fill") || operationTypes.has("select-option"))) {
      try { privateValue = await locator.inputValue(cancellableOptions(signal)); }
      catch { this.#assertNotAborted(signal); }
    }
    const node: AgentElementSnapshot = {
      id: binding.id,
      role: binding.target.role,
      name: binding.target.name,
      ...(binding.description ? { description: binding.description } : {}),
      state,
      actions: sensitive || !enabled
        ? []
        : [...binding.actions.entries()].map(([name, action]) => actionSnapshot(name, action)),
    };
    return { node, signature: JSON.stringify({ id: binding.id, privateValue }) };
  }

  async #isCredentialControl(
    binding: CapturedElementBinding,
    locator: Locator,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const options = cancellableOptions(signal);
    const type = (await locator.getAttribute("type", options))?.toLowerCase();
    const autocomplete = (await locator.getAttribute("autocomplete", options))?.toLowerCase() ?? "";
    const fieldIdentity = [
      binding.target.name,
      binding.description,
      await locator.getAttribute("name", options),
      await locator.getAttribute("id", options),
    ].filter((value): value is string => typeof value === "string").join(" ").toLowerCase();
    const credentialWord = /(?:^|[^a-z0-9])(?:password|passcode|pin|otp|token|secret|card|payment|cvv|cvc|webauthn|passkey|certificate)(?:$|[^a-z0-9])/;
    const credentialPhrase = /(?:one.?time|auth(?:entication)?.?code|verification.?code|security.?code|api.?key|client.?cert)/;
    return type === "password" || type === "file" ||
      /(?:^|\s)(?:current-password|new-password|one-time-code|cc-[^\s]+|webauthn)(?:\s|$)/.test(autocomplete) ||
      credentialWord.test(fieldIdentity) || credentialPhrase.test(fieldIdentity);
  }

  async #resolveTarget(
    _snapshot: AgentSnapshot,
    request: AgentActionRequest,
    targetSnapshot: AgentElementSnapshot,
    _action: AgentActionSnapshot,
    signal?: AbortSignal,
  ) {
    try {
      const binding = this.#bindingsById.get(request.elementId);
      const action = binding?.actions.get(request.action);
      if (!binding || !action || targetSnapshot.id !== binding.id) {
        throw new AgentElementNotFoundError(`Playwright binding is unavailable: ${request.elementId}`);
      }
      const locator = this.#locator(binding);
      this.#assertNotAborted(signal);
      const count = await locator.count();
      this.#assertNotAborted(signal);
      if (
        count !== 1 ||
        !await locator.isVisible({ timeout: ACTION_TIMEOUT_MS }) ||
        !await locator.isEnabled(cancellableOptions(signal))
      ) {
        throw new AgentStaleRevisionError(`Playwright target is no longer actionable: ${binding.id}`);
      }
      if (binding.sensitive || await this.#isCredentialControl(binding, locator, signal)) {
        throw new AgentAuthorizationRequiredError("Credential and sensitive controls are unavailable");
      }
      if (
        (action.operation.type === "fill" || action.operation.type === "select-option") &&
        !await locator.isEditable(cancellableOptions(signal))
      ) {
        throw new AgentStaleRevisionError(`Playwright target is not editable: ${binding.id}`);
      }
      this.#assertNotAborted(signal);
      const handle = await locator.elementHandle({ timeout: ACTION_TIMEOUT_MS });
      this.#assertNotAborted(signal);
      if (!handle) throw new AgentStaleRevisionError(`Playwright target was detached: ${binding.id}`);
      if (action.operation.type === "set-checked") {
        const nativeCheckable = await handle.evaluate(
          (element) =>
            element instanceof HTMLInputElement &&
            (element.type === "checkbox" || element.type === "radio"),
        );
        if (!nativeCheckable) {
          await handle.dispose();
          throw new AgentStaleRevisionError("The Playwright checked target is not a native input");
        }
      }
      if (
        action.operation.type === "select-option" &&
        !await handle.evaluate((element) => element instanceof HTMLSelectElement)
      ) {
        await handle.dispose();
        throw new AgentStaleRevisionError("The Playwright option target is not a native select");
      }
      const ownerFrame = await handle.ownerFrame();
      const mutation = await this.#mutationEpoch();
      if (!ownerFrame || ownerFrame !== this.#page.mainFrame() || ownerFrame !== mutation.frame) {
        await handle.dispose();
        throw new AgentStaleRevisionError(`Playwright target left the authorized main frame: ${binding.id}`);
      }
      const target: ResolvedPlaywrightTarget = {
        binding,
        handle,
        locator,
        operation: action.operation,
        request,
        ownerFrame,
        mutationEpoch: mutation.epoch,
        ...(signal ? { signal } : {}),
      };
      return {
        target,
        isCurrent: () => this.#isCurrentTarget(target),
        release: () => handle.dispose(),
        verifyPostExecution: () =>
          target.startedProhibitedEventEpoch !== undefined &&
          target.startedProhibitedEventEpoch === this.#prohibitedEventEpoch,
        execute: (input: unknown) => this.#execute(target, input),
        verifyDefault: ({ after, before, input }: { after: AgentSnapshot; before: AgentSnapshot; input: unknown }) =>
          this.#verifyDefault(target, before, after, input),
      };
    } catch (error) {
      if (error instanceof AgentError) throw error;
      throw new AgentStaleRevisionError("The Playwright target could not be resolved safely");
    }
  }

  #validateOperationInput(operation: PlaywrightOperation, input: unknown): boolean {
    return operation.type === "fill" || operation.type === "select-option"
      ? typeof input === "string"
      : input === undefined;
  }

  async #isCurrentTarget(target: ResolvedPlaywrightTarget): Promise<boolean> {
    try {
      this.#assertNotAborted(target.signal);
      const count = await target.locator.count();
      this.#assertNotAborted(target.signal);
      if (this.#disposed || this.#page.isClosed() || count !== 1) return false;
      if (
        !await target.locator.isVisible({ timeout: ACTION_TIMEOUT_MS }) ||
        !await target.locator.isEnabled(cancellableOptions(target.signal))
      ) return false;
      if (target.binding.sensitive || await this.#isCredentialControl(target.binding, target.locator, target.signal)) return false;
      const mutation = await this.#mutationEpoch();
      if (
        mutation.frame !== target.ownerFrame ||
        mutation.epoch !== target.mutationEpoch ||
        await target.handle.ownerFrame() !== target.ownerFrame
      ) return false;
      this.#assertNotAborted(target.signal);
      const current = await target.locator.elementHandle({ timeout: ACTION_TIMEOUT_MS });
      this.#assertNotAborted(target.signal);
      if (!current) return false;
      try {
        // Fixed identity comparison only; no caller script or value crosses this boundary.
        return await current.evaluate((node, expected) => node === expected, target.handle);
      } finally { await current.dispose(); }
    } catch { return false; }
  }

  async #execute(target: ResolvedPlaywrightTarget, input: unknown): Promise<void> {
    try {
      this.#assertNotAborted(target.signal);
      this.#assertUsableOrigin();
      if (this.#page.mainFrame() !== target.ownerFrame) {
        throw new AgentStaleRevisionError("The Playwright target frame changed before mutation");
      }
      target.startedProhibitedEventEpoch = this.#prohibitedEventEpoch;
      switch (target.operation.type) {
        case "click": await target.handle.click({ timeout: ACTION_TIMEOUT_MS }); break;
        case "fill": await target.handle.fill(input as string, { timeout: ACTION_TIMEOUT_MS }); break;
        case "set-checked": await target.handle.setChecked(target.operation.checked, { timeout: ACTION_TIMEOUT_MS }); break;
        case "select-option": {
          const selected = await target.handle.selectOption(input as string, { timeout: ACTION_TIMEOUT_MS });
          if (!selected.includes(input as string)) throw new Error("Requested option was not selected");
          break;
        }
      }
    } catch {
      throw new AgentVerificationFailedError(target.request.action);
    }
  }

  async #verifyDefault(
    target: ResolvedPlaywrightTarget,
    before: AgentSnapshot,
    after: AgentSnapshot,
    input: unknown,
  ): Promise<boolean> {
    const previous = before.nodes.find((node) => node.id === target.binding.id);
    const next = after.nodes.find((node) => node.id === target.binding.id);
    switch (target.operation.type) {
      case "fill": return (await target.locator.inputValue({ timeout: ACTION_TIMEOUT_MS })) === input;
      case "set-checked": return next?.state.checked === target.operation.checked;
      case "select-option": return (await target.locator.inputValue({ timeout: ACTION_TIMEOUT_MS })) === input;
      case "click": return !!previous && after.revision !== before.revision;
    }
  }
}

export function createPlaywrightSurface(options: PlaywrightSurfaceOptions): PlaywrightSurface {
  return new PlaywrightSurface(options);
}
