import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsModule, { type FormatsPlugin } from "ajv-formats";

import {
  deepFreezeJson,
  descriptorSafeCaptureJson,
  type CanonicalJson,
} from "../delta/canonical.js";
import { AGENT_SNAPSHOT_DELTA_SCHEMA } from "../delta/schema.js";
import {
  AGENT_ACTION_FAILURE_SCHEMA,
  AGENT_ACTION_RESULT_SCHEMA,
  AGENT_SNAPSHOT_SCHEMA,
} from "../schema.js";
import {
  NATIVE_PROTOCOL_DATA_SCHEMA,
  NATIVE_PROTOCOL_MESSAGE_SCHEMA,
} from "./data-schema.js";
import { captureAndValidateNativeProtocolDataMessage } from "./data-validation.js";
import { NATIVE_PROTOCOL_EXECUTION_SCHEMA } from "./execution-schema.js";
import { captureAndValidateNativeProtocolExecutionMessage } from "./execution-validation.js";
import {
  NATIVE_PROTOCOL_ERROR_MESSAGES,
  NATIVE_PROTOCOL_HANDSHAKE_SCHEMA,
  NATIVE_PROTOCOL_LIMITS,
} from "./schema.js";
import type {
  NativeProtocolClientHello,
  NativeProtocolMessage,
  NativeProtocolServerHello,
} from "./types.js";

const addFormats = addFormatsModule as unknown as FormatsPlugin;
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
for (const schema of [
  AGENT_SNAPSHOT_SCHEMA,
  AGENT_SNAPSHOT_DELTA_SCHEMA,
  AGENT_ACTION_RESULT_SCHEMA,
  AGENT_ACTION_FAILURE_SCHEMA,
  NATIVE_PROTOCOL_HANDSHAKE_SCHEMA,
  NATIVE_PROTOCOL_DATA_SCHEMA,
  NATIVE_PROTOCOL_EXECUTION_SCHEMA,
]) ajv.addSchema(schema);
const validateMessage = ajv.compile(
  NATIVE_PROTOCOL_MESSAGE_SCHEMA,
) as ValidateFunction<NativeProtocolMessage>;
const encoder = new TextEncoder();

const invalid = (): never => {
  throw new TypeError("Invalid native protocol message");
};

const isStrictlySorted = (values: readonly string[]): boolean => {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1]! >= values[index]!) return false;
  }
  return true;
};

const validateClientHello = (message: NativeProtocolClientHello): void => {
  if (
    message.requiredCapabilities.some(
      (capability) => !message.capabilities.includes(capability),
    )
  ) invalid();
};

const validateServerHello = (message: NativeProtocolServerHello): void => {
  if (!isStrictlySorted(message.capabilities)) invalid();
};

const DATA_KINDS = new Set([
  "surface-list-request",
  "surface-list-response",
  "snapshot-request",
  "snapshot-response",
  "delta-request",
  "delta-response",
]);
const EXECUTION_KINDS = new Set([
  "action-request",
  "action-response",
  "cancel-request",
  "cancel-response",
  "request-error",
  "event",
]);

export function captureAndValidateNativeProtocolMessage(
  value: unknown,
): NativeProtocolMessage {
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
  if (
    encoder.encode(JSON.stringify(captured)).byteLength >
      NATIVE_PROTOCOL_LIMITS.frameBytes ||
    !validateMessage(captured)
  ) invalid();
  const message = captured as unknown as NativeProtocolMessage;

  if (DATA_KINDS.has(message.kind)) {
    return captureAndValidateNativeProtocolDataMessage(message);
  }
  if (EXECUTION_KINDS.has(message.kind)) {
    return captureAndValidateNativeProtocolExecutionMessage(message);
  }
  if (message.kind === "client-hello") validateClientHello(message);
  if (message.kind === "server-hello") validateServerHello(message);
  if (
    message.kind === "protocol-error" &&
    message.message !== NATIVE_PROTOCOL_ERROR_MESSAGES[message.code]
  ) invalid();
  return deepFreezeJson(message);
}
