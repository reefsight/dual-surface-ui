import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsModule, { type FormatsPlugin } from "ajv-formats";

import { AgentInputValidationError } from "./errors.js";
import type { AgentActionSnapshot } from "./types.js";

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
