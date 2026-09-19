import type {
  AgentActionLifecycleBackend,
  ResolvedAgentTarget,
} from "../internal/action-lifecycle.js";
import type {
  AgentActionRequest,
  AgentActionSnapshot,
  AgentElementSnapshot,
  AgentSnapshot,
} from "../types.js";
import { captureAndValidateSnapshot } from "../delta/validation.js";
import type { AgentReplayFixture, AgentReplayStep } from "./types.js";

interface SyntheticReplayTarget {
  readonly operation: number;
  readonly elementId: string;
  readonly action: string;
}

export class SyntheticReplayBackend
  implements AgentActionLifecycleBackend<SyntheticReplayTarget>
{
  readonly surfaceId: string;
  readonly #origin: string;
  readonly #generation: string;
  #snapshot: AgentSnapshot;
  #step: AgentReplayStep | undefined;
  #operation = 0;

  constructor(fixture: AgentReplayFixture) {
    this.surfaceId = fixture.surfaceId;
    this.#origin = fixture.environment.origin;
    this.#generation = fixture.environment.generation;
    this.#snapshot = fixture.initialSnapshot;
  }

  setStep(step: AgentReplayStep, operation: number): void {
    this.#step = step;
    this.#operation = operation;
  }

  snapshot(): AgentSnapshot {
    return this.#snapshot;
  }

  captureContext(): {
    generation: string;
    origin: string;
    replayGeneration: string;
  } {
    return {
      generation: this.#generation,
      origin: this.#origin,
      replayGeneration: this.#generation,
    };
  }

  captureSnapshot(_signal?: AbortSignal): AgentSnapshot {
    return this.#snapshot;
  }

  lastKnownRevision(): string {
    return this.#snapshot.revision;
  }

  resolveTarget(
    _snapshot: AgentSnapshot,
    request: AgentActionRequest,
    targetSnapshot: AgentElementSnapshot,
    action: AgentActionSnapshot,
    _signal?: AbortSignal,
  ): ResolvedAgentTarget<SyntheticReplayTarget> {
    const step = this.#step;
    const operation = this.#operation;
    if (
      !step ||
      step.request.elementId !== request.elementId ||
      step.request.action !== request.action ||
      targetSnapshot.id !== request.elementId ||
      action.name !== request.action
    ) {
      throw new TypeError("Synthetic replay target mismatch");
    }
    const target: SyntheticReplayTarget = {
      operation,
      elementId: request.elementId,
      action: request.action,
    };
    return {
      target,
      execute: () => {
        if (this.#step !== step || this.#operation !== operation) {
          throw new TypeError("Synthetic replay operation changed");
        }
        if (step.controls.execution.kind === "throw") {
          throw new Error("Synthetic replay execution failed");
        }
        this.#snapshot = captureAndValidateSnapshot(
          step.controls.execution.nextSnapshot,
        );
        return step.controls.execution.output;
      },
      isCurrent: () => this.#step === step && this.#operation === operation,
      verifyPostExecution: () => this.#step === step && this.#operation === operation,
      verifyDefault: () => step.controls.verification === true,
    };
  }
}
