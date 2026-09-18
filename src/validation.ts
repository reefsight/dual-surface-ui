import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsModule, { type FormatsPlugin } from "ajv-formats";

import {
  AgentInputValidationError,
  AgentOutputValidationError,
} from "./errors.js";
import type { AgentActionSnapshot, AgentJsonValue } from "./types.js";

const ajv = new Ajv2020({ allErrors: true, strict: true });
const addFormats = addFormatsModule as unknown as FormatsPlugin;
addFormats(ajv);

const validators = new WeakMap<object, ValidateFunction>();

export function validateActionInput(
  action: AgentActionSnapshot,
  input: unknown,
): void {
  if (!action.inputSchema) return;

  try {
    let validate = validators.get(action.inputSchema);
    if (!validate) {
      const compiled = ajv.compile(action.inputSchema);
      validators.set(action.inputSchema, compiled);
      validate = compiled;
    }

    if (!validate(input)) {
      throw new AgentInputValidationError(action.name);
    }
  } catch (error) {
    if (error instanceof AgentInputValidationError) throw error;
    throw new AgentInputValidationError(action.name);
  }
}

function isJsonValue(value: unknown, seen: Set<object>): value is AgentJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (seen.has(value)) return false;

  seen.add(value);
  let valid = true;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value) || !isJsonValue(value[index], seen)) {
        valid = false;
        break;
      }
    }
  } else {
    const prototype = Object.getPrototypeOf(value);
    valid =
      (prototype === Object.prototype || prototype === null) &&
      Object.values(value).every((item) => isJsonValue(item, seen));
  }
  seen.delete(value);
  return valid;
}

export function validateActionOutput(
  action: AgentActionSnapshot,
  output: unknown,
): AgentJsonValue {
  if (!action.outputSchema) {
    throw new AgentOutputValidationError(action.name);
  }

  let normalized: AgentJsonValue;
  try {
    if (!isJsonValue(output, new Set())) {
      throw new AgentOutputValidationError(action.name);
    }
    normalized = JSON.parse(JSON.stringify(output)) as AgentJsonValue;
    let validate = validators.get(action.outputSchema);
    if (!validate) {
      const compiled = ajv.compile(action.outputSchema);
      validators.set(action.outputSchema, compiled);
      validate = compiled;
    }
    if (!validate(normalized)) {
      throw new AgentOutputValidationError(action.name);
    }
  } catch (error) {
    if (error instanceof AgentOutputValidationError) throw error;
    throw new AgentOutputValidationError(action.name);
  }

  return normalized;
}
