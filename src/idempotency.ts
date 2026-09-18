import {
  AgentIdempotencyUnavailableError,
  AgentInputValidationError,
  AgentInvalidIdempotencyKeyError,
} from "./errors.js";
import type { AgentActionRequest, AgentPrincipal } from "./types.js";

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~-]{1,128}$/;

export function assertIdempotencyKeySyntax(key: string): void {
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new AgentInvalidIdempotencyKeyError();
  }
}

function canonicalJson(value: unknown, seen: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (typeof value !== "object" || seen.has(value)) {
    throw new TypeError("Value is not canonical JSON");
  }

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const ownKeys = Reflect.ownKeys(value);
      if (
        ownKeys.some(
          (key) =>
            typeof key === "symbol" ||
            (key !== "length" && !/^(0|[1-9]\d*)$/.test(key)),
        )
      ) {
        throw new TypeError("Arrays cannot have custom properties");
      }
      const items: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !("value" in descriptor)) {
          throw new TypeError("Sparse or accessor arrays are invalid");
        }
        items.push(canonicalJson(descriptor.value, seen));
      }
      return `[${items.join(",")}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Only plain objects are supported");
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError("Symbol properties are invalid");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const entries = Object.keys(descriptors)
      .sort()
      .map((key) => {
        const descriptor = descriptors[key]!;
        if (!descriptor.enumerable || !("value" in descriptor)) {
          throw new TypeError("Only enumerable data properties are supported");
        }
        return `${JSON.stringify(key)}:${canonicalJson(descriptor.value, seen)}`;
      });
    return `{${entries.join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

export async function fingerprintActionRequest(
  request: AgentActionRequest,
  principal: AgentPrincipal | undefined,
  origin: string,
): Promise<string> {
  let canonical: string;
  try {
    canonical = canonicalJson(
      {
        action: request.action,
        elementId: request.elementId,
        origin,
        principal: principal
          ? { id: principal.id, roles: [...(principal.roles ?? [])].sort() }
          : null,
        revision: request.revision,
        surfaceId: request.surfaceId,
        ...(request.input !== undefined ? { input: request.input } : {}),
      },
      new Set(),
    );
  } catch {
    throw new AgentInputValidationError(request.action);
  }

  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new AgentIdempotencyUnavailableError();
  const digest = await subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
