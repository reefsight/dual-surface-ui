import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";

import {
  DeltaCaptureError,
  deepFreezeJson,
  descriptorSafeCaptureJson,
} from "../delta/canonical.js";
import {
  containsSecretSentinel,
  isSensitiveKey,
} from "../internal/secret-detection.js";
import {
  AGENT_EVALUATION_DEFINITION_KIND,
  AGENT_EVALUATION_DEFINITION_SCHEMA,
  AGENT_EVALUATION_LIMITS,
  AGENT_EVALUATION_RESULT_KIND,
  AGENT_EVALUATION_RESULT_SCHEMA,
  AGENT_EVALUATION_SCHEMA_VERSION,
} from "./evaluation-schema.js";
import type {
  AgentCliDigest,
  AgentCliJson,
  AgentEvaluationCaseObservation,
  AgentEvaluationCaseResult,
  AgentEvaluationDefinition,
  AgentEvaluationDimensionResult,
  AgentEvaluationResult,
} from "./types.js";

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateDefinition = ajv.compile(
  AGENT_EVALUATION_DEFINITION_SCHEMA,
) as ValidateFunction<AgentEvaluationDefinition>;
const validateResult = ajv.compile(
  AGENT_EVALUATION_RESULT_SCHEMA,
) as ValidateFunction<AgentEvaluationResult>;

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DIGEST_DOMAIN = "dual-surface-ui:evaluation-definition:0.1\0";
const encoder = new TextEncoder();

export type AgentEvaluationValidationReason =
  | "invalid_artifact"
  | "digest_mismatch"
  | "budget_exceeded"
  | "secret_detected";

export class AgentEvaluationValidationError extends TypeError {
  readonly reason: AgentEvaluationValidationReason;

  constructor(reason: AgentEvaluationValidationReason) {
    super("Evaluation artifact validation failed");
    this.name = "AgentEvaluationValidationError";
    this.reason = reason;
  }
}

const fail = (reason: AgentEvaluationValidationReason): never => {
  throw new AgentEvaluationValidationError(reason);
};

const utf8Length = (value: unknown): number =>
  encoder.encode(JSON.stringify(value)).byteLength;

const compareCodeUnits = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const isStrictlySorted = (values: readonly string[]): boolean =>
  values.every((value, index) => index === 0 || compareCodeUnits(values[index - 1]!, value) < 0);

const scanSecrets = (
  value: unknown,
  allowRootDefinitionDigest = false,
  depth = 0,
): void => {
  if (typeof value === "string") {
    if (containsSecretSentinel(value)) fail("secret_detected");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      scanSecrets(item, allowRootDefinitionDigest, depth + 1);
    }
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, item] of Object.entries(value)) {
    if (isSensitiveKey(key)) fail("secret_detected");
    if (
      allowRootDefinitionDigest &&
      depth === 0 &&
      key === "definitionDigest" &&
      typeof item === "string" &&
      /^sha256:[a-f0-9]{64}$/.test(item)
    ) continue;
    scanSecrets(item, allowRootDefinitionDigest, depth + 1);
  }
};

const capture = (value: unknown): AgentCliJson => {
  try {
    return descriptorSafeCaptureJson(value, {
      maxDepth: AGENT_EVALUATION_LIMITS.captureDepth,
      maxNodes: AGENT_EVALUATION_LIMITS.captureNodes,
      maxCharacters: AGENT_EVALUATION_LIMITS.artifactBytes,
      maxStringLength: AGENT_EVALUATION_LIMITS.stringLength,
      maxPropertiesPerObject: AGENT_EVALUATION_LIMITS.propertiesPerObject,
    }) as AgentCliJson;
  } catch (error) {
    if (error instanceof DeltaCaptureError && error.reason === "budget_exceeded") {
      return fail("budget_exceeded");
    }
    return fail("invalid_artifact");
  }
};

function assertIdentifier(value: unknown): asserts value is string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    fail("invalid_artifact");
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasOnlyKeys = (
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean => {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
};

const assertExactKeys = (
  value: Readonly<Record<string, AgentCliJson>>,
  expected: readonly string[],
): void => {
  const keys = Object.keys(value);
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) fail("invalid_artifact");
};

