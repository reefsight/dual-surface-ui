import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const output = resolve(root, "fixtures", "phase3-exit", "contracts");
const digest = { type: "string", pattern: "^sha256:[a-f0-9]{64}$" };
const commit = { type: "string", pattern: "^[a-f0-9]{40}$" };
const identifier = { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$" };
const base = (id, title, required, properties) => ({ $schema: "https://json-schema.org/draft/2020-12/schema", $id: `https://dual-surface-ui.dev/schema/private/${id}.json`, title, type: "object", additionalProperties: false, required, properties });

const securityReview = base("p3.7-independent-security-review-0.1", "P3.7 Independent Security Review", ["schemaVersion", "kind", "status", "reviewedCommit", "corpusDigest", "matrixDigest", "reportDigest", "reviewer", "findings", "unresolvedCriticalHigh", "disposition"], {
  schemaVersion: { const: "0.1" }, kind: { const: "p3.7-independent-security-review" }, status: { enum: ["approved", "changes_required"] }, reviewedCommit: commit, corpusDigest: digest, matrixDigest: digest, reportDigest: digest,
  reviewer: { type: "object", additionalProperties: false, required: ["id", "independent"], properties: { id: identifier, independent: { type: "boolean" } } },
  findings: { type: "array", maxItems: 256, items: { type: "object", additionalProperties: false, required: ["id", "severity", "status", "summary"], properties: { id: identifier, severity: { enum: ["critical", "high", "medium", "low", "info"] }, status: { enum: ["open", "resolved", "accepted"] }, summary: { type: "string", minLength: 1, maxLength: 500 } } } },
  unresolvedCriticalHigh: { type: "integer", minimum: 0 }, disposition: { enum: ["no_unresolved_critical_high", "unresolved_findings"] },
});
const modelConfig = { type: "object", additionalProperties: false, required: ["provider", "modelSnapshot", "configDigest", "repetitions", "taskCount", "completionRate", "wrongActionRate", "unauthorizedConsequentialActions", "secretLeaks", "criticalSafetyPassRate", "environmentErrors", "rawCaseRecordsDigest"], properties: {
  provider: { type: "string", minLength: 1, maxLength: 128 }, modelSnapshot: identifier, configDigest: digest, repetitions: { type: "integer", minimum: 1 }, taskCount: { type: "integer", minimum: 12 }, completionRate: { type: "number", minimum: 0, maximum: 1 }, wrongActionRate: { type: "number", minimum: 0, maximum: 1 }, unauthorizedConsequentialActions: { type: "integer", minimum: 0 }, secretLeaks: { type: "integer", minimum: 0 }, criticalSafetyPassRate: { type: "number", minimum: 0, maximum: 1 }, environmentErrors: { type: "integer", minimum: 0 }, rawCaseRecordsDigest: digest,
} };
const modelReport = base("p3.8-multi-model-report-0.1", "P3.8 Multi-Model Evaluation Report", ["schemaVersion", "kind", "status", "sourceCommit", "packageLockDigest", "suiteDigest", "suiteFileDigest", "suiteSchemaDigest", "promptConfigDigest", "browser", "os", "measuredAt", "retention", "supportedConfigs", "reportDigest"], {
  schemaVersion: { const: "0.1" }, kind: { const: "p3.8-multi-model-report" }, status: { enum: ["complete", "incomplete"] }, sourceCommit: commit, packageLockDigest: digest, suiteDigest: digest, suiteFileDigest: digest, suiteSchemaDigest: digest, promptConfigDigest: digest, browser: { type: "string", minLength: 1, maxLength: 128 }, os: { type: "string", minLength: 1, maxLength: 128 }, measuredAt: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T" }, retention: { type: "string", minLength: 1, maxLength: 256 }, supportedConfigs: { type: "array", minItems: 2, maxItems: 16, items: modelConfig }, reportDigest: digest,
});
const benchmarkReport = base("p3.9-model-benchmark-report-0.1", "P3.9 Model Benchmark Report", ["schemaVersion", "kind", "status", "sourceCommit", "fixtureSuiteDigest", "modelReportDigest", "taskCount", "baselines", "tokenAccounting", "rawSamplesDigest", "completionRate", "wrongActionRate", "unauthorizedConsequentialActions", "secretLeaks", "medianStepImprovement", "medianTokenImprovement", "visionComparable", "reportDigest"], {
  schemaVersion: { const: "0.1" }, kind: { const: "p3.9-model-benchmark-report" }, status: { enum: ["complete", "incomplete"] }, sourceCommit: commit, fixtureSuiteDigest: digest, modelReportDigest: digest, taskCount: { type: "integer", minimum: 12 }, baselines: { type: "array", minItems: 4, uniqueItems: true, items: identifier }, tokenAccounting: { enum: ["exact_provider_usage", "versioned_tokenizer", "unavailable"] }, rawSamplesDigest: digest, completionRate: { type: "number", minimum: 0, maximum: 1 }, wrongActionRate: { type: "number", minimum: 0, maximum: 1 }, unauthorizedConsequentialActions: { type: "integer", minimum: 0 }, secretLeaks: { type: "integer", minimum: 0 }, medianStepImprovement: { type: "number", minimum: -10, maximum: 1 }, medianTokenImprovement: { type: "number", minimum: -10, maximum: 1 }, visionComparable: { type: "boolean" }, reportDigest: digest,
});

await mkdir(output, { recursive: true });
for (const [name, schema] of [["p3.7-independent-security-review-0.1.schema.json", securityReview], ["p3.8-multi-model-report-0.1.schema.json", modelReport], ["p3.9-model-benchmark-report-0.1.schema.json", benchmarkReport]]) await writeFile(resolve(output, name), `${JSON.stringify(schema, null, 2)}\n`, "utf8");
console.log("Generated 3 Phase 3 authority-bound evidence contracts.");
