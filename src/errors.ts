export type AgentErrorCode =
  | "element_not_found"
  | "action_not_found"
  | "authorization_required"
  | "duplicate_element_id"
  | "surface_mismatch"
  | "stale_revision"
  | "invalid_input"
  | "confirmation_required"
  | "invalid_policy_decision"
  | "precondition_failed"
  | "verification_failed";

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