const unsignedDefinition = (
  definition: AgentEvaluationDefinition,
): Omit<AgentEvaluationDefinition, "definitionDigest"> => ({
  schemaVersion: AGENT_EVALUATION_SCHEMA_VERSION,
  kind: AGENT_EVALUATION_DEFINITION_KIND,
  suiteId: definition.suiteId,
  dimensions: definition.dimensions,
  cases: definition.cases,
});

export const digestAgentEvaluationDefinition = async (
  definition: Omit<AgentEvaluationDefinition, "definitionDigest">,
): Promise<AgentCliDigest> => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) fail("invalid_artifact");
  const canonical = capture(definition);
  try {
    const digest = await subtle.digest(
      "SHA-256",
      encoder.encode(`${DIGEST_DOMAIN}${JSON.stringify(canonical)}`),
    );
    const hex = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    return `sha256:${hex}`;
  } catch {
    return fail("invalid_artifact");
  }
};

export const captureAndValidateAgentEvaluationDefinition = async (
  value: unknown,
): Promise<AgentEvaluationDefinition> => {
  const captured = capture(value);
  scanSecrets(captured, true);
  if (utf8Length(captured) > AGENT_EVALUATION_LIMITS.artifactBytes) {
    fail("budget_exceeded");
  }
  if (!validateDefinition(captured)) {
    if (validateDefinition.errors?.some((error) =>
      error.keyword === "maxItems" ||
      error.keyword === "maxLength" ||
      error.keyword === "maxProperties"
    )) fail("budget_exceeded");
    fail("invalid_artifact");
  }

  const definition = captured as unknown as AgentEvaluationDefinition;
  assertIdentifier(definition.suiteId);
  if (!isStrictlySorted(definition.dimensions)) fail("invalid_artifact");
  if (!isStrictlySorted(definition.cases.map(({ caseId }) => caseId))) {
    fail("invalid_artifact");
  }
  for (const item of definition.cases) {
    assertIdentifier(item.caseId);
    assertExactKeys(item.expected, definition.dimensions);
    if (utf8Length(item.input) + utf8Length(item.expected) > AGENT_EVALUATION_LIMITS.caseBytes) {
      fail("budget_exceeded");
    }
  }
  const expectedDigest = await digestAgentEvaluationDefinition(
    unsignedDefinition(definition),
  );
  if (expectedDigest !== definition.definitionDigest) fail("digest_mismatch");
  return deepFreezeJson(definition);
};

const canonicalEquals = (left: AgentCliJson, right: AgentCliJson): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

