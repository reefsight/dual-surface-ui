import {
  DeltaCaptureError,
  descriptorSafeCaptureJson,
  type CanonicalJson,
} from "../../src/delta/canonical.js";
import type { ConformanceDigest } from "./types.js";

export const CONFORMANCE_CAPTURE_BUDGET = Object.freeze({
  maxDepth: 64,
  maxNodes: 250_000,
  maxCharacters: 1_048_576,
  maxStringLength: 32_768,
  maxPropertiesPerObject: 4_096,
});

export class ConformanceValidationError extends TypeError {
  constructor(readonly reason: string) {
    super("Conformance artifact validation failed");
    this.name = "ConformanceValidationError";
  }
}

export function captureConformanceJson(value: unknown): CanonicalJson {
  try {
    return descriptorSafeCaptureJson(value, CONFORMANCE_CAPTURE_BUDGET);
  } catch (error) {
    if (error instanceof DeltaCaptureError && error.reason === "budget_exceeded") {
      throw new ConformanceValidationError("budget_exceeded");
    }
    throw new ConformanceValidationError("invalid_json");
  }
}

export function canonicalConformanceJson(value: unknown): string {
  return JSON.stringify(captureConformanceJson(value));
}

export function canonicalConformanceBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalConformanceJson(value));
}

export async function digestConformanceValue(
  domain: string,
  value: unknown,
): Promise<ConformanceDigest> {
  const bytes = new TextEncoder().encode(`${domain}${canonicalConformanceJson(value)}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hex}`;
}

export function withoutTopLevelField(value: CanonicalJson, field: string): CanonicalJson {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new ConformanceValidationError("invalid_artifact");
  }
  const result: Record<string, CanonicalJson> = {};
  for (const [key, item] of Object.entries(value)) if (key !== field) result[key] = item;
  return Object.freeze(result);
}

export function assertExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  if (required.some((key) => !Object.hasOwn(value, key)) || keys.some((key) => !allowed.has(key))) {
    throw new ConformanceValidationError("invalid_shape");
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const isDigest = (value: unknown): value is ConformanceDigest =>
  typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
