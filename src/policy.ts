import { AgentInvalidPolicyDecisionError } from "./errors.js";
import type {
  AgentPolicyDecision,
  AgentPolicyRequest,
  AgentSurfaceOptions,
} from "./types.js";

const outcomes = new Set([
  "allow",
  "deny",
  "require_confirmation",
]);

function assertPolicyDecision(value: unknown): asserts value is AgentPolicyDecision {
  if (
    typeof value !== "object" ||
    value === null ||
    !("outcome" in value) ||
    typeof value.outcome !== "string" ||
    !outcomes.has(value.outcome) ||
    ("reason" in value &&
      value.reason !== undefined &&
      typeof value.reason !== "string")
  ) {
    throw new AgentInvalidPolicyDecisionError();
  }
}

export async function decideAgentAction(
  request: AgentPolicyRequest,
  policy: AgentSurfaceOptions["policy"],
  authorize: AgentSurfaceOptions["authorize"],
): Promise<AgentPolicyDecision> {
  if (policy) {
    const decision: unknown = await policy(request);
    assertPolicyDecision(decision);
    return decision;
  }

  if (request.risk === "read") return { outcome: "allow" };
  if (!authorize) return { outcome: "deny" };

  return (await authorize(request))
    ? { outcome: "allow" }
    : { outcome: "deny" };
}
