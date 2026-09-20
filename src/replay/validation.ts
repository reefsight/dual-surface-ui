import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsModule, { type FormatsPlugin } from "ajv-formats";

import {
  AGENT_ACTION_REQUEST_SCHEMA,
  AGENT_SNAPSHOT_SCHEMA,
} from "../schema.js";
import type {
  AgentActionRequest,
  AgentJsonValue,
  AgentPrincipal,
} from "../types.js";
import {
  DeltaCaptureError,
  deepFreezeJson,
  descriptorSafeCaptureJson,
  digestCanonicalSnapshot,
} from "../delta/canonical.js";
import {
  captureAndValidateSnapshot,
  deltaValidationReason,
} from "../delta/validation.js";
import {
  AGENT_REPLAY_FIXTURE_KIND,
  AGENT_REPLAY_FIXTURE_SCHEMA,
  AGENT_REPLAY_FIXTURE_SCHEMA_VERSION,
  AGENT_REPLAY_LIMITS,
} from "./schema.js";
import type {
  AgentReplayControls,
  AgentReplayEnvironment,
  AgentReplayExpectedEvent,
  AgentReplayExpectedOutcome,
  AgentReplayFixture,
  AgentReplayFixtureCaptureResult,
  AgentReplayRejectReason,
  AgentReplayStep,
} from "./types.js";
import {
  containsSecretSentinel,
  isSensitiveKey,
} from "../internal/secret-detection.js";

const addFormats = addFormatsModule as unknown as FormatsPlugin;
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addSchema(AGENT_SNAPSHOT_SCHEMA);
ajv.addSchema(AGENT_ACTION_REQUEST_SCHEMA);
const validateFixture = ajv.compile(
  AGENT_REPLAY_FIXTURE_SCHEMA,
) as ValidateFunction<AgentReplayFixture>;

const encoder = new TextEncoder();
const IDENTIFIER = /^[A-Za-z0-9._~-]{1,128}$/;
const DIGEST_DOMAIN = "dual-surface-ui:agent-replay-fixture:0.1\0";

class ReplayFixtureError extends TypeError {
  readonly reason: AgentReplayRejectReason;

  constructor(reason: AgentReplayRejectReason) {
    super("Synthetic replay fixture rejected");
    this.name = "ReplayFixtureError";
    this.reason = reason;
  }
}

const fail = (reason: AgentReplayRejectReason): never => {
  throw new ReplayFixtureError(reason);
};

const byteLength = (value: unknown): number =>
  encoder.encode(JSON.stringify(value)).byteLength;

const scanSecrets = (value: unknown, depth = 0): void => {
  if (typeof value === "string") {
    if (containsSecretSentinel(value)) fail("secret_detected");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) scanSecrets(item, depth + 1);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, item] of Object.entries(value)) {
    if (isSensitiveKey(key)) fail("secret_detected");
    if (
      depth === 0 &&
      key === "fixtureDigest" &&
      typeof item === "string" &&
      /^sha256:[a-f0-9]{64}$/.test(item)
    ) continue;
    scanSecrets(item, depth + 1);
  }
};

const canonicalBooleanRecord = (
  value: Readonly<Record<string, boolean>> | undefined,
): Readonly<Record<string, boolean>> | undefined => {
  if (value === undefined) return undefined;
  const result: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
  for (const key of Object.keys(value).sort()) {
    if (!IDENTIFIER.test(key) || typeof value[key] !== "boolean") {
      fail("invalid_fixture");
    }
    result[key] = value[key]!;
  }
  return Object.freeze(result);
};

const canonicalPrincipal = (
  principal: AgentPrincipal | undefined,
): AgentPrincipal | undefined => {
  if (!principal) return undefined;
  if (!IDENTIFIER.test(principal.id)) fail("invalid_fixture");
  const roles = principal.roles ? [...principal.roles].sort() : undefined;
  if (roles && (new Set(roles).size !== roles.length || roles.some((role) => !IDENTIFIER.test(role)))) {
    fail("invalid_fixture");
  }
  return {
    id: principal.id,
    ...(roles ? { roles } : {}),
  };
};

