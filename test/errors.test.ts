import { describe, expect, it } from "vitest";

import {
  AgentActionNotFoundError,
  AgentAuthorizationRequiredError,
  AgentDuplicateElementIdError,
  AgentElementNotFoundError,
  AgentError,
  AgentInputValidationError,
  AgentStaleRevisionError,
  AgentSurfaceMismatchError,
} from "../src/index.js";

describe("stable agent errors", () => {
  it.each([
    [new AgentElementNotFoundError("missing"), "element_not_found"],
    [new AgentActionNotFoundError("missing"), "action_not_found"],
    [new AgentAuthorizationRequiredError("denied"), "authorization_required"],
    [new AgentDuplicateElementIdError("duplicate"), "duplicate_element_id"],
    [new AgentSurfaceMismatchError("wrong surface"), "surface_mismatch"],
    [new AgentStaleRevisionError("stale"), "stale_revision"],
    [new AgentInputValidationError("submit"), "invalid_input"],
  ] as const)("maps %s to %s", (error, code) => {
    expect(error).toBeInstanceOf(AgentError);
    expect(error.code).toBe(code);
    expect(error.name).toBe(error.constructor.name);
  });
});
