export const AGENT_ERROR_CODES = [
  "element_not_found",
  "action_not_found",
  "authorization_required",
  "duplicate_element_id",
  "surface_mismatch",
  "stale_revision",
  "invalid_input",
  "confirmation_required",
  "invalid_policy_decision",
  "precondition_failed",
  "verification_failed",
  "invalid_output",
  "idempotency_key_required",
  "invalid_idempotency_key",
  "idempotency_conflict",
  "idempotency_unavailable",
] as const;

export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[number];

export const AGENT_FAILURE_CODES = [
  ...AGENT_ERROR_CODES,
  "internal_error",
] as const;

export type AgentFailureCode = (typeof AGENT_FAILURE_CODES)[number];

export interface AgentFailureDetail {
  code: AgentFailureCode;
  message: string;
}

export const AGENT_FAILURE_MESSAGES = {
  element_not_found: "The target element was not found",
  action_not_found: "The requested action is unavailable",
  authorization_required: "The action is not authorized",
  duplicate_element_id: "The surface contains duplicate element identifiers",
  surface_mismatch: "The request targets a different surface",
  stale_revision: "The observed surface revision is stale",
  invalid_input: "The action input is invalid",
  confirmation_required: "The action requires trusted confirmation",
  invalid_policy_decision: "The policy decision is invalid",
  precondition_failed: "An action precondition was not satisfied",
  verification_failed: "The action effects could not be verified",
  invalid_output: "The action output is invalid",
  idempotency_key_required: "The action requires an idempotency key",
  invalid_idempotency_key: "The idempotency key is invalid",
  idempotency_conflict:
    "The idempotency key conflicts with an earlier request",
  idempotency_unavailable: "Secure idempotency protection is unavailable",
  internal_error: "The action failed unexpectedly",
} as const satisfies Record<AgentFailureCode, string>;

export class AgentError extends Error {
  readonly code: AgentErrorCode;

  constructor(code: AgentErrorCode, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class AgentElementNotFoundError extends AgentError {
  constructor(message: string) {
    super("element_not_found", message);
  }
}

export class AgentActionNotFoundError extends AgentError {
  constructor(message: string) {
    super("action_not_found", message);
  }
}

export class AgentAuthorizationRequiredError extends AgentError {
  constructor(message: string) {
    super("authorization_required", message);
  }
}

export class AgentDuplicateElementIdError extends AgentError {
  constructor(message: string) {
    super("duplicate_element_id", message);
  }
}

export class AgentSurfaceMismatchError extends AgentError {
  constructor(message: string) {
    super("surface_mismatch", message);
  }
}

export class AgentStaleRevisionError extends AgentError {
  constructor(message: string) {
    super("stale_revision", message);
  }
}

export class AgentInputValidationError extends AgentError {
  constructor(actionName: string) {
    super("invalid_input", `Input for action "${actionName}" is invalid`);
  }
}

export class AgentConfirmationRequiredError extends AgentError {
  constructor(actionName: string) {
    super(
      "confirmation_required",
      `Action "${actionName}" requires trusted confirmation`,
    );
  }
}

export class AgentInvalidPolicyDecisionError extends AgentError {
  constructor() {
    super("invalid_policy_decision", "Policy returned an invalid decision");
  }
}

export class AgentPreconditionFailedError extends AgentError {
  constructor(actionName: string) {
    super(
      "precondition_failed",
      `A precondition for action "${actionName}" was not satisfied`,
    );
  }
}

export class AgentVerificationFailedError extends AgentError {
  constructor(actionName: string) {
    super(
      "verification_failed",
      `The effects of action "${actionName}" could not be verified`,
    );
  }
}

export class AgentOutputValidationError extends AgentError {
  constructor(actionName: string) {
    super("invalid_output", `Output for action "${actionName}" is invalid`);
  }
}

export class AgentIdempotencyKeyRequiredError extends AgentError {
  constructor(actionName: string) {
    super(
      "idempotency_key_required",
      `Action "${actionName}" requires an idempotency key`,
    );
  }
}

export class AgentInvalidIdempotencyKeyError extends AgentError {
  constructor() {
    super("invalid_idempotency_key", "The idempotency key is invalid");
  }
}

export class AgentIdempotencyConflictError extends AgentError {
  constructor() {
    super(
      "idempotency_conflict",
      "The idempotency key was already used for a different request",
    );
  }
}

export class AgentIdempotencyUnavailableError extends AgentError {
  constructor() {
    super(
      "idempotency_unavailable",
      "Secure idempotency fingerprinting is unavailable",
    );
  }
}

export function normalizeAgentFailure(error: unknown): AgentFailureDetail {
  try {
    if (error instanceof AgentError) {
      const code: string = error.code;
      if (Object.hasOwn(AGENT_FAILURE_MESSAGES, code)) {
        const knownCode = code as AgentErrorCode;
        return { code: knownCode, message: AGENT_FAILURE_MESSAGES[knownCode] };
      }
    }
  } catch {
    // Unknown thrown values may be hostile proxies or malformed subclasses.
  }
  return {
    code: "internal_error",
    message: AGENT_FAILURE_MESSAGES.internal_error,
  };
}
