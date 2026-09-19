import { captureAgentSchema } from "../definition.js";
import type { AgentIdempotency, AgentRisk, AgentSnapshot } from "../types.js";
import type {
  WebMcpToolAnnotations,
  WebMcpToolBinding,
  WebMcpToolDescriptor,
  WebMcpToolRegistrationObservation,
} from "../webmcp/types.js";
import { createWebMcpToolDescriptor } from "../webmcp/descriptor.js";

const LIMIT = Object.freeze({
  nodes: 512,
  actionsPerNode: 64,
  actions: 1_024,
  tools: 512,
  evidence: 1_024,
  domNodes: 2_048,
  textNodes: 256,
  textLength: 4_096,
  semanticCharacters: 2_000_000,
  ancestors: 128,
  issues: 512,
});
const MAX_STRING = 8_192;
const TOOL_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;
const OPAQUE_PATTERN = /^[A-Za-z0-9._~:-]{1,256}$/;
const ACTION_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const DIGEST_PATTERN = /^hmac-sha256:[a-f0-9]{64}$/;
const BOOLEAN_STATE_KEYS = [
  "disabled", "checked", "expanded", "selected", "sensitive", "valuePresent",
] as const;
const CONTROL_ROLES = new Set([
  "button", "checkbox", "combobox", "link", "listbox", "menuitem",
  "menuitemcheckbox", "menuitemradio", "option", "radio", "searchbox",
  "slider", "spinbutton", "switch", "tab", "textbox",
]);
const NATIVE_CONTROL_TAGS = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"]);

type BooleanStateKey = (typeof BOOLEAN_STATE_KEYS)[number];

export type DriftPermissionDecision =
  | "allow"
  | "deny"
  | "require-confirmation"
  | "unknown";

export type DriftIssueCode =
  | "resource_budget_exceeded"
  | "nested_surface_unobserved"
  | "observation_epoch_changed"
  | "surface_mismatch"
  | "revision_mismatch"
  | "snapshot_node_missing"
  | "snapshot_node_unexpected"
  | "snapshot_role_mismatch"
  | "snapshot_name_mismatch"
  | "snapshot_state_mismatch"
  | "snapshot_action_missing"
  | "snapshot_action_unexpected"
  | "snapshot_action_semantics_mismatch"
  | "visible_control_unmapped"
  | "visible_control_missing"
  | "hidden_control_exposed"
  | "control_out_of_root"
  | "accessibility_role_mismatch"
  | "accessible_name_mismatch"
  | "dom_state_mismatch"
  | "accessibility_state_unsupported"
  | "navigation_mismatch"
  | "declared_tool_missing"
  | "declared_tool_unexpected"
  | "declared_tool_semantics_mismatch"
  | "declared_tool_target_missing"
  | "active_tool_missing"
  | "unexpected_active_tool"
  | "active_tool_semantics_mismatch"
  | "active_tool_binding_mismatch"
  | "active_tool_surface_mismatch"
  | "active_tool_revision_mismatch"
  | "active_tool_generation_mismatch"
  | "credential_tool_declared"
  | "permission_observation_missing"
  | "unknown_permission_evidence"
  | "denied_action_exposed"
  | "confirmation_semantics_mismatch"
  | "application_state_observation_missing"
  | "application_state_coverage_missing"
  | "application_state_mismatch";

export type DriftIssueSeverity = "error" | "critical";

export interface DriftControlBinding {
  element: Element;
  elementId: string;
}

export interface DriftApplicationState {
  disabled?: boolean;
  checked?: boolean;
  expanded?: boolean;
  selected?: boolean;
  sensitive?: boolean;
  valuePresent?: boolean;
  valueDigest?: string;
}

export interface DriftPermissionReadRequest {
  elementId: string;
  action: string;
  principalId: string;
  originId: string;
  inputCaseId: string;
}

export type DriftObservedTool = WebMcpToolRegistrationObservation;

export type DriftActiveTools =
  | {
      status: "observed";
      tools: readonly DriftObservedTool[];
    }
  | { status: "unsupported" }
  | { status: "not-observed" };

export interface ManifestState extends DriftApplicationState {}

export interface ManifestAction {
  name: string;
  signature: string;
  risk: AgentRisk;
  requiresConfirmation: boolean;
}

export interface ManifestNode {
  id: string;
  role: string;
  nameDigest: string;
  state: ManifestState;
  actions: readonly ManifestAction[];
}

export interface ManifestTool {
  name: string;
  elementId: string;
  action: string;
  signature: string;
}

export interface SemanticDriftManifest {
  manifestVersion: "0.1";
  fingerprint: string;
  surfaceDigest: string;
  revisionDigest: string;
  navigationDigest: string;
  truncated: boolean;
  nodes: readonly ManifestNode[];
  tools: readonly ManifestTool[];
}

export interface CreateSemanticDriftManifestInput {
  snapshot: AgentSnapshot;
  declaredTools: readonly WebMcpToolBinding[];
  integrityKey: CryptoKey;
}

export interface SemanticDriftInput {
  root: ParentNode;
  /** Trusted, synchronous current surface snapshot reader. */
  readSnapshot: () => AgentSnapshot;
  manifest: SemanticDriftManifest;
  controls: readonly DriftControlBinding[];
  declaredTools: readonly WebMcpToolBinding[];
  /** Independently pinned fingerprint from the reviewed manifest build step. */
  expectedFingerprint: string;
  integrityKey: CryptoKey;
  /** Trusted, synchronous exporter lifecycle reader. */
  readActiveTools: () => DriftActiveTools;
  /** Trusted, synchronous, side-effect-free current permission reader. */
  readPermission: (request: DriftPermissionReadRequest) => DriftPermissionDecision | undefined;
  /** Trusted, synchronous, side-effect-free authoritative state reader. */
  readApplicationState: (elementId: string) => DriftApplicationState | undefined;
  permissionContext: {
    principalId: string;
    originId: string;
    inputCaseId: string;
  };
  /** Monotonic safe integer incremented for every observed-surface mutation. */
  observationEpoch: number;
  /** Trusted application epoch reader. It is called exactly before and after observation. */
  readEpoch: () => number;
}

export interface SemanticDriftTarget {
  kind: "node" | "action" | "tool" | "binding" | "dom-control";
  index: number;
}

export interface SemanticDriftIssue {
  code: DriftIssueCode;
  severity: DriftIssueSeverity;
  target?: SemanticDriftTarget;
}

