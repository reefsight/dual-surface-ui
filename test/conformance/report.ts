import { captureConformanceJson, ConformanceValidationError, digestConformanceValue, isDigest, isRecord } from "./canonical.js";
import type { ConformanceScanCollector } from "./scanning.js";
import { captureAndValidateConformanceReport, CONFORMANCE_DOMAINS } from "./validation.js";
import type { ConformanceRun, ConformanceScenario, ConformanceSuiteManifest } from "./types.js";
import { CONFORMANCE_CASE_IDS, CONFORMANCE_TARGETS } from "./types.js";

export interface ConformanceReportInput {
  readonly suite: ConformanceSuiteManifest;
  readonly scenarios?: readonly ConformanceScenario[];
  readonly source: { readonly commit: string; readonly treeDigest: `sha256:${string}`; readonly dirty: false };
  readonly package: { readonly name: string; readonly version: string; readonly tarballDigest: `sha256:${string}`; readonly installedManifestDigest: `sha256:${string}` };
  readonly runs: readonly ConformanceRun[];
}

export async function buildConformanceReport(
  input: ConformanceReportInput,
  scan: ConformanceScanCollector,
) {
  if (!/^[a-f0-9]{40}$/.test(input.source.commit) || input.source.dirty !== false || !isDigest(input.source.treeDigest)) {
    throw new ConformanceValidationError("invalid_source_evidence");
  }
  if (!isDigest(input.package.tarballDigest) || !isDigest(input.package.installedManifestDigest)) {
    throw new ConformanceValidationError("invalid_package_evidence");
  }
  if (input.runs.length !== CONFORMANCE_TARGETS.length) throw new ConformanceValidationError("invalid_run_set");
  input.runs.forEach((run, index) => {
    const target = CONFORMANCE_TARGETS[index]!;
    if (run.targetId !== target.targetId || run.family !== target.family || run.tier !== target.tier) {
      throw new ConformanceValidationError("invalid_run_set");
    }
    if (run.runStatus === "completed") {
      if (run.cases.length !== 26 || !run.cases.every((item, caseIndex) => item.caseId === CONFORMANCE_CASE_IDS[caseIndex])) {
        throw new ConformanceValidationError("invalid_case_set");
      }
    } else if (run.cases.length !== 0) throw new ConformanceValidationError("invalid_environment_failure");
  });
  const totals = input.runs.reduce((value, run) => ({
    passed: value.passed + run.summary.passed,
    failed: value.failed + run.summary.failed + (run.runStatus === "environment_failed" ? 1 : 0),
    unsupported: value.unsupported + run.summary.unsupported,
  }), { passed: 0, failed: 0, unsupported: 0 });
  const projection = captureConformanceJson({
    schemaVersion: "0.1",
    kind: "agent-conformance-report",
    suiteId: input.suite.suiteId,
    suiteDigest: input.suite.suiteDigest,
    matrixDigest: input.suite.matrixDigest,
    sentinelSetDigest: input.suite.sentinelSetDigest,
    source: input.source,
    package: input.package,
    runs: input.runs,
    summary: totals,
  });
  scan.scanEgress("report_payload", projection);
  if (scan.evidence().sentinelSetDigest !== input.suite.sentinelSetDigest) {
    throw new ConformanceValidationError("sentinel_set_digest_mismatch");
  }
  const complete = captureConformanceJson({
    ...(isRecord(projection) ? projection : {}),
    scan: scan.evidence(),
  });
  const reportDigest = await digestConformanceValue(CONFORMANCE_DOMAINS.report, complete);
  return captureAndValidateConformanceReport(
    captureConformanceJson({ ...(isRecord(complete) ? complete : {}), reportDigest }),
    input.suite,
    input.scenarios,
  );
}