const canonicalRequest = (request: AgentActionRequest): AgentActionRequest => ({
  surfaceId: request.surfaceId,
  revision: request.revision,
  elementId: request.elementId,
  action: request.action,
  ...(request.input !== undefined ? { input: request.input } : {}),
  ...(request.idempotencyKey !== undefined
    ? { idempotencyKey: request.idempotencyKey }
    : {}),
});

const canonicalExpectedEvent = (
  event: AgentReplayExpectedEvent,
): AgentReplayExpectedEvent => ({
  event: event.event,
  outcome: event.outcome,
  sequence: event.sequence,
  revisionRef: event.revisionRef,
  ...(event.actionRef !== undefined ? { actionRef: event.actionRef } : {}),
});

const canonicalExpectedOutcome = (
  outcome: AgentReplayExpectedOutcome,
): AgentReplayExpectedOutcome =>
  outcome.status === "succeeded"
    ? { status: "succeeded", revisionRef: outcome.revisionRef }
    : { status: "failed", code: outcome.code };

const assertOrigin = (origin: string): void => {
  try {
    const parsed = new URL(origin);
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      parsed.origin !== origin ||
      parsed.username !== "" ||
      parsed.password !== ""
    ) fail("invalid_fixture");
  } catch (error) {
    if (error instanceof ReplayFixtureError) throw error;
    fail("invalid_fixture");
  }
};

const assertSnapshotBoundary = (
  fixtureSurfaceId: string,
  origin: string,
  snapshot: AgentReplayFixture["initialSnapshot"],
): void => {
  if (snapshot.surfaceId !== fixtureSurfaceId) fail("surface_mismatch");
  try {
    const parsed = new URL(snapshot.url);
    if (parsed.username !== "" || parsed.password !== "") {
      fail("secret_detected");
    }
    if (parsed.search !== "" || parsed.hash !== "") fail("secret_detected");
    if (parsed.origin !== origin) fail("surface_mismatch");
  } catch (error) {
    if (error instanceof ReplayFixtureError) throw error;
    fail("invalid_fixture");
  }
  if (
    snapshot.nodes.some((node) =>
      node.actions.some((action) => action.risk === "credential"),
    )
  ) fail("secret_detected");
};

const canonicalStep = (
  step: AgentReplayStep,
  surfaceId: string,
  origin: string,
): AgentReplayStep => {
  if (step.request.surfaceId !== surfaceId) fail("surface_mismatch");
  if (step.request.input !== undefined && byteLength(step.request.input) > AGENT_REPLAY_LIMITS.valueBytes) {
    fail("budget_exceeded");
  }
  const execution = step.controls.execution.kind === "throw"
    ? ({ kind: "throw" } as const)
    : (() => {
        const nextSnapshot = captureAndValidateSnapshot(
          step.controls.execution.nextSnapshot,
        );
        assertSnapshotBoundary(surfaceId, origin, nextSnapshot);
        if (
          step.controls.execution.output !== undefined &&
          byteLength(step.controls.execution.output) > AGENT_REPLAY_LIMITS.valueBytes
        ) fail("budget_exceeded");
        return {
          kind: "transition" as const,
          nextSnapshot,
          ...(step.controls.execution.output !== undefined
            ? { output: step.controls.execution.output as AgentJsonValue }
            : {}),
        };
      })();
  const controls: AgentReplayControls = {
    policy: step.controls.policy,
    ...(step.controls.confirmation !== undefined
      ? { confirmation: step.controls.confirmation }
      : {}),
    ...(canonicalBooleanRecord(step.controls.preconditions)
      ? { preconditions: canonicalBooleanRecord(step.controls.preconditions)! }
      : {}),
    ...(canonicalBooleanRecord(step.controls.effects)
      ? { effects: canonicalBooleanRecord(step.controls.effects)! }
      : {}),
    ...(step.controls.verification !== undefined
      ? { verification: step.controls.verification }
      : {}),
    execution,
  };
  return {
    request: canonicalRequest(step.request),
    controls,
    expected: {
      outcome: canonicalExpectedOutcome(step.expected.outcome),
      lifecycle: step.expected.lifecycle.map(canonicalExpectedEvent),
    },
  };
};