export interface SemanticDriftReport {
  reportVersion: "0.1";
  status: "consistent" | "drifted" | "incomplete";
  fingerprint: string;
  coverage: {
    controls: number;
    snapshotNodes: number;
    declaredTools: number;
    activeTools: "observed" | "unsupported" | "not-observed";
    permissions: number;
    applicationState: number;
    domNodesVisited: number;
  };
  truncated: boolean;
  issues: readonly SemanticDriftIssue[];
}

interface ArrayCapture {
  items: readonly unknown[];
  length: number;
  overflow: boolean;
}

interface CapturedState extends Partial<Record<BooleanStateKey, boolean>> {
  value?: string;
}

interface CapturedAction {
  name: string;
  description?: string;
  risk: AgentRisk;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  preconditions?: string[];
  effects?: string[];
  requiresConfirmation?: boolean;
  idempotency?: AgentIdempotency;
}

interface CapturedNode {
  id: string;
  role: string;
  name: string;
  state: CapturedState;
  actions: readonly CapturedAction[];
}

interface SnapshotCapture {
  surfaceId: string;
  revision: string;
  url: string;
  nodes: readonly CapturedNode[];
  truncated: boolean;
}

interface CapturedBinding {
  name: string;
  description: string;
  elementId: string;
  action: string;
}

interface CapturedManifest {
  body: Omit<SemanticDriftManifest, "fingerprint">;
  fingerprint: string;
}

function invalidInput(): never {
  throw new TypeError("Invalid semantic drift input");
}

function dataField(value: unknown, key: string, required = true): unknown {
  if (!value || typeof value !== "object") invalidInput();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) {
    if (required) invalidInput();
    return undefined;
  }
  if (!("value" in descriptor)) invalidInput();
  return descriptor.value;
}

function assertPlainRecord(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidInput();
  const prototype = Object.getPrototypeOf(value);
  if (prototype === Object.prototype || prototype === null) return;
  if (Object.getPrototypeOf(prototype) !== null) invalidInput();
  const ownKeys = Object.getOwnPropertyNames(prototype).sort();
  const objectKeys = Object.getOwnPropertyNames(Object.prototype).sort();
  if (
    ownKeys.length !== objectKeys.length ||
    ownKeys.some((key, index) => key !== objectKeys[index])
  ) {
    invalidInput();
  }
}

function captureArray(value: unknown, limit: number): ArrayCapture {
  if (!Array.isArray(value)) invalidInput();
  const descriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (!descriptor || !("value" in descriptor)) invalidInput();
  const length = descriptor.value;
  if (!Number.isSafeInteger(length) || length < 0) invalidInput();
  const items: unknown[] = [];
  for (let index = 0; index < Math.min(length, limit); index += 1) {
    const item = Object.getOwnPropertyDescriptor(value, String(index));
    if (!item || !("value" in item)) invalidInput();
    items.push(item.value);
  }
  return { items, length, overflow: length > limit };
}

function stringField(value: unknown, key: string, max = MAX_STRING, required = true): string | undefined {
  const item = dataField(value, key, required);
  if (item === undefined && !required) return undefined;
  if (typeof item !== "string" || item.length > max) invalidInput();
  return item;
}

function opaqueField(value: unknown, key: string): string {
  const item = stringField(value, key, 256)!;
  if (!OPAQUE_PATTERN.test(item)) invalidInput();
  return item;
}

function actionField(value: unknown, key: string): string {
  const item = stringField(value, key, 128)!;
  if (!ACTION_PATTERN.test(item)) invalidInput();
  return item;
}

function booleanField(value: unknown, key: string): boolean | undefined {
  const item = dataField(value, key, false);
  if (item === undefined) return undefined;
  if (typeof item !== "boolean") invalidInput();
  return item;
}

function captureIdentifiers(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  const captured = captureArray(value, LIMIT.actionsPerNode);
  if (captured.overflow) invalidInput();
  return captured.items.map((item) => {
    if (typeof item !== "string" || !ACTION_PATTERN.test(item)) invalidInput();
    return item;
  });
}

function captureSchema(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  assertPlainRecord(value);
  return captureAgentSchema(value);
}

function captureState(value: unknown): CapturedState {
  assertPlainRecord(value);
  const state: CapturedState = {};
  for (const key of BOOLEAN_STATE_KEYS) {
    const item = booleanField(value, key);
    if (item !== undefined) state[key] = item;
  }
  const rawValue = dataField(value, "value", false);
  if (rawValue !== undefined) {
    if (typeof rawValue !== "string" || rawValue.length > 32_768) invalidInput();
    state.value = rawValue;
  }
  return state;
}

function captureAction(value: unknown): CapturedAction {
  assertPlainRecord(value);
  const risk = stringField(value, "risk", 32)!;
  if (!new Set(["read", "write", "consequential", "destructive", "credential"]).has(risk)) invalidInput();
  const idempotency = stringField(value, "idempotency", 32, false);
  if (idempotency !== undefined && !new Set(["none", "keyed", "safe-retry"]).has(idempotency)) invalidInput();
  const inputSchema = captureSchema(dataField(value, "inputSchema", false));
  const outputSchema = captureSchema(dataField(value, "outputSchema", false));
  const preconditions = captureIdentifiers(dataField(value, "preconditions", false));
  const effects = captureIdentifiers(dataField(value, "effects", false));
  const confirmation = booleanField(value, "requiresConfirmation");
  const description = stringField(value, "description", 500, false);
  return {
    name: actionField(value, "name"),
    risk: risk as AgentRisk,
    ...(description !== undefined ? { description } : {}),
    ...(inputSchema ? { inputSchema } : {}),
    ...(outputSchema ? { outputSchema } : {}),
    ...(preconditions ? { preconditions } : {}),
    ...(effects ? { effects } : {}),
    ...(confirmation !== undefined ? { requiresConfirmation: confirmation } : {}),
    ...(idempotency !== undefined ? { idempotency: idempotency as AgentIdempotency } : {}),
  };
}

function captureSnapshot(value: unknown): SnapshotCapture {
  assertPlainRecord(value);
  const nodeArray = captureArray(dataField(value, "nodes"), LIMIT.nodes);
  const nodes: CapturedNode[] = [];
  const nodeIds = new Set<string>();
  let totalActions = 0;
  let semanticCharacters = 0;
  let truncated = nodeArray.overflow;
  for (const rawNode of nodeArray.items) {
    assertPlainRecord(rawNode);
    const id = stringField(rawNode, "id", 256)!;
    if (nodeIds.has(id)) invalidInput();
    nodeIds.add(id);
    const actionArray = captureArray(
      dataField(rawNode, "actions"),
      Math.max(0, Math.min(LIMIT.actionsPerNode, LIMIT.actions - totalActions)),
    );
    truncated ||= actionArray.overflow;
    const actions: CapturedAction[] = [];
    for (const rawAction of actionArray.items) {
      const action = captureAction(rawAction);
      semanticCharacters += canonical(action).length;
      if (semanticCharacters > LIMIT.semanticCharacters) {
        truncated = true;
        break;
      }
      actions.push(action);
    }
    const names = new Set<string>();
    for (const action of actions) {
      if (names.has(action.name)) invalidInput();
      names.add(action.name);
    }
    totalActions += actions.length;
    nodes.push({
      id,
      role: stringField(rawNode, "role", 128)!,
      name: stringField(rawNode, "name", LIMIT.textLength)!,
      state: captureState(dataField(rawNode, "state")),
      actions,
    });
  }
  return {
    surfaceId: stringField(value, "surfaceId")!,
    revision: stringField(value, "revision", 256)!,
    url: stringField(value, "url")!,
    nodes,
    truncated,
  };
}

