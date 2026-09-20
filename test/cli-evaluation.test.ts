import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import {
  AGENT_EVALUATION_DEFINITION_SCHEMA,
  AGENT_EVALUATION_RESULT_SCHEMA,
  AgentEvaluationValidationError,
  captureAndValidateAgentEvaluationDefinition,
  captureAndValidateAgentEvaluationResult,
  digestAgentEvaluationDefinition,
  scoreAgentEvaluation,
  type AgentEvaluationDefinition,
} from "../src/cli/index.js";

async function definition(): Promise<AgentEvaluationDefinition> {
  const unsigned = {
    schemaVersion: "0.1" as const,
    kind: "agent-evaluation-definition" as const,
    suiteId: "suite-a",
    dimensions: ["arguments", "selection"],
    cases: [
      {
        caseId: "case-a",
        input: { operation: "inspect" },
        expected: { arguments: { valid: true }, selection: "target-a" },
      },
      {
        caseId: "case-b",
        input: null,
        expected: { arguments: true, selection: ["target-b"] },
      },
    ],
  };
  return {
    ...unsigned,
    definitionDigest: await digestAgentEvaluationDefinition(unsigned),
  };
}

describe("P3.5 deterministic evaluation contract", () => {
  it("captures a strict immutable definition and verifies its domain digest", async () => {
    const source = await definition();
    const captured = await captureAndValidateAgentEvaluationDefinition(source);
    expect(captured).toEqual(source);
    expect(captured).not.toBe(source);
    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.isFrozen(captured.cases)).toBe(true);
    expect(Object.isFrozen(captured.cases[0]!.expected)).toBe(true);

    const tampered = structuredClone(source);
    tampered.cases[0]!.expected.selection = "other";
    await expect(captureAndValidateAgentEvaluationDefinition(tampered)).rejects.toMatchObject({
      reason: "digest_mismatch",
    });
  });

  it("rejects unsorted identifiers, missing dimensions, secrets, and case budgets", async () => {
    const unsorted = structuredClone(await definition());
    unsorted.dimensions.reverse();
    await expect(captureAndValidateAgentEvaluationDefinition(unsorted)).rejects.toMatchObject({
      reason: "invalid_artifact",
    });

    const missing = structuredClone(await definition());
    delete missing.cases[0]!.expected.selection;
    const { definitionDigest: _missingDigest, ...missingUnsigned } = missing;
    missing.definitionDigest = await digestAgentEvaluationDefinition(missingUnsigned);
    await expect(captureAndValidateAgentEvaluationDefinition(missing)).rejects.toMatchObject({
      reason: "invalid_artifact",
    });

    const secret = structuredClone(await definition());
    secret.cases[0]!.input = { password: "not-for-fixtures" };
    await expect(captureAndValidateAgentEvaluationDefinition(secret)).rejects.toMatchObject({
      reason: "secret_detected",
    });

    const oversized = structuredClone(await definition());
    oversized.cases[0]!.input = "x".repeat(32_768);
    await expect(captureAndValidateAgentEvaluationDefinition(oversized)).rejects.toMatchObject({
      reason: "budget_exceeded",
    });
  });

  it("never invokes accessors while capturing definitions or observations", async () => {
    const hostile = structuredClone(await definition());
    let reads = 0;
    Object.defineProperty(hostile, "suiteId", {
      enumerable: true,
      get() {
        reads += 1;
        return "suite-a";
      },
    });
    await expect(captureAndValidateAgentEvaluationDefinition(hostile)).rejects.toBeInstanceOf(
      AgentEvaluationValidationError,
    );
    expect(reads).toBe(0);

    const valid = await definition();
    const observations = [
      {
        caseId: "case-a",
        result: { status: "environment_unavailable" as const },
      },
      {
        caseId: "case-b",
        result: { status: "environment_unavailable" as const },
      },
    ];
    Object.defineProperty(observations, "0", {
      enumerable: true,
      get() {
        reads += 1;
        return undefined;
      },
    });
    await expect(scoreAgentEvaluation(valid, "driver-a", observations)).rejects.toMatchObject({
      reason: "invalid_artifact",
    });
    expect(reads).toBe(0);
  });

  it("scores exact canonical equality and preserves environment errors as unscored", async () => {
    const source = await definition();
    const result = await scoreAgentEvaluation(source, "driver-a", [
      {
        caseId: "case-a",
        result: {
          status: "observed",
          observations: {
            arguments: { valid: true },
            selection: "wrong-target",
          },
        },
      },
      {
        caseId: "case-b",
        result: { status: "environment_unavailable" },
      },
    ]);

    expect(result).toMatchObject({
      status: "incomplete",
      caseCount: 2,
      dimensionCount: 2,
      environmentErrors: 1,
      cases: [
        {
          caseId: "case-a",
          status: "scored",
          scores: [
            { dimension: "arguments", earned: 1, possible: 1 },
            { dimension: "selection", earned: 0, possible: 1 },
          ],
        },
        {
          caseId: "case-b",
          status: "environment_error",
          code: "environment_unavailable",
        },
      ],
      dimensions: [
        { dimension: "arguments", earned: 1, possible: 1, unscored: 1 },
        { dimension: "selection", earned: 0, possible: 1, unscored: 1 },
      ],
    });
    expect(captureAndValidateAgentEvaluationResult(result)).toEqual(result);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("rejects malformed observations and inconsistent result aggregates", async () => {
    const source = await definition();
    await expect(scoreAgentEvaluation(source, "driver-a", [
      {
        caseId: "case-a",
        result: { status: "observed", observations: { arguments: true } },
      },
      { caseId: "case-b", result: { status: "environment_unavailable" } },
    ])).rejects.toMatchObject({ reason: "invalid_artifact" });

    await expect(scoreAgentEvaluation(source, "driver-a", [
      {
        caseId: "case-a",
        result: {
          status: "observed",
          observations: {
            arguments: true,
            selection: "ghp_12345678901234567890",
          },
        },
      },
      { caseId: "case-b", result: { status: "environment_unavailable" } },
    ])).rejects.toMatchObject({ reason: "secret_detected" });

    const valid = await scoreAgentEvaluation(source, "driver-a", [
      {
        caseId: "case-a",
        result: {
          status: "observed",
          observations: {
            arguments: { valid: true },
            selection: "target-a",
          },
        },
      },
      {
        caseId: "case-b",
        result: { status: "environment_unavailable" },
      },
    ]);
    const tampered = structuredClone(valid);
    tampered.dimensions[0]!.earned = 0;
    expect(() => captureAndValidateAgentEvaluationResult(tampered)).toThrowError(
      AgentEvaluationValidationError,
    );
  });

  it("publishes strict independently compilable definition and result schemas", () => {
    const validator = new Ajv2020({ strict: true });
    expect(() => validator.compile(AGENT_EVALUATION_DEFINITION_SCHEMA)).not.toThrow();
    expect(() => validator.compile(AGENT_EVALUATION_RESULT_SCHEMA)).not.toThrow();
  });

  it("keeps schema-only validation structural and enforces cross-field semantics publicly", async () => {
    const validator = new Ajv2020({ strict: true });
    const validateDefinitionSchema = validator.compile(
      AGENT_EVALUATION_DEFINITION_SCHEMA,
    );
    const validateResultSchema = validator.compile(AGENT_EVALUATION_RESULT_SCHEMA);

    const mismatchedDefinition = structuredClone(await definition());
    delete mismatchedDefinition.cases[0]!.expected.selection;
    const { definitionDigest: _definitionDigest, ...unsigned } = mismatchedDefinition;
    mismatchedDefinition.definitionDigest = await digestAgentEvaluationDefinition(unsigned);
    expect(validateDefinitionSchema(mismatchedDefinition)).toBe(true);
    await expect(
      captureAndValidateAgentEvaluationDefinition(mismatchedDefinition),
    ).rejects.toMatchObject({ reason: "invalid_artifact" });

    const inconsistentResult = structuredClone(
      await scoreAgentEvaluation(await definition(), "driver-a", [
        {
          caseId: "case-a",
          result: {
            status: "observed",
            observations: {
              arguments: { valid: true },
              selection: "target-a",
            },
          },
        },
        {
          caseId: "case-b",
          result: { status: "environment_unavailable" },
        },
      ]),
    );
    inconsistentResult.environmentErrors = 0;
    expect(validateResultSchema(inconsistentResult)).toBe(true);
    expect(() => captureAndValidateAgentEvaluationResult(inconsistentResult)).toThrowError(
      AgentEvaluationValidationError,
    );
  });
});