export const scoreAgentEvaluation = async (
  definition: AgentEvaluationDefinition,
  driverId: string,
  observations: readonly AgentEvaluationCaseObservation[],
): Promise<AgentEvaluationResult> => {
  const validatedDefinition = await captureAndValidateAgentEvaluationDefinition(
    definition,
  );
  const capturedObservations = capture(observations) as unknown as readonly AgentEvaluationCaseObservation[];
  scanSecrets(capturedObservations);
  assertIdentifier(driverId);
  scanSecrets(driverId);
  if (capturedObservations.length !== validatedDefinition.cases.length) {
    fail("invalid_artifact");
  }

  const earnedByDimension = new Map(
    validatedDefinition.dimensions.map((dimension) => [dimension, 0]),
  );
  const cases: AgentEvaluationCaseResult[] = [];
  let environmentErrors = 0;

  for (let index = 0; index < validatedDefinition.cases.length; index += 1) {
    const expectedCase = validatedDefinition.cases[index]!;
    const observedCase = capturedObservations[index]!;
    if (
      !isRecord(observedCase) ||
      !hasOnlyKeys(observedCase, ["caseId", "result"]) ||
      typeof observedCase.caseId !== "string" ||
      !isRecord(observedCase.result)
    ) fail("invalid_artifact");
    if (observedCase.caseId !== expectedCase.caseId) fail("invalid_artifact");
    const caseResult = observedCase.result;
    if (caseResult.status === "environment_unavailable") {
      if (!hasOnlyKeys(caseResult, ["status"])) fail("invalid_artifact");
      environmentErrors += 1;
      cases.push({
        caseId: expectedCase.caseId,
        status: "environment_error",
        code: "environment_unavailable",
      });
      continue;
    }
    if (caseResult.status !== "observed") fail("invalid_artifact");
    if (
      !hasOnlyKeys(caseResult, ["status", "observations"]) ||
      !isRecord(caseResult.observations)
    ) fail("invalid_artifact");
    if (utf8Length(caseResult.observations) > AGENT_EVALUATION_LIMITS.caseBytes) {
      fail("budget_exceeded");
    }
    assertExactKeys(caseResult.observations, validatedDefinition.dimensions);
    const scores = validatedDefinition.dimensions.map((dimension) => {
      const earned = canonicalEquals(
        caseResult.observations[dimension]!,
        expectedCase.expected[dimension]!,
      ) ? 1 : 0;
      earnedByDimension.set(
        dimension,
        earnedByDimension.get(dimension)! + earned,
      );
      return { dimension, earned, possible: 1 } as const;
    });
    cases.push({ caseId: expectedCase.caseId, status: "scored", scores });
  }

  const possible = validatedDefinition.cases.length - environmentErrors;
  const dimensions: AgentEvaluationDimensionResult[] = validatedDefinition.dimensions.map(
    (dimension) => ({
      dimension,
      earned: earnedByDimension.get(dimension)!,
      possible,
      unscored: environmentErrors,
    }),
  );
  return deepFreezeJson({
    schemaVersion: AGENT_EVALUATION_SCHEMA_VERSION,
    kind: AGENT_EVALUATION_RESULT_KIND,
    suiteId: validatedDefinition.suiteId,
    definitionDigest: validatedDefinition.definitionDigest,
    driverId,
    status: environmentErrors === 0 ? "complete" : "incomplete",
    caseCount: validatedDefinition.cases.length,
    dimensionCount: validatedDefinition.dimensions.length,
    cases,
    dimensions,
    environmentErrors,
  });
};

export const captureAndValidateAgentEvaluationResult = (
  value: unknown,
): AgentEvaluationResult => {
  const captured = capture(value);
  scanSecrets(captured, true);
  if (utf8Length(captured) > AGENT_EVALUATION_LIMITS.artifactBytes) {
    fail("budget_exceeded");
  }
  if (!validateResult(captured)) {
    if (validateResult.errors?.some((error) =>
      error.keyword === "maxItems" ||
      error.keyword === "maxLength" ||
      error.keyword === "maxProperties"
    )) fail("budget_exceeded");
    fail("invalid_artifact");
  }
  const result = captured as unknown as AgentEvaluationResult;
  assertIdentifier(result.suiteId);
  assertIdentifier(result.driverId);
  if (
    result.caseCount !== result.cases.length ||
    result.dimensionCount !== result.dimensions.length ||
    !isStrictlySorted(result.cases.map(({ caseId }) => caseId)) ||
    !isStrictlySorted(result.dimensions.map(({ dimension }) => dimension))
  ) fail("invalid_artifact");

  const dimensionNames = result.dimensions.map(({ dimension }) => dimension);
  const earned = new Map(dimensionNames.map((dimension) => [dimension, 0]));
  let environmentErrors = 0;
  for (const item of result.cases) {
    if (item.status === "environment_error") {
      environmentErrors += 1;
      continue;
    }
    const names = item.scores.map(({ dimension }) => dimension);
    if (
      names.length !== dimensionNames.length ||
      !isStrictlySorted(names) ||
      names.some((name, index) => name !== dimensionNames[index])
    ) {
      fail("invalid_artifact");
    }
    for (const score of item.scores) {
      earned.set(score.dimension, earned.get(score.dimension)! + score.earned);
    }
  }
  const possible = result.caseCount - environmentErrors;
  if (
    result.environmentErrors !== environmentErrors ||
    result.status !== (environmentErrors === 0 ? "complete" : "incomplete") ||
    result.dimensions.some((dimension) =>
      dimension.earned !== earned.get(dimension.dimension) ||
      dimension.possible !== possible ||
      dimension.unscored !== environmentErrors
    )
  ) fail("invalid_artifact");
  return deepFreezeJson(result);
};
