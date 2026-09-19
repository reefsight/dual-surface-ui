import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsModule, { type FormatsPlugin } from "ajv-formats";

import { AGENT_SNAPSHOT_SCHEMA } from "../schema.js";
import type {
  AgentElementSnapshot,
  AgentSnapshot,
} from "../types.js";
import {
  MAX_DELTA_ACTIONS_PER_NODE,
  MAX_DELTA_BYTES,
  MAX_DELTA_CAPABILITIES,
  MAX_DELTA_OPERATIONS,
  MAX_DELTA_SNAPSHOT_BYTES,
  MAX_DELTA_SNAPSHOT_NODES,
  MAX_DELTA_TOTAL_ACTIONS,
  DeltaCaptureError,
  canonicalSnapshotText,
  canonicalizeNode,
  captureCanonicalSnapshot,
  descriptorSafeCaptureJson,
} from "./canonical.js";
import {
  AGENT_SNAPSHOT_DELTA_SCHEMA,
  AGENT_SNAPSHOT_DELTA_SCHEMA_VERSION,
} from "./schema.js";
import type {
  AgentSnapshotDelta,
  AgentSnapshotDeltaResyncReason,
} from "./types.js";

const addFormats = addFormatsModule as unknown as FormatsPlugin;
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addSchema(AGENT_SNAPSHOT_SCHEMA);

const validateSnapshot = ajv.getSchema(
  AGENT_SNAPSHOT_SCHEMA.$id,
) as ValidateFunction<AgentSnapshot>;
const validateDelta = ajv.compile(
  AGENT_SNAPSHOT_DELTA_SCHEMA,
) as ValidateFunction<AgentSnapshotDelta>;
const encoder = new TextEncoder();

export class DeltaValidationError extends TypeError {
  readonly reason: AgentSnapshotDeltaResyncReason;

  constructor(reason: AgentSnapshotDeltaResyncReason) {
    super("Snapshot delta validation failed");
    this.name = "DeltaValidationError";
    this.reason = reason;
  }
}

export function deltaValidationReason(
  error: unknown,
): AgentSnapshotDeltaResyncReason | undefined {
  if (error instanceof DeltaValidationError) return error.reason;
  if (error instanceof DeltaCaptureError && error.reason === "budget_exceeded") {
    return "budget_exceeded";
  }
  return undefined;
}

const fail = (reason: AgentSnapshotDeltaResyncReason): never => {
  throw new DeltaValidationError(reason);
};

const compareCodeUnits = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const isStrictlySorted = (values: readonly string[]): boolean => {
  for (let index = 1; index < values.length; index += 1) {
    if (compareCodeUnits(values[index - 1]!, values[index]!) >= 0) return false;
  }
  return true;
};

const validateActionNames = (
  node: AgentElementSnapshot,
  names: Set<string>,
  requireCanonicalOrder = false,
): number => {
  if (node.actions.length > MAX_DELTA_ACTIONS_PER_NODE) fail("budget_exceeded");
  names.clear();
  for (const action of node.actions) {
    if (names.has(action.name)) fail("invalid_delta");
    names.add(action.name);
    if (
      requireCanonicalOrder &&
      (
        (action.preconditions !== undefined && !isStrictlySorted(action.preconditions)) ||
        (action.effects !== undefined && !isStrictlySorted(action.effects))
      )
    ) fail("invalid_delta");
  }
  if (requireCanonicalOrder && !isStrictlySorted(node.actions.map((action) => action.name))) {
    fail("invalid_delta");
  }
  return node.actions.length;
};

const validateSnapshotInvariants = (snapshot: AgentSnapshot): void => {
  if (snapshot.nodes.length > MAX_DELTA_SNAPSHOT_NODES) fail("budget_exceeded");
  if (snapshot.capabilities.length > MAX_DELTA_CAPABILITIES) fail("budget_exceeded");

  const capabilities = new Set(snapshot.capabilities);
  if (capabilities.size !== snapshot.capabilities.length) {
    throw new TypeError("Invalid snapshot");
  }

  const nodeIds = new Set<string>();
  const actionNames = new Set<string>();
  let actions = 0;
  for (const node of snapshot.nodes) {
    if (nodeIds.has(node.id)) throw new TypeError("Invalid snapshot");
    nodeIds.add(node.id);
    actions += validateActionNames(node, actionNames, true);
    if (actions > MAX_DELTA_TOTAL_ACTIONS) fail("budget_exceeded");
  }
  if (
    snapshot.focusedElementId !== undefined &&
    !nodeIds.has(snapshot.focusedElementId)
  ) {
    throw new TypeError("Invalid snapshot");
  }
};

