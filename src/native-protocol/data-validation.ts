import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsModule, { type FormatsPlugin } from "ajv-formats";

import {
  MAX_DELTA_ACTIONS_PER_NODE,
  MAX_DELTA_OPERATIONS,
  MAX_DELTA_SNAPSHOT_NODES,
  descriptorSafeCaptureJson,
  deepFreezeJson,
  captureCanonicalSnapshot,
  type CanonicalJson,
} from "../delta/canonical.js";
import { AGENT_SNAPSHOT_DELTA_SCHEMA } from "../delta/schema.js";
import { AGENT_SNAPSHOT_SCHEMA } from "../schema.js";
import type { AgentElementSnapshot, AgentSnapshot } from "../types.js";
import { NATIVE_PROTOCOL_DATA_SCHEMA } from "./data-schema.js";
import { NATIVE_PROTOCOL_LIMITS } from "./schema.js";
import type {
  NativeProtocolDataMessage,
  NativeProtocolDeltaResponse,
  NativeProtocolSnapshotResponse,
  NativeProtocolSurfaceEntry,
  NativeProtocolSurfaceListResponse,
} from "./types.js";

const addFormats = addFormatsModule as unknown as FormatsPlugin;
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addSchema(AGENT_SNAPSHOT_SCHEMA);
ajv.addSchema(AGENT_SNAPSHOT_DELTA_SCHEMA);
const validateDataMessage = ajv.compile(
  NATIVE_PROTOCOL_DATA_SCHEMA,
) as ValidateFunction<NativeProtocolDataMessage>;
const encoder = new TextEncoder();

const invalid = (): never => {
  throw new TypeError("Invalid native protocol data message");
};

const compareCodeUnits = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const isStrictlySorted = (values: readonly string[]): boolean => {
  for (let index = 1; index < values.length; index += 1) {
    if (compareCodeUnits(values[index - 1]!, values[index]!) >= 0) return false;
  }
  return true;
};

const validateActionOrder = (node: AgentElementSnapshot): number => {
  if (node.actions.length > MAX_DELTA_ACTIONS_PER_NODE) invalid();
  if (!isStrictlySorted(node.actions.map((action) => action.name))) invalid();
  for (const action of node.actions) {
    if (
      (action.preconditions !== undefined && !isStrictlySorted(action.preconditions)) ||
      (action.effects !== undefined && !isStrictlySorted(action.effects))
    ) invalid();
  }
  return node.actions.length;
};

const validateSnapshot = (message: NativeProtocolSnapshotResponse): void => {
  const canonical: AgentSnapshot = (() => {
    try {
      return captureCanonicalSnapshot(message.snapshot);
    } catch {
      return invalid();
    }
  })();
  if (
    canonical.surfaceId !== message.surfaceRef ||
    canonical.revision.length > 128 ||
    canonical.nodes.length > MAX_DELTA_SNAPSHOT_NODES
  ) invalid();
  let actions = 0;
  for (const node of canonical.nodes) actions += validateActionOrder(node);
  if (actions > NATIVE_PROTOCOL_LIMITS.actionsPerSurface) invalid();
};

const validateCatalog = (message: NativeProtocolSurfaceListResponse): void => {
  const refs = message.surfaces.map((surface) => surface.surfaceRef);
  if (!isStrictlySorted(refs)) invalid();
  for (const surface of message.surfaces) validateSurfaceEntry(surface);
};

const validateSurfaceEntry = (surface: NativeProtocolSurfaceEntry): void => {
  if (!isStrictlySorted(surface.capabilities)) invalid();
};

const validateDelta = (message: NativeProtocolDeltaResponse): void => {
  const delta = message.delta;
  if (
    delta.surfaceId !== message.surfaceRef ||
    delta.baseRevision === delta.revision ||
    delta.baseRevision.length > 128 ||
    delta.revision.length > 128 ||
    delta.nodeUpserts.length + delta.removedNodeIds.length > MAX_DELTA_OPERATIONS ||
    !isStrictlySorted(delta.nodeUpserts.map((node) => node.id)) ||
    !isStrictlySorted(delta.removedNodeIds) ||
    !isStrictlySorted(delta.target.capabilities)
  ) invalid();

  const upserts = new Set<string>();
  let actions = 0;
  for (const node of delta.nodeUpserts) {
    if (upserts.has(node.id)) invalid();
    upserts.add(node.id);
    actions += validateActionOrder(node);
  }
  if (actions > NATIVE_PROTOCOL_LIMITS.actionsPerSurface) invalid();
  for (const removed of delta.removedNodeIds) {
    if (upserts.has(removed)) invalid();
  }
};

const encodedBytes = (value: CanonicalJson): number =>
  encoder.encode(JSON.stringify(value)).byteLength;

export function captureAndValidateNativeProtocolDataMessage(
  value: unknown,
): NativeProtocolDataMessage {
  const captured: CanonicalJson = (() => {
    try {
      return descriptorSafeCaptureJson(value, {
        maxDepth: 64,
        maxNodes: 100_000,
        maxCharacters: NATIVE_PROTOCOL_LIMITS.frameBytes,
        maxStringLength: 8_192,
        maxPropertiesPerObject: 4_096,
      });
    } catch {
      return invalid();
    }
  })();
  if (!validateDataMessage(captured)) invalid();
  const message = captured as unknown as NativeProtocolDataMessage;
  const bytes = encodedBytes(captured);
  if (bytes > NATIVE_PROTOCOL_LIMITS.frameBytes) invalid();

  switch (message.kind) {
    case "surface-list-response":
      validateCatalog(message);
      break;
    case "snapshot-response":
      validateSnapshot(message);
      if (bytes > NATIVE_PROTOCOL_LIMITS.snapshotBytes) invalid();
      break;
    case "delta-response":
      validateDelta(message);
      if (bytes > NATIVE_PROTOCOL_LIMITS.deltaBytes) invalid();
      break;
    default:
      break;
  }
  return deepFreezeJson(message);
}
