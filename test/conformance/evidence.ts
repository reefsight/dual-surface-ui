import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { canonicalConformanceJson, captureConformanceJson, digestConformanceValue, isDigest, isRecord, withoutTopLevelField } from "./canonical.js";
import type { ConformanceRun, ConformanceScanChannelEvidence, ConformanceTargetId } from "./types.js";

const FRAGMENT_DOMAIN = "dual-surface-ui:agent-conformance-fragment:0.1\0";

export interface ConformanceTierFragment {
  readonly schemaVersion: "0.1";
  readonly kind: "agent-conformance-tier-fragment";
  readonly suiteDigest: `sha256:${string}`;
  readonly targetId: ConformanceTargetId;
  readonly environmentKey: string;
  readonly package: { readonly tarballDigest: `sha256:${string}`; readonly installedManifestDigest: `sha256:${string}` };
  readonly direction: "forward" | "reverse";
  readonly run: ConformanceRun;
  readonly scan: readonly ConformanceScanChannelEvidence[];
  readonly fragmentDigest: `sha256:${string}`;
}

export async function writeConformanceTierFragment(input: Omit<ConformanceTierFragment, "schemaVersion" | "kind" | "package" | "fragmentDigest">): Promise<void> {
  const evidencePath = resolve(process.cwd(), ".conformance-evidence", "package.json");
  let packageEvidence: unknown;
  try { packageEvidence = JSON.parse(await readFile(evidencePath, "utf8")); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  if (!isRecord(packageEvidence) || !isRecord(packageEvidence.package) ||
    typeof packageEvidence.package.tarballDigest !== "string" || typeof packageEvidence.package.installedManifestDigest !== "string") {
    throw new TypeError("invalid_conformance_package_evidence");
  }
  const packageBinding = { tarballDigest: packageEvidence.package.tarballDigest, installedManifestDigest: packageEvidence.package.installedManifestDigest };
  const projection = captureConformanceJson({ schemaVersion: "0.1", kind: "agent-conformance-tier-fragment", ...input, package: packageBinding });
  const fragmentDigest = await digestConformanceValue(FRAGMENT_DOMAIN, projection);
  const fragment = captureConformanceJson({ ...(isRecord(projection) ? projection : {}), fragmentDigest });
  const directory = resolve(process.cwd(), ".conformance-evidence", "fragments");
  await mkdir(directory, { recursive: true });
  const safeEnvironment = input.environmentKey.replace(/[^A-Za-z0-9._-]/g, "-");
  await writeFile(resolve(directory, `${input.direction}-${input.targetId}-${safeEnvironment}.json`), `${canonicalConformanceJson(fragment)}\n`, { encoding: "utf8", flag: "w" });
}

export async function validateConformanceTierFragment(value: unknown, expectedSuiteDigest: string): Promise<ConformanceTierFragment> {
  const captured = captureConformanceJson(value);
  if (!isRecord(captured) || captured.schemaVersion !== "0.1" || captured.kind !== "agent-conformance-tier-fragment" || captured.suiteDigest !== expectedSuiteDigest) {
    throw new TypeError("invalid_conformance_fragment");
  }
  const keys = Object.keys(captured).sort().join("\0");
  if (keys !== ["schemaVersion", "kind", "suiteDigest", "targetId", "environmentKey", "package", "direction", "run", "scan", "fragmentDigest"].sort().join("\0") ||
    (captured.direction !== "forward" && captured.direction !== "reverse")) {
    throw new TypeError("invalid_conformance_fragment");
  }
  if (!isRecord(captured.package) || Object.keys(captured.package).sort().join("\0") !== ["tarballDigest", "installedManifestDigest"].sort().join("\0") ||
    !isDigest(captured.package.tarballDigest) || !isDigest(captured.package.installedManifestDigest) || !isRecord(captured.run) || !Array.isArray(captured.scan)) {
    throw new TypeError("invalid_conformance_fragment");
  }
  const digest = await digestConformanceValue(FRAGMENT_DOMAIN, withoutTopLevelField(captured, "fragmentDigest"));
  if (captured.fragmentDigest !== digest) throw new TypeError("invalid_conformance_fragment_digest");
  return captured as unknown as ConformanceTierFragment;
}
