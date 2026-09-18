import { describe, expect, it } from "vitest";

import {
  AgentActionNotFoundError,
  AgentAuthorizationRequiredError,
  AgentConfirmationRequiredError,
  AgentDuplicateElementIdError,
  AgentElementNotFoundError,
  AgentError,
  AgentInputValidationError,
  AgentIdempotencyConflictError,
  AgentIdempotencyKeyRequiredError,
  AgentIdempotencyUnavailableError,
  AgentInvalidIdempotencyKeyError,
  AgentInvalidPolicyDecisionError,
  AgentOutputValidationError,
  AgentPreconditionFailedError,
  AgentStaleRevisionError,
  AgentSurfaceMismatchError,
  AgentVerificationFailedError,
  normalizeAgentFailure,
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
    [
      new AgentIdempotencyKeyRequiredError("submit"),
      "idempotency_key_required",
    ],
    [new AgentInvalidIdempotencyKeyError(), "invalid_idempotency_key"],
    [new AgentIdempotencyConflictError(), "idempotency_conflict"],
    [new AgentIdempotencyUnavailableError(), "idempotency_unavailable"],
    [new AgentConfirmationRequiredError("submit"), "confirmation_required"],
    [new AgentInvalidPolicyDecisionError(), "invalid_policy_decision"],
    [new AgentOutputValidationError("submit"), "invalid_output"],
    [new AgentPreconditionFailedError("submit"), "precondition_failed"],
    [new AgentVerificationFailedError("submit"), "verification_failed"],
  ] as const)("maps %s to %s", (error, code) => {
    expect(error).toBeInstanceOf(AgentError);
    expect(error.code).toBe(code);
    expect(error.name).toBe(error.constructor.name);
    expect(normalizeAgentFailure(error)).toEqual({
      code,
      message: expect.any(String),
    });
  });

  it("normalizes unknown and hostile thrown values without inspecting payloads", () => {
    const secret = "never-serialize-this";
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error(secret);
        },
      },
    );

    const normalized = normalizeAgentFailure(hostile);

    expect(normalized).toEqual({
      code: "internal_error",
      message: "The action failed unexpectedly",
    });
    expect(JSON.stringify(normalized)).not.toContain(secret);
  });
});