export function assertSnapshotWithinBudget(snapshot: AgentSnapshot): void {
  validateSnapshotInvariants(snapshot);
  if (encoder.encode(canonicalSnapshotText(snapshot)).byteLength > MAX_DELTA_SNAPSHOT_BYTES) {
    fail("budget_exceeded");
  }
}

export function captureAndValidateSnapshot(value: unknown): AgentSnapshot {
  const snapshot = captureCanonicalSnapshot(value);
  if (!validateSnapshot(snapshot)) throw new TypeError("Invalid snapshot");
  assertSnapshotWithinBudget(snapshot);
  return snapshot;
}

const validateDeltaNodeInvariants = (delta: AgentSnapshotDelta): void => {
  if (
    delta.nodeUpserts.length + delta.removedNodeIds.length >
    MAX_DELTA_OPERATIONS
  ) fail("budget_exceeded");
  if (delta.target.capabilities.length > MAX_DELTA_CAPABILITIES) {
    fail("budget_exceeded");
  }

  const upsertIds = new Set<string>();
  const actionNames = new Set<string>();
  let actions = 0;
  for (const node of delta.nodeUpserts) {
    if (upsertIds.has(node.id)) fail("invalid_delta");
    upsertIds.add(node.id);
    let canonical: AgentElementSnapshot;
    try {
      canonical = canonicalizeNode(node);
    } catch {
      return fail("invalid_delta");
    }
    if (
      JSON.stringify(descriptorSafeCaptureJson(canonical)) !==
      JSON.stringify(node)
    ) fail("invalid_delta");
    actions += validateActionNames(node, actionNames, true);
    if (actions > MAX_DELTA_TOTAL_ACTIONS) fail("budget_exceeded");
  }

  const removals = new Set(delta.removedNodeIds);
  if (removals.size !== delta.removedNodeIds.length) fail("invalid_delta");
  for (const id of removals) {
    if (upsertIds.has(id)) fail("invalid_delta");
  }

  if (!isStrictlySorted(delta.nodeUpserts.map((node) => node.id))) {
    fail("invalid_delta");
  }
  if (!isStrictlySorted(delta.removedNodeIds)) fail("invalid_delta");
  if (!isStrictlySorted(delta.target.capabilities)) fail("invalid_delta");
};

export function validateDeltaSemantics(
  delta: AgentSnapshotDelta,
  base?: AgentSnapshot,
): void {
  if (
    delta.schemaVersion !== AGENT_SNAPSHOT_DELTA_SCHEMA_VERSION ||
    delta.baseRevision === delta.revision
  ) fail(delta.baseRevision === delta.revision ? "revision_collision" : "invalid_delta");

  validateDeltaNodeInvariants(delta);
  if (!base) return;

  const baseIds = new Set(base.nodes.map((node) => node.id));
  for (const id of delta.removedNodeIds) {
    if (!baseIds.has(id)) fail("invalid_delta");
    baseIds.delete(id);
  }
  for (const node of delta.nodeUpserts) baseIds.add(node.id);
  if (
    delta.target.focusedElementId !== null &&
    !baseIds.has(delta.target.focusedElementId)
  ) fail("invalid_delta");
};

export function assertDeltaWithinBudget(delta: AgentSnapshotDelta): void {
  validateDeltaNodeInvariants(delta);
  const text = JSON.stringify(delta);
  if (encoder.encode(text).byteLength > MAX_DELTA_BYTES) fail("budget_exceeded");
}

export function captureAndValidateDelta(value: unknown): AgentSnapshotDelta {
  let captured: unknown;
  try {
    captured = descriptorSafeCaptureJson(value);
  } catch (error) {
    if (error instanceof DeltaValidationError) throw error;
    if (error instanceof DeltaCaptureError && error.reason === "budget_exceeded") {
      return fail("budget_exceeded");
    }
    return fail("invalid_delta");
  }
  if (!validateDelta(captured)) {
    if (validateDelta.errors?.some((error) => error.keyword === "maxItems")) {
      fail("budget_exceeded");
    }
    fail("invalid_delta");
  }
  const delta = captured as AgentSnapshotDelta;
  validateDeltaSemantics(delta);
  assertDeltaWithinBudget(delta);
  return delta;
}