function captureBindings(value: unknown): { bindings: CapturedBinding[]; truncated: boolean } {
  const array = captureArray(value, LIMIT.tools);
  const bindings: CapturedBinding[] = [];
  const names = new Set<string>();
  const targets = new Set<string>();
  for (const raw of array.items) {
    assertPlainRecord(raw);
    const name = stringField(raw, "name", 128)!;
    if (!TOOL_PATTERN.test(name) || names.has(name)) invalidInput();
    const elementId = stringField(raw, "elementId", 256)!;
    const action = actionField(raw, "action");
    const target = `${elementId}\u0000${action}`;
    if (targets.has(target)) invalidInput();
    names.add(name);
    targets.add(target);
    bindings.push({ name, description: stringField(raw, "description", 500)!, elementId, action });
  }
  return { bindings, truncated: array.overflow };
}

function captureManifest(value: unknown): CapturedManifest {
  assertPlainRecord(value);
  if (stringField(value, "manifestVersion", 8) !== "0.1") invalidInput();
  const fingerprint = stringField(value, "fingerprint", 80)!;
  const surfaceDigest = stringField(value, "surfaceDigest", 80)!;
  const navigationDigest = stringField(value, "navigationDigest", 80)!;
  const revisionDigest = stringField(value, "revisionDigest", 80)!;
  if (![fingerprint, surfaceDigest, revisionDigest, navigationDigest].every((item) => DIGEST_PATTERN.test(item))) invalidInput();
  const declaredTruncated = booleanField(value, "truncated");
  if (declaredTruncated === undefined) invalidInput();

  const nodeArray = captureArray(dataField(value, "nodes"), LIMIT.nodes);
  const nodes: ManifestNode[] = [];
  const nodeIds = new Set<string>();
  let totalActions = 0;
  let manifestOverflow = nodeArray.overflow;
  for (const raw of nodeArray.items) {
    assertPlainRecord(raw);
    const id = stringField(raw, "id", 256)!;
    if (nodeIds.has(id)) invalidInput();
    nodeIds.add(id);
    const rawState = dataField(raw, "state");
    assertPlainRecord(rawState);
    const state: ManifestState = {};
    for (const key of BOOLEAN_STATE_KEYS) {
      const item = booleanField(rawState, key);
      if (item !== undefined) state[key] = item;
    }
    const valueDigest = stringField(rawState, "valueDigest", 80, false);
    if (valueDigest !== undefined) {
      if (!DIGEST_PATTERN.test(valueDigest)) invalidInput();
      state.valueDigest = valueDigest;
    }
    const actionArray = captureArray(
      dataField(raw, "actions"),
      Math.max(0, Math.min(LIMIT.actionsPerNode, LIMIT.actions - totalActions)),
    );
    manifestOverflow ||= actionArray.overflow;
    const actions: ManifestAction[] = [];
    const actionNames = new Set<string>();
    for (const rawAction of actionArray.items) {
      assertPlainRecord(rawAction);
      const name = actionField(rawAction, "name");
      if (actionNames.has(name)) invalidInput();
      actionNames.add(name);
      const signature = stringField(rawAction, "signature", 80)!;
      const risk = stringField(rawAction, "risk", 32)! as AgentRisk;
      const confirmation = booleanField(rawAction, "requiresConfirmation");
      if (!DIGEST_PATTERN.test(signature) ||
        !new Set(["read", "write", "consequential", "destructive", "credential"]).has(risk) ||
        confirmation === undefined) invalidInput();
      actions.push({ name, signature, risk, requiresConfirmation: confirmation });
    }
    totalActions += actions.length;
    const nameDigest = stringField(raw, "nameDigest", 80)!;
    if (!DIGEST_PATTERN.test(nameDigest)) invalidInput();
    nodes.push({ id, role: stringField(raw, "role", 128)!, nameDigest, state, actions });
  }

  const toolArray = captureArray(dataField(value, "tools"), LIMIT.tools);
  const tools: ManifestTool[] = [];
  const toolNames = new Set<string>();
  for (const raw of toolArray.items) {
    assertPlainRecord(raw);
    const name = stringField(raw, "name", 128)!;
    const signature = stringField(raw, "signature", 80)!;
    if (!TOOL_PATTERN.test(name) || toolNames.has(name) || !DIGEST_PATTERN.test(signature)) invalidInput();
    toolNames.add(name);
    tools.push({
      name,
      elementId: stringField(raw, "elementId", 256)!,
      action: actionField(raw, "action"),
      signature,
    });
  }
  return {
    fingerprint,
    body: {
      manifestVersion: "0.1",
      surfaceDigest,
      revisionDigest,
      navigationDigest,
      truncated: declaredTruncated || manifestOverflow || toolArray.overflow,
      nodes,
      tools,
    },
  };
}

function canonical(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort()
    .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}

function schemaSemantics(value: unknown, parentKey?: string): unknown {
  if (Array.isArray(value)) {
    const items = value.map((item) => schemaSemantics(item));
    return new Set(["required", "enum", "type", "allOf", "anyOf", "oneOf"]).has(parentKey ?? "")
      ? items.sort((left, right) => canonical(left).localeCompare(canonical(right)))
      : items;
  }
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    result[key] = schemaSemantics((value as Record<string, unknown>)[key], key);
  }
  return result;
}

function integrityKey(value: unknown): CryptoKey {
  if (!value || typeof value !== "object") invalidInput();
  const key = value as CryptoKey;
  const algorithm = key.algorithm as HmacKeyAlgorithm | undefined;
  const hash = algorithm?.hash as Algorithm | undefined;
  if (key.type !== "secret" || key.extractable || algorithm?.name !== "HMAC" || hash?.name !== "SHA-256" || !key.usages?.includes("sign")) invalidInput();
  return key;
}

