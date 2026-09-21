import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "fixtures", "phase3-exit", "contracts");
const load = async (name: string) => JSON.parse(await readFile(resolve(root, name), "utf8"));
const digest = `sha256:${"a".repeat(64)}`;
const commit = "a".repeat(40);

describe("Phase 3 authority-bound evidence contracts", () => {
  it("requires an identified independent security reviewer", async () => {
    const validate = new Ajv2020({ strict: true }).compile(await load("p3.7-independent-security-review-0.1.schema.json"));
    const review = { schemaVersion: "0.1", kind: "p3.7-independent-security-review", status: "approved", reviewedCommit: commit, corpusDigest: digest, matrixDigest: digest, reportDigest: digest, reviewer: { id: "reviewer-1", independent: true }, findings: [], unresolvedCriticalHigh: 0, disposition: "no_unresolved_critical_high" };
    expect(validate(review)).toBe(true);
    expect(validate({ ...review, reviewer: { id: "reviewer-1", independent: "yes" } })).toBe(false);
  });

  it("requires complete per-config model provenance and safety metrics", async () => {
    const validate = new Ajv2020({ strict: true }).compile(await load("p3.8-multi-model-report-0.1.schema.json"));
    const config = { provider: "provider-a", modelSnapshot: "model-a@2026-09-21", configDigest: digest, repetitions: 3, taskCount: 12, completionRate: 0.95, wrongActionRate: 0, unauthorizedConsequentialActions: 0, secretLeaks: 0, criticalSafetyPassRate: 1, environmentErrors: 0, rawCaseRecordsDigest: digest };
    const report = { schemaVersion: "0.1", kind: "p3.8-multi-model-report", status: "complete", sourceCommit: commit, packageLockDigest: digest, suiteDigest: digest, suiteFileDigest: digest, suiteSchemaDigest: digest, promptConfigDigest: digest, browser: "chromium/153", os: "windows", measuredAt: "2026-09-21T00:00:00Z", retention: "redacted scores only", supportedConfigs: [config, { ...config, provider: "provider-b", modelSnapshot: "model-b@2026-09-21" }], reportDigest: digest };
    expect(validate(report)).toBe(true);
    expect(validate({ ...report, supportedConfigs: [config] })).toBe(false);
  });

  it("keeps unavailable token accounting from satisfying the model benchmark contract gate", async () => {
    const validate = new Ajv2020({ strict: true }).compile(await load("p3.9-model-benchmark-report-0.1.schema.json"));
    const report = { schemaVersion: "0.1", kind: "p3.9-model-benchmark-report", status: "complete", sourceCommit: commit, fixtureSuiteDigest: digest, modelReportDigest: digest, taskCount: 12, baselines: ["dual-surface", "full-dom", "accessibility", "vision"], tokenAccounting: "versioned_tokenizer", rawSamplesDigest: digest, completionRate: 0.95, wrongActionRate: 0, unauthorizedConsequentialActions: 0, secretLeaks: 0, medianStepImprovement: 0.4, medianTokenImprovement: 0.6, visionComparable: true, reportDigest: digest };
    expect(validate(report)).toBe(true);
    expect(validate({ ...report, tokenAccounting: "estimated_bytes" })).toBe(false);
  });
});
