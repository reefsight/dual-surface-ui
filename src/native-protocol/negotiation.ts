import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";

import {
  descriptorSafeCaptureJson,
  type CanonicalJson,
} from "../delta/canonical.js";
import {
  NATIVE_PROTOCOL_CAPABILITIES,
  NATIVE_PROTOCOL_CLIENT_HELLO_SCHEMA,
  NATIVE_PROTOCOL_LIMITS,
  NATIVE_PROTOCOL_SCHEMA_VERSION,
  NATIVE_PROTOCOL_VERSION,
} from "./schema.js";
import type {
  NativeProtocolCapability,
  NativeProtocolClientHello,
  NativeProtocolError,
  NativeProtocolErrorCode,
  NativeProtocolNegotiationOptions,
  NativeProtocolNegotiationResult,
  NativeProtocolServerHello,
} from "./types.js";

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9._~-]{1,128}$/;
const CAPABILITY_SET = new Set<string>(NATIVE_PROTOCOL_CAPABILITIES);
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateClientHello = ajv.compile(
  NATIVE_PROTOCOL_CLIENT_HELLO_SCHEMA,
) as ValidateFunction<NativeProtocolClientHello>;

const capture = (value: unknown): CanonicalJson =>
  descriptorSafeCaptureJson(value, {
    maxDepth: 8,
    maxNodes: 128,
    maxCharacters: 8_192,
    maxStringLength: 128,
    maxPropertiesPerObject: 16,
  });

const protocolError = (
  requestId: string | null,
  code: NativeProtocolErrorCode,
): NativeProtocolError => Object.freeze({
  schemaVersion: NATIVE_PROTOCOL_SCHEMA_VERSION,
  kind: "protocol-error",
  requestId,
  code,
  message: code === "invalid_message"
    ? "Invalid native protocol message"
    : code === "no_compatible_version"
      ? "No compatible native protocol version"
      : "Required native protocol capability is unavailable",
});

const reject = (
  requestId: string | null,
  code: NativeProtocolErrorCode,
): NativeProtocolNegotiationResult => Object.freeze({
  status: "rejected",
  message: protocolError(requestId, code),
});

const parseOptions = (
  options: NativeProtocolNegotiationOptions,
): { sessionRef: string; capabilities: readonly NativeProtocolCapability[] } => {
  let captured: CanonicalJson;
  try {
    captured = capture(options);
  } catch {
    throw new TypeError("Invalid native protocol negotiation options");
  }
  if (!captured || Array.isArray(captured) || typeof captured !== "object") {
    throw new TypeError("Invalid native protocol negotiation options");
  }
  const record = captured as { readonly [key: string]: CanonicalJson };
  const keys = Object.keys(record);
  if (
    keys.length !== 2 ||
    !keys.includes("sessionRef") ||
    !keys.includes("capabilities")
  ) {
    throw new TypeError("Invalid native protocol negotiation options");
  }
  const sessionRef = record.sessionRef;
  const capabilities = record.capabilities;
  if (
    typeof sessionRef !== "string" ||
    !OPAQUE_ID_PATTERN.test(sessionRef) ||
    !Array.isArray(capabilities) ||
    capabilities.length > NATIVE_PROTOCOL_CAPABILITIES.length ||
    capabilities.some((item) => typeof item !== "string" || !CAPABILITY_SET.has(item)) ||
    new Set(capabilities).size !== capabilities.length
  ) {
    throw new TypeError("Invalid native protocol negotiation options");
  }
  return {
    sessionRef,
    capabilities: Object.freeze(
      [...capabilities].sort() as NativeProtocolCapability[],
    ),
  };
};

export function negotiateNativeProtocol(
  message: unknown,
  options: NativeProtocolNegotiationOptions,
): NativeProtocolNegotiationResult {
  const server = parseOptions(options);
  let captured: CanonicalJson;
  try {
    captured = capture(message);
  } catch {
    return reject(null, "invalid_message");
  }
  if (!validateClientHello(captured)) return reject(null, "invalid_message");
  const hello = captured as unknown as NativeProtocolClientHello;
  if (
    hello.requiredCapabilities.some(
      (capability) => !hello.capabilities.includes(capability),
    )
  ) {
    return reject(hello.requestId, "invalid_message");
  }
  if (!hello.supportedVersions.includes(NATIVE_PROTOCOL_VERSION)) {
    return reject(hello.requestId, "no_compatible_version");
  }
  const selected = Object.freeze(
    server.capabilities.filter((capability) =>
      hello.capabilities.includes(capability)
    ),
  );
  if (
    hello.requiredCapabilities.some(
      (capability) => !selected.includes(capability),
    )
  ) {
    return reject(hello.requestId, "missing_required_capability");
  }
  const response: NativeProtocolServerHello = Object.freeze({
    schemaVersion: NATIVE_PROTOCOL_SCHEMA_VERSION,
    kind: "server-hello",
    requestId: hello.requestId,
    sessionRef: server.sessionRef,
    protocolVersion: NATIVE_PROTOCOL_VERSION,
    capabilities: selected,
    limits: NATIVE_PROTOCOL_LIMITS,
  });
  return Object.freeze({ status: "accepted", message: response });
}