async function digest(key: CryptoKey, domain: string, value: string): Promise<string> {
  const message = new TextEncoder().encode(`${domain}\u0000${value}`);
  const result = await globalThis.crypto.subtle.sign("HMAC", key, message);
  return `hmac-sha256:${Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function manifestState(key: CryptoKey, elementId: string, state: CapturedState): Promise<ManifestState> {
  const result: ManifestState = {};
  for (const key of BOOLEAN_STATE_KEYS) if (state[key] !== undefined) result[key] = state[key];
  if (state.value !== undefined) result.valueDigest = await digest(key, `state:${elementId}:value`, state.value);
  return result;
}

function actionSemantics(action: CapturedAction): Record<string, unknown> {
  return {
    name: action.name,
    description: action.description,
    risk: action.risk,
    inputSchema: action.inputSchema ? schemaSemantics(action.inputSchema) : undefined,
    outputSchema: action.outputSchema ? schemaSemantics(action.outputSchema) : undefined,
    preconditions: action.preconditions,
    effects: action.effects,
    requiresConfirmation: action.requiresConfirmation ?? false,
    idempotency: action.idempotency ?? "none",
  };
}

function descriptorSemantics(descriptor: WebMcpToolDescriptor): Record<string, unknown> {
  return {
    name: descriptor.name,
    description: descriptor.description,
    inputSchema: schemaSemantics(descriptor.inputSchema),
    annotations: descriptor.annotations,
  };
}

function freeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const item of Object.values(value)) freeze(item, seen);
  return Object.freeze(value);
}

async function buildManifest(
  key: CryptoKey,
  snapshot: SnapshotCapture,
  bindings: readonly CapturedBinding[],
  bindingTruncated: boolean,
  strictBindings = true,
): Promise<Omit<SemanticDriftManifest, "fingerprint">> {
  const nodes: ManifestNode[] = [];
  for (const node of snapshot.nodes) {
    const actions: ManifestAction[] = [];
    for (const action of node.actions) {
      actions.push({
        name: action.name,
        signature: await digest(key, `action:${node.id}:${action.name}`, canonical(actionSemantics(action))),
        risk: action.risk,
        requiresConfirmation: action.requiresConfirmation === true,
      });
    }
    nodes.push({
      id: node.id,
      role: node.role,
      nameDigest: await digest(key, `name:${node.id}`, node.name),
      state: await manifestState(key, node.id, node.state),
      actions,
    });
  }
  const nodeIndex = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const tools: ManifestTool[] = [];
  for (const binding of bindings) {
    const action = nodeIndex.get(binding.elementId)?.actions.find((item) => item.name === binding.action);
    if (!action) {
      if (strictBindings) invalidInput();
      continue;
    }
    tools.push({
      name: binding.name,
      elementId: binding.elementId,
      action: binding.action,
      signature: await digest(
        key,
        `tool:${binding.name}`,
        canonical(descriptorSemantics(createWebMcpToolDescriptor(binding, action))),
      ),
    });
  }
  return {
    manifestVersion: "0.1",
    surfaceDigest: await digest(key, "surface", snapshot.surfaceId),
    revisionDigest: await digest(key, "revision", snapshot.revision),
    navigationDigest: await digest(key, "navigation", snapshot.url),
    truncated: snapshot.truncated || bindingTruncated,
    nodes,
    tools,
  };
}

export async function createSemanticDriftManifest(
  input: CreateSemanticDriftManifestInput,
): Promise<SemanticDriftManifest> {
  try {
    assertPlainRecord(input);
    const key = integrityKey(dataField(input, "integrityKey"));
    const snapshot = captureSnapshot(dataField(input, "snapshot"));
    const declared = captureBindings(dataField(input, "declaredTools"));
    const body = await buildManifest(key, snapshot, declared.bindings, declared.truncated);
    return freeze({ ...body, fingerprint: await digest(key, "manifest", canonical(body)) });
  } catch {
    invalidInput();
  }
}

export async function createSemanticDriftIntegrityKey(): Promise<CryptoKey> {
  return globalThis.crypto.subtle.generateKey(
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"],
  );
}

export async function importSemanticDriftIntegrityKey(
  secret: Uint8Array,
): Promise<CryptoKey> {
  if (!(secret instanceof Uint8Array) || secret.byteLength !== 32) invalidInput();
  return globalThis.crypto.subtle.importKey(
    "raw",
    new Uint8Array(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function digestSemanticValue(
  key: CryptoKey,
  elementId: string,
  value: string,
): Promise<string> {
  integrityKey(key);
  if (typeof elementId !== "string" || elementId.length > 256) invalidInput();
  if (typeof value !== "string" || value.length > 32_768) invalidInput();
  return digest(key, `state:${elementId}:value`, value);
}

class IssueCollector {
  readonly issues: SemanticDriftIssue[] = [];
  truncated = false;
  #seen = new Set<string>();

  add(code: DriftIssueCode, severity: DriftIssueSeverity, target?: SemanticDriftTarget): void {
    const key = `${severity}:${code}:${target?.kind ?? ""}:${target?.index ?? ""}`;
    if (this.#seen.has(key)) return;
    this.#seen.add(key);
    if (this.issues.length >= LIMIT.issues) { this.truncated = true; return; }
    this.issues.push({ code, severity, ...(target ? { target } : {}) });
  }
}

function nodeType(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  try { return (value as Node).nodeType; } catch { return undefined; }
}

function isElement(value: unknown): value is Element {
  return nodeType(value) === 1 && typeof (value as Element).getAttribute === "function";
}

function isParentNode(value: unknown): value is ParentNode {
  return [1, 9, 11].includes(nodeType(value) ?? -1) && typeof (value as ParentNode).querySelectorAll === "function";
}

function contains(root: ParentNode, element: Element): boolean {
  return root === element || typeof root.contains === "function" && root.contains(element);
}

function roleOf(element: Element): string {
  const explicit = element.getAttribute("role")?.trim().split(/\s+/)[0];
  if (explicit) return explicit;
  const tag = element.tagName;
  if (tag === "INPUT") {
    const type = String((element as HTMLInputElement).type || "text").toLowerCase();
    return ({ button: "button", checkbox: "checkbox", email: "textbox", number: "spinbutton", radio: "radio", range: "slider", reset: "button", search: "searchbox", submit: "button", tel: "textbox", text: "textbox", url: "textbox" } as Record<string, string>)[type] ?? "textbox";
  }
  return ({ A: "link", BUTTON: "button", FORM: "form", H1: "heading", H2: "heading", H3: "heading", H4: "heading", H5: "heading", H6: "heading", IMG: "img", LI: "listitem", MAIN: "main", NAV: "navigation", OL: "list", OPTION: "option", SELECT: "combobox", TABLE: "table", TEXTAREA: "textbox", UL: "list" } as Record<string, string>)[tag] ?? "generic";
}

function visibleWithinBudget(element: Element): { visible: boolean; overflow: boolean } {
  let current: Element | null = element;
  let depth = 0;
  while (current) {
    if (++depth > LIMIT.ancestors) return { visible: false, overflow: true };
    if (current.hasAttribute("hidden") || current.hasAttribute("inert") || current.getAttribute("aria-hidden")?.trim().toLowerCase() === "true" || current.tagName === "DIALOG" && !current.hasAttribute("open")) return { visible: false, overflow: false };
    if (current.tagName === "DETAILS" && !(current as HTMLDetailsElement).open) {
      const summary = Array.from(current.children).find((child) => child.tagName === "SUMMARY");
      if (!summary || element !== summary && !summary.contains(element)) {
        return { visible: false, overflow: false };
      }
    }
    const style = current.ownerDocument.defaultView?.getComputedStyle(current);
    if (style?.display === "none" || style?.visibility === "hidden" || style?.visibility === "collapse" || style?.getPropertyValue("content-visibility") === "hidden") return { visible: false, overflow: false };
    const parentElement: Element | null = current.parentElement;
    if (parentElement) {
      current = parentElement;
    } else {
      const rootNode: Node = current.getRootNode();
      const shadowHost: Element | undefined = nodeType(rootNode) === 11
        ? (rootNode as ShadowRoot).host
        : undefined;
      current = shadowHost && isElement(shadowHost) ? shadowHost : null;
    }
  }
  if (element.tagName === "INPUT" && String((element as HTMLInputElement).type).toLowerCase() === "hidden") return { visible: false, overflow: false };
  return { visible: true, overflow: false };
}

function boundedText(element: Element): { text: string; overflow: boolean } {
  const walker = element.ownerDocument.createTreeWalker(element, 0xffffffff);
  let visited = 0;
  let text = "";
  let current: Node | null = walker.currentNode;
  while (current) {
    if (++visited > LIMIT.textNodes) return { text: "", overflow: true };
    if (isElement(current) && current !== element) {
      const visibility = visibleWithinBudget(current);
      if (visibility.overflow) return { text: "", overflow: true };
      if (!visibility.visible || ["SCRIPT", "STYLE", "TEMPLATE"].includes(current.tagName)) {
        current = walker.nextSibling();
        continue;
      }
    }
    if (current.nodeType === 3) {
      text += `${current.textContent ?? ""} `;
      if (text.length > LIMIT.textLength) return { text: "", overflow: true };
    }
    current = walker.nextNode();
  }
  return { text: text.replace(/\s+/g, " ").trim(), overflow: false };
}

function accessibleName(element: Element): { name: string; overflow: boolean } {
  const aria = element.getAttribute("aria-label")?.trim();
  if (aria) return aria.length > LIMIT.textLength ? { name: "", overflow: true } : { name: aria, overflow: false };
  const labelledBy = element.getAttribute("aria-labelledby")?.trim();
  if (labelledBy) {
    const ids = labelledBy.split(/\s+/);
    if (ids.length > 16) return { name: "", overflow: true };
    let name = "";
    for (const id of ids) {
      const reference = element.ownerDocument.getElementById(id);
      if (!reference) continue;
      const visibility = visibleWithinBudget(reference);
      if (visibility.overflow) return { name: "", overflow: true };
      if (!visibility.visible) continue;
      const result = boundedText(reference);
      if (result.overflow) return { name: "", overflow: true };
      name += `${result.text} `;
    }
    if (name.trim()) return { name: name.replace(/\s+/g, " ").trim(), overflow: false };
  }
  const labels = (element as HTMLInputElement).labels;
  if (labels?.length) {
    const visibility = visibleWithinBudget(labels[0]!);
    if (visibility.overflow) return { name: "", overflow: true };
    if (visibility.visible) {
      const result = boundedText(labels[0]!);
      if (result.overflow || result.text) return { name: result.text, overflow: result.overflow };
    }
  }
  for (const attribute of ["placeholder", "alt"] as const) {
    const value = element.getAttribute(attribute)?.trim();
    if (value) return { name: value, overflow: false };
  }
  const result = boundedText(element);
  if (result.overflow || result.text) return { name: result.text, overflow: result.overflow };
  return { name: element.getAttribute("title")?.trim() ?? "", overflow: false };
}

function stateOf(element: Element): CapturedState {
  const state: CapturedState = {};
  const tag = element.tagName;
  const type = tag === "INPUT" ? String((element as HTMLInputElement).type).toLowerCase() : "";
  const sensitive = type === "password" || element.getAttribute("data-agent-sensitive") === "true";
  if (["BUTTON", "INPUT", "SELECT", "TEXTAREA", "OPTION"].includes(tag) || element.hasAttribute("aria-disabled") || CONTROL_ROLES.has(roleOf(element))) {
    let disabled = (element as HTMLButtonElement).disabled === true;
    try { disabled ||= element.matches(":disabled"); } catch { /* compatibility DOM */ }
    for (let current: Element | null = element; current;) {
      disabled ||= current.hasAttribute("inert") || current.getAttribute("aria-disabled")?.trim().toLowerCase() === "true";
      const parentElement: Element | null = current.parentElement;
      if (parentElement) current = parentElement;
      else {
        const rootNode: Node = current.getRootNode();
        const shadowHost: Element | undefined = nodeType(rootNode) === 11
          ? (rootNode as ShadowRoot).host
          : undefined;
        current = shadowHost && isElement(shadowHost) ? shadowHost : null;
      }
    }
    if (tag === "OPTION") {
      disabled ||= (element.parentElement as HTMLOptGroupElement | null)?.disabled === true ||
        (element.closest("select") as HTMLSelectElement | null)?.disabled === true;
    }
    state.disabled = disabled;
  }
  if (tag === "INPUT" && (type === "checkbox" || type === "radio")) state.checked = (element as HTMLInputElement).checked;
  const ariaChecked = element.getAttribute("aria-checked")?.trim().toLowerCase();
  if (ariaChecked === "true" || ariaChecked === "false") state.checked = ariaChecked === "true";
  if (["INPUT", "SELECT", "TEXTAREA"].includes(tag) && !["button", "reset", "submit"].includes(type)) {
    const value = String((element as HTMLInputElement).value ?? "");
    if (sensitive) { state.sensitive = true; state.valuePresent = value.length > 0; } else state.value = value;
  }
  if (tag === "OPTION") state.selected = (element as HTMLOptionElement).selected;
  const expanded = element.getAttribute("aria-expanded");
  if (expanded !== null) state.expanded = expanded === "true";
  const selected = element.getAttribute("aria-selected");
  if (selected !== null && tag !== "OPTION") state.selected = selected === "true";
  return state;
}

function captureControls(value: unknown): { controls: DriftControlBinding[]; truncated: boolean } {
  const array = captureArray(value, LIMIT.nodes);
  const controls: DriftControlBinding[] = [];
  const ids = new Set<string>();
  const elements = new Set<Element>();
  for (const raw of array.items) {
    assertPlainRecord(raw);
    const element = dataField(raw, "element");
    if (!isElement(element)) invalidInput();
    const elementId = stringField(raw, "elementId", 256)!;
    if (ids.has(elementId) || elements.has(element)) invalidInput();
    ids.add(elementId); elements.add(element);
    controls.push({ element, elementId });
  }
  return { controls, truncated: array.overflow };
}

function captureApplicationState(value: unknown, allowEmpty = false): DriftApplicationState {
  assertPlainRecord(value);
  if (dataField(value, "value", false) !== undefined) invalidInput();
  const state: DriftApplicationState = {};
  for (const key of BOOLEAN_STATE_KEYS) {
    const item = booleanField(value, key);
    if (item !== undefined) state[key] = item;
  }
  const valueDigest = stringField(value, "valueDigest", 80, false);
  if (valueDigest !== undefined) {
    if (!DIGEST_PATTERN.test(valueDigest)) invalidInput();
    state.valueDigest = valueDigest;
  }
  if (!allowEmpty && Object.keys(state).length === 0) invalidInput();
  return state;
}

function statesEqual(left: DriftApplicationState, right: DriftApplicationState): boolean {
  return [...BOOLEAN_STATE_KEYS, "valueDigest"].every((key) => left[key as keyof DriftApplicationState] === right[key as keyof DriftApplicationState]);
}

function stateCovers(observed: DriftApplicationState, expected: DriftApplicationState): boolean {
  return Object.keys(expected).every((key) => key in observed);
}

function stateMatchesExpected(observed: DriftApplicationState, expected: DriftApplicationState): boolean {
  return Object.keys(expected).every(
    (key) => observed[key as keyof DriftApplicationState] === expected[key as keyof DriftApplicationState],
  );
}

function captureToolDescriptor(value: unknown): WebMcpToolDescriptor {
  assertPlainRecord(value);
  const name = stringField(value, "name", 128)!;
  if (!TOOL_PATTERN.test(name)) invalidInput();
  const schema = captureSchema(dataField(value, "inputSchema"))!;
  const rawAnnotations = dataField(value, "annotations");
  assertPlainRecord(rawAnnotations);
  const annotations: WebMcpToolAnnotations = {};
  for (const key of ["readOnlyHint", "consequentialHint", "untrustedContentHint"] as const) {
    const item = booleanField(rawAnnotations, key);
    if (item !== undefined) annotations[key] = item;
  }
  return { name, description: stringField(value, "description", 500)!, inputSchema: schema, annotations };
}

function captureObservedTool(value: unknown): DriftObservedTool {
  assertPlainRecord(value);
  const rawGeneration = dataField(value, "generation");
  if (
    typeof rawGeneration !== "number" ||
    !Number.isSafeInteger(rawGeneration) ||
    rawGeneration < 0
  ) {
    invalidInput();
  }
  return {
    descriptor: captureToolDescriptor(dataField(value, "descriptor")),
    elementId: stringField(value, "elementId", 256)!,
    action: actionField(value, "action"),
    surfaceId: stringField(value, "surfaceId")!,
    revision: stringField(value, "revision", 256)!,
    generation: rawGeneration,
  };
}

function target(kind: SemanticDriftTarget["kind"], index: number): SemanticDriftTarget {
  return { kind, index };
}

const INCOMPLETE_CODES = new Set<DriftIssueCode>([
  "resource_budget_exceeded", "nested_surface_unobserved", "observation_epoch_changed",
  "accessibility_state_unsupported",
  "permission_observation_missing", "unknown_permission_evidence",
  "application_state_observation_missing",
  "application_state_coverage_missing",
]);

export async function checkSemanticDrift(input: SemanticDriftInput): Promise<SemanticDriftReport> {
  try {
    assertPlainRecord(input);
    const key = integrityKey(dataField(input, "integrityKey"));
    const expectedFingerprint = stringField(input, "expectedFingerprint", 80)!;
    if (!DIGEST_PATTERN.test(expectedFingerprint)) invalidInput();
    const readEpoch = dataField(input, "readEpoch");
    if (typeof readEpoch !== "function") invalidInput();
    const rawObservationEpoch = dataField(input, "observationEpoch");
    if (typeof rawObservationEpoch !== "number" || !Number.isSafeInteger(rawObservationEpoch) || rawObservationEpoch < 0) invalidInput();
    const observationEpoch = rawObservationEpoch;
    const permissionContext = dataField(input, "permissionContext");
    assertPlainRecord(permissionContext);
    const principalId = opaqueField(permissionContext, "principalId");
    const originId = opaqueField(permissionContext, "originId");
    const inputCaseId = opaqueField(permissionContext, "inputCaseId");
    const readPermission = dataField(input, "readPermission");
    const readApplicationState = dataField(input, "readApplicationState");
    const readSnapshot = dataField(input, "readSnapshot");
    const readActiveTools = dataField(input, "readActiveTools");
    if (
      typeof readPermission !== "function" ||
      typeof readApplicationState !== "function" ||
      typeof readSnapshot !== "function" ||
      typeof readActiveTools !== "function"
    ) invalidInput();
    const epochBefore = readEpoch();
    if (!Number.isSafeInteger(epochBefore) || epochBefore < 0) invalidInput();
    const root = dataField(input, "root");
    if (!isParentNode(root)) invalidInput();
    const capturedManifest = captureManifest(dataField(input, "manifest"));
    const manifest = capturedManifest.body;
    const fingerprint = capturedManifest.fingerprint;
    if (fingerprint !== expectedFingerprint || await digest(key, "manifest", canonical(manifest)) !== fingerprint) invalidInput();
    const snapshot = captureSnapshot(readSnapshot());
    const declared = captureBindings(dataField(input, "declaredTools"));
    const candidateBody = await buildManifest(key, snapshot, declared.bindings, declared.truncated, false);
    const candidateFingerprint = await digest(key, "manifest", canonical(candidateBody));
    const controlsCapture = captureControls(dataField(input, "controls"));
    const controls = controlsCapture.controls;
    const collector = new IssueCollector();
    let overflow = snapshot.truncated || declared.truncated || controlsCapture.truncated || manifest.truncated === true;

    const manifestNodes = manifest.nodes;
    const manifestTools = manifest.tools;
    const expectedRevisionDigest = manifest.revisionDigest;
    if (manifest.surfaceDigest !== await digest(key, "surface", snapshot.surfaceId)) collector.add("surface_mismatch", "critical");
    if (expectedRevisionDigest !== await digest(key, "revision", snapshot.revision)) collector.add("revision_mismatch", "error");

    if (candidateFingerprint !== fingerprint) {
      const currentById = new Map(candidateBody.nodes.map((node) => [node.id, node]));
      const expectedIds = new Set<string>();
      manifestNodes.forEach((raw, index) => {
        assertPlainRecord(raw);
        const id = stringField(raw, "id", 256)!;
        expectedIds.add(id);
        const current = currentById.get(id);
        if (!current) { collector.add("snapshot_node_missing", "error", target("node", index)); return; }
        if (stringField(raw, "role", 128) !== current.role) collector.add("snapshot_role_mismatch", "error", target("node", index));
        if (stringField(raw, "nameDigest", 80) !== current.nameDigest) collector.add("snapshot_name_mismatch", "error", target("node", index));
        if (!statesEqual(dataField(raw, "state") as DriftApplicationState, current.state)) collector.add("snapshot_state_mismatch", "error", target("node", index));
        const rawActions = captureArray(dataField(raw, "actions"), LIMIT.actionsPerNode).items as ManifestAction[];
        const currentActions = new Map(current.actions.map((action) => [action.name, action]));
        const expectedActions = new Set<string>();
        rawActions.forEach((action, actionIndex) => {
          assertPlainRecord(action);
          const name = actionField(action, "name");
          expectedActions.add(name);
          const actual = currentActions.get(name);
          const actionTarget = target("action", index * LIMIT.actionsPerNode + actionIndex);
          if (!actual) collector.add("snapshot_action_missing", "error", actionTarget);
          else if (stringField(action, "signature", 80) !== actual.signature) collector.add("snapshot_action_semantics_mismatch", "critical", actionTarget);
        });
        current.actions.forEach((action, actionIndex) => {
          if (!expectedActions.has(action.name)) collector.add("snapshot_action_unexpected", "error", target("action", index * LIMIT.actionsPerNode + actionIndex));
        });
      });
      candidateBody.nodes.forEach((node, index) => {
        if (!expectedIds.has(node.id)) collector.add("snapshot_node_unexpected", "error", target("node", index));
      });
    }

    const manifestNodeIndex = new Map(manifestNodes.map((node, index) => [node.id, { node, index }]));
    const mappedElements = new Set<Element>();
    const mappedIds = new Set<string>();
    for (let index = 0; index < controls.length; index += 1) {
      const binding = controls[index]!;
      mappedElements.add(binding.element); mappedIds.add(binding.elementId);
      const itemTarget = target("binding", index);
      if (!contains(root, binding.element)) { collector.add("control_out_of_root", "error", itemTarget); continue; }
      const visibility = visibleWithinBudget(binding.element);
      overflow ||= visibility.overflow;
      const expected = manifestNodeIndex.get(binding.elementId)?.node;
      if (visibility.overflow) continue;
      if (!visibility.visible) { if (expected) collector.add("hidden_control_exposed", "critical", itemTarget); continue; }
      if (!expected) { collector.add("visible_control_missing", "error", itemTarget); continue; }
      if (roleOf(binding.element) !== expected.role) collector.add("accessibility_role_mismatch", "error", itemTarget);
      if (
        binding.element.getAttribute("aria-checked")?.trim().toLowerCase() === "mixed" ||
        binding.element.hasAttribute("aria-checked") && expected.state.checked === undefined ||
        binding.element.hasAttribute("aria-pressed") ||
        binding.element.hasAttribute("aria-valuenow") ||
        binding.element.tagName === "INPUT" &&
          String((binding.element as HTMLInputElement).type).toLowerCase() === "checkbox" &&
          (binding.element as HTMLInputElement).indeterminate
      ) collector.add("accessibility_state_unsupported", "error", itemTarget);
      const name = accessibleName(binding.element);
      overflow ||= name.overflow;
      if (!name.overflow && await digest(key, `name:${binding.elementId}`, name.name) !== expected.nameDigest) collector.add("accessible_name_mismatch", "error", itemTarget);
      if (!stateMatchesExpected(await manifestState(key, binding.elementId, stateOf(binding.element)), expected.state)) collector.add("dom_state_mismatch", "error", itemTarget);
    }

    let domNodesVisited = 0;
    const ownerDocument = nodeType(root) === 9 ? root as Document : root.ownerDocument;
    if (!ownerDocument) invalidInput();
    const walker = ownerDocument.createTreeWalker(root as Node, 0x1);
    let element: Node | null = nodeType(root) === 1 ? root as Node : walker.nextNode();
    while (element) {
      if (++domNodesVisited > LIMIT.domNodes) { overflow = true; break; }
      if (isElement(element)) {
        if (element.tagName === "IFRAME" || element.shadowRoot) {
          collector.add("nested_surface_unobserved", "error", target("dom-control", domNodesVisited - 1));
        }
        const visibility = visibleWithinBudget(element);
        overflow ||= visibility.overflow;
        if (visibility.visible &&
          (NATIVE_CONTROL_TAGS.has(element.tagName) || CONTROL_ROLES.has(roleOf(element))) &&
          !mappedElements.has(element)) {
          collector.add("visible_control_unmapped", "error", target("dom-control", domNodesVisited - 1));
        }
      }
      element = walker.nextNode();
    }
    manifestNodes.forEach((node, index) => {
      if (node.actions.length > 0 && !mappedIds.has(node.id)) collector.add("visible_control_unmapped", "error", target("node", index));
    });

    const currentNodeActions = new Map(
      snapshot.nodes.map((node) => [
        node.id,
        new Set(node.actions.map((action) => action.name)),
      ]),
    );
    declared.bindings.forEach((binding, index) => {
      if (!currentNodeActions.get(binding.elementId)?.has(binding.action)) {
        collector.add(
          "declared_tool_target_missing",
          "error",
          target("binding", index),
        );
      }
    });

    const currentTools = new Map(candidateBody.tools.map((tool) => [tool.name, tool]));
    const expectedToolNames = new Set<string>();
    manifestTools.forEach((raw, index) => {
      assertPlainRecord(raw);
      const name = stringField(raw, "name", 128)!;
      expectedToolNames.add(name);
      const current = currentTools.get(name);
      if (!current) collector.add("declared_tool_missing", "error", target("tool", index));
      else if (current.elementId !== stringField(raw, "elementId", 256) || current.action !== actionField(raw, "action") || current.signature !== stringField(raw, "signature", 80)) collector.add("declared_tool_semantics_mismatch", "critical", target("tool", index));
      const node = manifestNodeIndex.get(stringField(raw, "elementId", 256)!);
      const action = node?.node.actions.find((item) => item.name === actionField(raw, "action"));
      if (action?.risk === "credential") collector.add("credential_tool_declared", "critical", target("tool", index));
    });
    candidateBody.tools.forEach((tool, index) => {
      if (!expectedToolNames.has(tool.name)) collector.add("declared_tool_unexpected", "error", target("tool", index));
    });

    const activeRaw = readActiveTools();
    assertPlainRecord(activeRaw);
    const activeStatus = stringField(activeRaw, "status", 32)! as DriftActiveTools["status"];
    if (!["observed", "unsupported", "not-observed"].includes(activeStatus)) invalidInput();
    if (activeStatus === "observed") {
      const activeArray = captureArray(dataField(activeRaw, "tools"), LIMIT.tools);
      overflow ||= activeArray.overflow;
      const activeTools = activeArray.items.map(captureObservedTool);
      const activeNames = new Set<string>();
      let activeGeneration: number | undefined;
      const expectedByName = new Map(manifestTools.map((tool, index) => [tool.name, { tool, index }]));
      for (let activeIndex = 0; activeIndex < activeTools.length; activeIndex += 1) {
        const tool = activeTools[activeIndex]!;
        const descriptor = tool.descriptor;
        if (activeNames.has(descriptor.name)) invalidInput();
        activeNames.add(descriptor.name);
        const expected = expectedByName.get(descriptor.name);
        if (!expected) collector.add("unexpected_active_tool", "error");
        else {
          const itemTarget = target("tool", expected.index);
          if (
            tool.elementId !== expected.tool.elementId ||
            tool.action !== expected.tool.action
          ) {
            collector.add("active_tool_binding_mismatch", "critical", itemTarget);
          }
          if (
            await digest(key, "surface", tool.surfaceId) !==
              manifest.surfaceDigest
          ) {
            collector.add("active_tool_surface_mismatch", "critical", itemTarget);
          }
          if (
            await digest(key, "revision", tool.revision) !==
              manifest.revisionDigest
          ) {
            collector.add("active_tool_revision_mismatch", "error", itemTarget);
          }
          if (
            await digest(
              key,
              `tool:${descriptor.name}`,
              canonical(descriptorSemantics(descriptor)),
            ) !== expected.tool.signature
          ) {
            collector.add("active_tool_semantics_mismatch", "critical", itemTarget);
          }
        }
        if (activeGeneration === undefined) activeGeneration = tool.generation;
        else if (tool.generation !== activeGeneration) {
          collector.add(
            "active_tool_generation_mismatch",
            "error",
            expected
              ? target("tool", expected.index)
              : target("tool", activeIndex),
          );
        }
      }
      manifestTools.forEach((tool, index) => { if (!activeNames.has(tool.name)) collector.add("active_tool_missing", "error", target("tool", index)); });
    }

    const requiredActions = new Map<string, { elementId: string; action: ManifestAction; index: number }>();
    manifestNodes.forEach((node, nodeIndex) => node.actions.forEach((action, actionIndex) => {
      requiredActions.set(`${node.id}\u0000${action.name}`, { elementId: node.id, action, index: nodeIndex * LIMIT.actionsPerNode + actionIndex });
    }));
    let permissionCount = 0;
    for (const expected of requiredActions.values()) {
      permissionCount += 1;
      const decision = readPermission(freeze({
        elementId: expected.elementId,
        action: expected.action.name,
        principalId,
        originId,
        inputCaseId,
      })) as unknown;
      if (decision === undefined) collector.add("permission_observation_missing", "error", target("action", expected.index));
      else if (!["allow", "deny", "require-confirmation", "unknown"].includes(decision as string)) invalidInput();
      else if (decision === "unknown") collector.add("unknown_permission_evidence", "error", target("action", expected.index));
      else if (decision === "deny") collector.add("denied_action_exposed", "critical", target("action", expected.index));
      else if (decision === "allow" && expected.action.requiresConfirmation) collector.add("confirmation_semantics_mismatch", "critical", target("action", expected.index));
    }

    let applicationStateCount = 0;
    for (const id of mappedIds) {
      const expected = manifestNodeIndex.get(id);
      if (!expected) continue;
      applicationStateCount += 1;
      const rawState = readApplicationState(id) as unknown;
      if (rawState === undefined) {
        collector.add("application_state_observation_missing", "error", target("node", expected.index));
        continue;
      }
      const observed = captureApplicationState(
        rawState,
        Object.keys(expected.node.state).length === 0,
      );
      if (!stateCovers(observed, expected.node.state)) collector.add("application_state_coverage_missing", "error", target("node", expected.index));
      else if (!statesEqual(observed, expected.node.state)) collector.add("application_state_mismatch", "error", target("node", expected.index));
    }

    const liveNavigationDigest = await digest(key, "navigation", ownerDocument.location?.href ?? "");
    if (
      liveNavigationDigest !== manifest.navigationDigest ||
      liveNavigationDigest !== await digest(key, "navigation", snapshot.url)
    ) collector.add("navigation_mismatch", "error");
    const epochAfter = readEpoch();
    if (!Number.isSafeInteger(epochAfter) || epochAfter < epochBefore) invalidInput();
    if (epochBefore !== observationEpoch || epochAfter !== observationEpoch) collector.add("observation_epoch_changed", "error");
    if (overflow) collector.add("resource_budget_exceeded", "error");
    collector.issues.sort((left, right) => canonical(left).localeCompare(canonical(right)));
    const definitive = collector.issues.some((item) => !INCOMPLETE_CODES.has(item.code));
    const incomplete = activeStatus !== "observed" || collector.issues.some((item) => INCOMPLETE_CODES.has(item.code));
    return freeze({
      reportVersion: "0.1" as const,
      status: definitive ? "drifted" as const : incomplete ? "incomplete" as const : "consistent" as const,
      fingerprint,
      coverage: {
        controls: controls.length,
        snapshotNodes: snapshot.nodes.length,
        declaredTools: declared.bindings.length,
        activeTools: activeStatus,
        permissions: permissionCount,
        applicationState: applicationStateCount,
        domNodesVisited: Math.min(domNodesVisited, LIMIT.domNodes),
      },
      truncated: collector.truncated || overflow,
      issues: collector.issues,
    });
  } catch {
    invalidInput();
  }
}