const fixtureDigest = async (
  fixture: Omit<AgentReplayFixture, "fixtureDigest">,
): Promise<`sha256:${string}`> => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) fail("invalid_fixture");
  const canonical = descriptorSafeCaptureJson(fixture, {
    maxCharacters: AGENT_REPLAY_LIMITS.fixtureBytes,
    maxStringLength: AGENT_REPLAY_LIMITS.valueBytes,
    maxNodes: 250_000,
  });
  try {
    const digest = await subtle.digest(
      "SHA-256",
      encoder.encode(`${DIGEST_DOMAIN}${JSON.stringify(canonical)}`),
    );
    return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("")}`;
  } catch {
    return fail("invalid_fixture");
  }
};

export const captureAgentReplayFixtureValue = async (
  value: unknown,
): Promise<AgentReplayFixture> => {
  let captured: unknown;
  try {
    captured = descriptorSafeCaptureJson(value, {
      maxCharacters: AGENT_REPLAY_LIMITS.fixtureBytes,
      maxStringLength: AGENT_REPLAY_LIMITS.valueBytes,
      maxNodes: 250_000,
    });
  } catch (error) {
    if (error instanceof DeltaCaptureError && error.reason === "budget_exceeded") {
      return fail("budget_exceeded");
    }
    return fail("invalid_fixture");
  }
  scanSecrets(captured);
  if (!validateFixture(captured)) {
    if (validateFixture.errors?.some((error) => error.keyword === "maxItems" || error.keyword === "maxLength")) {
      fail("budget_exceeded");
    }
    fail("invalid_fixture");
  }
  const source = captured as AgentReplayFixture;
  if (
    source.schemaVersion !== AGENT_REPLAY_FIXTURE_SCHEMA_VERSION ||
    source.kind !== AGENT_REPLAY_FIXTURE_KIND ||
    !IDENTIFIER.test(source.fixtureId) ||
    !IDENTIFIER.test(source.surfaceId)
  ) fail("invalid_fixture");
  assertOrigin(source.environment.origin);
  const environment: AgentReplayEnvironment = {
    origin: source.environment.origin,
    generation: source.environment.generation,
    ...(source.environment.principal
      ? { principal: canonicalPrincipal(source.environment.principal)! }
      : {}),
  };
  const initialSnapshot = captureAndValidateSnapshot(source.initialSnapshot);
  const expectedFinalSnapshot = captureAndValidateSnapshot(
    source.expectedFinalSnapshot,
  );
  assertSnapshotBoundary(source.surfaceId, environment.origin, initialSnapshot);
  assertSnapshotBoundary(
    source.surfaceId,
    environment.origin,
    expectedFinalSnapshot,
  );
  const steps = source.steps.map((step) =>
    canonicalStep(step, source.surfaceId, environment.origin),
  );
  const unsigned = {
    schemaVersion: AGENT_REPLAY_FIXTURE_SCHEMA_VERSION,
    kind: AGENT_REPLAY_FIXTURE_KIND,
    fixtureId: source.fixtureId,
    surfaceId: source.surfaceId,
    environment,
    initialSnapshot,
    steps,
    expectedFinalSnapshot,
  } satisfies Omit<AgentReplayFixture, "fixtureDigest">;
  if (byteLength(unsigned) > AGENT_REPLAY_LIMITS.fixtureBytes) {
    fail("budget_exceeded");
  }
  const expectedDigest = await fixtureDigest(unsigned);
  if (expectedDigest !== source.fixtureDigest) fail("fixture_digest_mismatch");
  return deepFreezeJson({ ...unsigned, fixtureDigest: expectedDigest });
};

export const captureAgentReplayFixture = async (
  value: unknown,
): Promise<AgentReplayFixtureCaptureResult> => {
  try {
    return deepFreezeJson({
      status: "valid",
      fixture: await captureAgentReplayFixtureValue(value),
    });
  } catch (error) {
    const reason =
      error instanceof ReplayFixtureError
        ? error.reason
        : error instanceof DeltaCaptureError &&
            error.reason === "budget_exceeded"
          ? "budget_exceeded"
          : deltaValidationReason(error) === "budget_exceeded"
            ? "budget_exceeded"
            : "invalid_fixture";
    return deepFreezeJson({
      status: "rejected",
      reason,
    });
  }
};

export const digestAgentReplaySnapshot = digestCanonicalSnapshot;
