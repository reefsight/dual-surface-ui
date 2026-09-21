import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { canonicalConformanceJson, isRecord } from "./canonical.js";
import { validateConformanceTierFragment, type ConformanceTierFragment } from "./evidence.js";
import { buildConformanceReport } from "./report.js";
import { captureAndValidateSentinelCorpus, ConformanceScanCollector } from "./scanning.js";
import { captureAndValidateCapabilityMatrix, captureAndValidateConformanceScenario, captureAndValidateSuiteManifest } from "./validation.js";
import { CONFORMANCE_CASE_IDS, CONFORMANCE_TARGETS, type ConformanceRun, type ConformanceScenario } from "./types.js";
import { collectConformanceSourceEvidence, digestConformanceSourceBytes } from "./source-evidence.js";

const root = process.cwd();
const json = async (path: string): Promise<unknown> => JSON.parse(await readFile(resolve(root, path), "utf8"));
const sha256 = (bytes: Uint8Array | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;

function canonicalRun(run: ConformanceRun): ConformanceRun {
  if (run.runStatus !== "completed") return run;
  const order = new Map(CONFORMANCE_CASE_IDS.map((caseId, index) => [caseId, index]));
  return Object.freeze({ ...run, cases: Object.freeze([...run.cases].sort((a, b) => order.get(a.caseId)! - order.get(b.caseId)!)) });
}

async function loadArtifacts() {
  const matrix = await captureAndValidateCapabilityMatrix(await json("fixtures/conformance/capability-matrix-0.1.json"));
  const corpus = await captureAndValidateSentinelCorpus(await json("fixtures/conformance/sentinels-0.1.json"));
  const scenarios: ConformanceScenario[] = [];
  for (const id of CONFORMANCE_CASE_IDS) scenarios.push(await captureAndValidateConformanceScenario(await json(`fixtures/conformance/scenarios/${id}.json`)));
  const suite = await captureAndValidateSuiteManifest(await json("fixtures/conformance/suite-0.1.json"), matrix, scenarios);
  const sourceBindings = {
    "dom-jsdom": "test/conformance/drivers/dom.ts",
    "webmcp-compat": "test/conformance/drivers/webmcp.ts",
    "webmcp-native": "e2e/native/conformance-driver.ts",
    "mcp-sdk": "test/conformance/drivers/mcp.ts",
    "playwright-managed": "test/conformance/drivers/playwright.ts",
  } as const;
  if (suite.fixtureHostDigest !== digestConformanceSourceBytes(await readFile(resolve(root, "test/conformance/fixture-host.ts")))) throw new TypeError("stale_fixture_host_digest");
  for (const [targetId, path] of Object.entries(sourceBindings)) {
    if (suite.driverDigests[targetId as keyof typeof sourceBindings] !== digestConformanceSourceBytes(await readFile(resolve(root, path)))) throw new TypeError("stale_driver_digest");
  }
  return { matrix, corpus, scenarios: Object.freeze(scenarios), suite };
}

async function loadFragments(suiteDigest: string, direction: "forward" | "reverse", packageBinding: unknown): Promise<readonly ConformanceTierFragment[]> {
  const names = [
    `${direction}-dom-jsdom-node.json`, `${direction}-webmcp-compat-node.json`, `${direction}-webmcp-native-native-chrome.json`,
    `${direction}-mcp-sdk-node.json`, `${direction}-playwright-managed-chromium.json`,
  ];
  const values = await Promise.all(names.map(async (name) => validateConformanceTierFragment(
    await json(`.conformance-evidence/fragments/${name}`), suiteDigest,
  )));
  values.forEach((fragment, index) => {
    if (fragment.direction !== direction || fragment.targetId !== CONFORMANCE_TARGETS[index]!.targetId || fragment.run.targetId !== fragment.targetId) {
      throw new TypeError("invalid_conformance_fragment_target");
    }
    if (canonicalConformanceJson(fragment.package) !== canonicalConformanceJson(packageBinding)) throw new TypeError("conformance_fragment_package_mismatch");
  });
  return Object.freeze(values);
}

describe("P3.6 aggregate conformance evidence", () => {
  it("builds byte-identical strict reports from fresh forward and reverse five-target runs", async () => {
    const { matrix, corpus, scenarios, suite } = await loadArtifacts();
    const packageEvidence = await json(".conformance-evidence/package.json");
    if (!isRecord(packageEvidence) || packageEvidence.kind !== "agent-conformance-package-evidence" || !isRecord(packageEvidence.package) || !isRecord(packageEvidence.scan)) {
      throw new TypeError("invalid_conformance_package_evidence");
    }
    const { evidenceDigest, ...packageProjection } = packageEvidence;
    const expectedPackageDigest = sha256(`dual-surface-ui:agent-conformance-package-evidence:0.1\0${canonicalConformanceJson(packageProjection)}`);
    if (evidenceDigest !== expectedPackageDigest) throw new TypeError("invalid_conformance_package_evidence_digest");
    const packageBinding = { tarballDigest: packageEvidence.package.tarballDigest, installedManifestDigest: packageEvidence.package.installedManifestDigest };
    const forwardFragments = await loadFragments(suite.suiteDigest, "forward", packageBinding);
    const reverseFragments = await loadFragments(suite.suiteDigest, "reverse", packageBinding);
    const stdoutBytes = Number(process.env.CONFORMANCE_STDOUT_BYTES);
    const stderrBytes = Number(process.env.CONFORMANCE_STDERR_BYTES);
    if (!Number.isSafeInteger(stdoutBytes) || stdoutBytes <= 0 || !Number.isSafeInteger(stderrBytes) || stderrBytes <= 0) {
      throw new TypeError("missing_conformance_process_scan_evidence");
    }
    const source = await collectConformanceSourceEvidence(root);
    const makeReport = async (fragments: readonly ConformanceTierFragment[]) => {
      const scan = new ConformanceScanCollector(corpus);
      scenarios.forEach((scenario) => scan.scanEgress("scenario_artifacts", scenario));
      scan.scanEgress("capability_matrix", matrix);
      scan.scanEgress("suite_manifest", suite);
      fragments.forEach((fragment) => scan.mergePartial(fragment.scan));
      scan.recordScannedEgressBytes("stdout", stdoutBytes);
      scan.recordScannedEgressBytes("stderr", stderrBytes);
      scan.recordScannedEgressBytes("packed_tarball_files", Number(packageEvidence.scan.packed_tarball_files));
      scan.recordScannedEgressBytes("installed_package_files", Number(packageEvidence.scan.installed_package_files));
      return buildConformanceReport({
        suite,
        scenarios,
        source,
        package: packageEvidence.package as never,
        runs: fragments.map((fragment) => canonicalRun(fragment.run)),
      }, scan);
    };
    const forward = await makeReport(forwardFragments);
    const reverse = await makeReport(reverseFragments);
    const forwardBytes = canonicalConformanceJson(forward);
    expect(canonicalConformanceJson(reverse)).toBe(forwardBytes);
    expect(JSON.parse(forwardBytes)).toMatchObject({ summary: { failed: 0 }, scan: { channels: expect.arrayContaining([]) } });
    await writeFile(resolve(root, ".conformance-evidence", "report.json"), `${forwardBytes}\n`, "utf8");
  }, 30_000);
});
