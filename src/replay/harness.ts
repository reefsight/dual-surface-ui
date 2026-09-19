import type { AgentAuditEvent } from "../audit.js";
import {
  AgentActionLifecycleCoordinator,
} from "../internal/action-lifecycle.js";
import { canonicalSnapshotText, deepFreezeJson } from "../delta/canonical.js";
import { AGENT_REPLAY_LIMITS } from "./schema.js";
import { SyntheticReplayBackend } from "./synthetic-backend.js";
import type {
  AgentReplayDifference,
  AgentReplayExpectedEvent,
  AgentReplayExpectedOutcome,
  AgentReplayFixture,
  AgentReplayNormalizedEvent,
  AgentReplayObservedOutcome,
  AgentReplayActionReference,
  AgentReplayRevisionReference,
  AgentReplayResult,
  AgentReplayStep,
} from "./types.js";
import {
  captureAgentReplayFixture,
  digestAgentReplaySnapshot,
} from "./validation.js";

class ReferenceNormalizer {
  readonly #revisions = new Map<string, AgentReplayRevisionReference>();
  readonly #actions = new Map<string, AgentReplayActionReference>();

  revision(value: string): AgentReplayRevisionReference {
    return this.#reference(this.#revisions, value, "revision");
  }

  action(value: string): AgentReplayActionReference {
    return this.#reference(this.#actions, value, "action");
  }

  #reference<Prefix extends "revision" | "action">(
    references: Map<string, `${Prefix}-${number}`>,
    value: string,
    prefix: Prefix,
  ): `${Prefix}-${number}` {
    const existing = references.get(value);
    if (existing) return existing;
    const reference = `${prefix}-${references.size + 1}` as `${Prefix}-${number}`;
    references.set(value, reference);
    return reference;
  }
}

const normalizeEvent = (
  event: AgentAuditEvent,
  operation: number,
  references: ReferenceNormalizer,
): AgentReplayNormalizedEvent => ({
  operation,
  event: event.event,
  outcome: event.outcome,
  sequence: event.sequence,
  revisionRef: references.revision(event.revision),
  ...(event.action !== undefined
    ? { actionRef: references.action(event.action) }
    : {}),
});

const normalizeOutcome = (
  operation: number,
  outcome: Awaited<ReturnType<AgentActionLifecycleCoordinator<unknown>["performSafe"]>>,
  references: ReferenceNormalizer,
): AgentReplayObservedOutcome =>
  outcome.status === "succeeded"
    ? {
        operation,
        status: "succeeded",
        revisionRef: references.revision(outcome.revision),
      }
    : { operation, status: "failed", code: outcome.error.code };

const expectedOutcomeForOperation = (
  operation: number,
  expected: AgentReplayExpectedOutcome,
): AgentReplayObservedOutcome =>
  expected.status === "succeeded"
    ? { operation, status: "succeeded", revisionRef: expected.revisionRef }
    : { operation, status: "failed", code: expected.code };

const expectedEventForOperation = (
  operation: number,
  expected: AgentReplayExpectedEvent,
): AgentReplayNormalizedEvent => ({ operation, ...expected });

const equalJson = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const addDifference = (
  differences: AgentReplayDifference[],
  difference: AgentReplayDifference,
): void => {
  if (differences.length < AGENT_REPLAY_LIMITS.differences) {
    differences.push(difference);
  }
};

const compareRun = (
  fixture: AgentReplayFixture,
  outcomes: readonly AgentReplayObservedOutcome[],
  lifecycle: readonly AgentReplayNormalizedEvent[],
  finalSnapshotText: string,
): AgentReplayDifference[] => {
  const differences: AgentReplayDifference[] = [];
  for (let index = 0; index < fixture.steps.length; index += 1) {
    const operation = index + 1;
    const actualOutcome = outcomes[index];
    const expectedOutcome = expectedOutcomeForOperation(
      operation,
      fixture.steps[index]!.expected.outcome,
    );
    if (!equalJson(actualOutcome, expectedOutcome)) {
      addDifference(differences, { path: "outcome", operation });
    }
    const actualEvents = lifecycle.filter(
      (event) => event.operation === operation,
    );
    const expectedEvents = fixture.steps[index]!.expected.lifecycle.map(
      (event) => expectedEventForOperation(operation, event),
    );
    const length = Math.max(actualEvents.length, expectedEvents.length);
    for (let eventIndex = 0; eventIndex < length; eventIndex += 1) {
      if (!equalJson(actualEvents[eventIndex], expectedEvents[eventIndex])) {
        addDifference(differences, {
          path: "lifecycle",
          operation,
          index: eventIndex,
        });
      }
    }
  }
  if (
    finalSnapshotText !==
    canonicalSnapshotText(fixture.expectedFinalSnapshot)
  ) {
    addDifference(differences, { path: "final_snapshot" });
  }
  return differences;
};

/** Runs one validated fixture against a fresh, package-owned synthetic backend. */
export const replayAgentFixture = async (
  value: unknown,
): Promise<AgentReplayResult> => {
  const captured = await captureAgentReplayFixture(value);
  if (captured.status === "rejected") return captured;
  const fixture = captured.fixture;
  try {
    const backend = new SyntheticReplayBackend(fixture);
    const references = new ReferenceNormalizer();
    const outcomes: AgentReplayObservedOutcome[] = [];
    const lifecycle: AgentReplayNormalizedEvent[] = [];
    let currentStep: AgentReplayStep | undefined;
    let operation = 0;
    const coordinator = new AgentActionLifecycleCoordinator({
      backend,
      idempotencyCacheSize: Math.max(1, fixture.steps.length),
      hooks: {
        createCorrelationId: () => `replay-${operation}`,
        getPrincipal: () => fixture.environment.principal,
        policy: () => ({ outcome: currentStep?.controls.policy ?? "deny" }),
        confirm: () => currentStep?.controls.confirmation === true,
        checkPrecondition: ({ precondition }) =>
          currentStep?.controls.preconditions?.[precondition] === true,
        verifyEffect: ({ effect }) =>
          currentStep?.controls.effects?.[effect] === true,
        onAudit: (event) => {
          lifecycle.push(normalizeEvent(event, operation, references));
        },
      },
    });

    for (const step of fixture.steps) {
      operation += 1;
      currentStep = step;
      backend.setStep(step, operation);
      const outcome = await coordinator.performSafe(step.request);
      outcomes.push(normalizeOutcome(operation, outcome, references));
    }

    const finalSnapshot = backend.snapshot();
    const differences = compareRun(
      fixture,
      outcomes,
      lifecycle,
      canonicalSnapshotText(finalSnapshot),
    );
    if (differences.length > 0) {
      return deepFreezeJson({
        status: "mismatch",
        fixtureId: fixture.fixtureId,
        differences,
      });
    }
    return deepFreezeJson({
      status: "matched",
      fixtureId: fixture.fixtureId,
      outcomes,
      lifecycle,
      finalSnapshotDigest: await digestAgentReplaySnapshot(finalSnapshot),
    });
  } catch {
    return deepFreezeJson({ status: "rejected", reason: "invalid_fixture" });
  }
};
