import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";

import {
  deepFreezeJson,
  descriptorSafeCaptureJson,
  type CanonicalJson,
} from "../delta/canonical.js";
import {
  AGENT_ACTION_FAILURE_SCHEMA,
  AGENT_ACTION_RESULT_SCHEMA,
} from "../schema.js";
import {
  NATIVE_PROTOCOL_EXECUTION_SCHEMA,
  NATIVE_PROTOCOL_REQUEST_ERROR_MESSAGES,
} from "./execution-schema.js";
import { NATIVE_PROTOCOL_LIMITS } from "./schema.js";
import type {
  NativeProtocolActionResponse,
  NativeProtocolExecutionMessage,
  NativeProtocolRequestError,
} from "./types.js";

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(AGENT_ACTION_RESULT_SCHEMA);
ajv.addSchema(AGENT_ACTION_FAILURE_SCHEMA);
const validateExecutionMessage = ajv.compile(
  NATIVE_PROTOCOL_EXECUTION_SCHEMA,
) as ValidateFunction<NativeProtocolExecutionMessage>;
const encoder = new TextEncoder();

const invalid = (): never => {
  throw new TypeError("Invalid native protocol execution message");
};

const validateActionResponse = (message: NativeProtocolActionResponse): void => {
  const outcome = message.outcome;
  if (
    outcome.surfaceId !== message.surfaceRef ||
    outcome.revision.length > 128
  ) invalid();
  if (outcome.status === "succeeded") {
    if (
      outcome.previousRevision.length > 128 ||
      outcome.action.length > 128 ||
      outcome.targetId.length > 128 ||
      (outcome.node?.actions.length ?? 0) > NATIVE_PROTOCOL_LIMITS.actionsPerSurface
    ) invalid();
  }
};

const validateRequestError = (message: NativeProtocolRequestError): void => {
  if (message.message !== NATIVE_PROTOCOL_REQUEST_ERROR_MESSAGES[message.code]) {
    invalid();
  }
};

export function captureAndValidateNativeProtocolExecutionMessage(
  value: unknown,
): NativeProtocolExecutionMessage {
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
  if (!validateExecutionMessage(captured)) invalid();
  const message = captured as unknown as NativeProtocolExecutionMessage;
  const bytes = encoder.encode(JSON.stringify(captured)).byteLength;
  if (bytes > NATIVE_PROTOCOL_LIMITS.frameBytes) invalid();

  if (message.kind === "action-response") {
    validateActionResponse(message);
    if (bytes > NATIVE_PROTOCOL_LIMITS.actionResultBytes) invalid();
  } else if (message.kind === "request-error") {
    validateRequestError(message);
  }
  return deepFreezeJson(message);
}
