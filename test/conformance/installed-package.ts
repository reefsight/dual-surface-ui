import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { createAgentSurface as CreateAgentSurface } from "../../src/surface.js";
import type { exportAgentSurfaceToWebMcp as ExportAgentSurfaceToWebMcp } from "../../src/webmcp/index.js";
import type { createAgentSurfaceMcpServer as CreateAgentSurfaceMcpServer } from "../../src/mcp/index.js";
import type { createPlaywrightSurface as CreatePlaywrightSurface } from "../../src/playwright/index.js";
import { captureConformanceJson, digestConformanceValue, isRecord, withoutTopLevelField } from "./canonical.js";

const PACKAGE_EVIDENCE_DOMAIN = "dual-surface-ui:agent-conformance-package-evidence:0.1\0";
const ENTRYPOINTS = Object.freeze({
  root: "dist/index.js",
  webmcp: "dist/webmcp/index.js",
  mcp: "dist/mcp/index.js",
  playwright: "dist/playwright/index.js",
});

export interface InstalledPackageBinding {
  readonly tarballDigest: `sha256:${string}`;
  readonly installedManifestDigest: `sha256:${string}`;
}

export interface InstalledPackageApis {
  readonly binding: InstalledPackageBinding;
  readonly createAgentSurface: typeof CreateAgentSurface;
  readonly normalizeAgentFailure: (error: unknown) => { readonly code: string };
  readonly exportAgentSurfaceToWebMcp: typeof ExportAgentSurfaceToWebMcp;
  readonly createAgentSurfaceMcpServer: typeof CreateAgentSurfaceMcpServer;
  readonly createPlaywrightSurface: typeof CreatePlaywrightSurface;
}

interface InstalledEvidence {
  readonly root: string;
  readonly entries: ReadonlyMap<string, string>;
  readonly resolvedModules: readonly string[];
  readonly verifiedModuleCount: number;
  readonly binding: InstalledPackageBinding;
}

const sha256 = (bytes: Uint8Array | string): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

function containedPath(root: string, path: string): string {
  const rel = relative(root, path);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new TypeError("installed_package_path_escape");
  }
  return rel.replaceAll("\\", "/");
}

async function readAndValidateEvidence(): Promise<InstalledEvidence> {
  const path = resolve(process.cwd(), ".conformance-evidence", "package.json");
  const captured = captureConformanceJson(JSON.parse(await readFile(path, "utf8")));
  if (!isRecord(captured) || captured.schemaVersion !== "0.1" ||
    captured.kind !== "agent-conformance-package-evidence" || !isRecord(captured.package) ||
    !isRecord(captured.install) || typeof captured.evidenceDigest !== "string") {
    throw new TypeError("invalid_installed_package_evidence");
  }
  const expectedDigest = await digestConformanceValue(
    PACKAGE_EVIDENCE_DOMAIN,
    withoutTopLevelField(captured, "evidenceDigest"),
  );
  if (captured.evidenceDigest !== expectedDigest) throw new TypeError("invalid_installed_package_evidence_digest");
  const { package: packageValue, install } = captured;
  if (typeof packageValue.tarballDigest !== "string" ||
    typeof packageValue.installedManifestDigest !== "string" ||
    !/^sha256:[0-9a-f]{64}$/.test(packageValue.tarballDigest) ||
    !/^sha256:[0-9a-f]{64}$/.test(packageValue.installedManifestDigest) ||
    typeof install.root !== "string" || !Array.isArray(install.manifestEntries) ||
    !Array.isArray(install.resolvedModules) || !Number.isSafeInteger(install.verifiedModuleCount)) {
    throw new TypeError("invalid_installed_package_evidence");
  }
  const root = await realpath(install.root);
  if (root !== install.root) throw new TypeError("installed_package_root_alias");
  const entries = new Map<string, string>();
  for (const value of install.manifestEntries) {
    if (!isRecord(value) || typeof value.path !== "string" || typeof value.digest !== "string" ||
      !/^sha256:[0-9a-f]{64}$/.test(value.digest) || entries.has(value.path)) {
      throw new TypeError("invalid_installed_package_manifest");
    }
    entries.set(value.path, value.digest);
  }
  const resolvedModules = install.resolvedModules.map((value) => {
    if (typeof value !== "string") throw new TypeError("invalid_installed_package_module_graph");
    return value;
  });
  if (resolvedModules.length !== 4 || install.verifiedModuleCount < resolvedModules.length) {
    throw new TypeError("invalid_installed_package_module_graph");
  }
  return Object.freeze({
    root,
    entries,
    resolvedModules: Object.freeze(resolvedModules),
    verifiedModuleCount: install.verifiedModuleCount as number,
    binding: Object.freeze({
      tarballDigest: packageValue.tarballDigest as `sha256:${string}`,
      installedManifestDigest: packageValue.installedManifestDigest as `sha256:${string}`,
    }),
  });
}

async function verifyInstalledTree(evidence: InstalledEvidence): Promise<void> {
  const observed: Array<{ path: string; digest: string }> = [];
  const visit = async (directory: string): Promise<void> => {
    for (const name of (await readdir(directory)).sort()) {
      const path = resolve(directory, name);
      const info = await lstat(path);
      if (info.isSymbolicLink()) throw new TypeError("installed_package_symlink");
      if (info.isDirectory()) await visit(path);
      else if (info.isFile()) {
        const packagePath = containedPath(evidence.root, path);
        const digest = sha256(await readFile(path));
        if (evidence.entries.get(packagePath) !== digest) throw new TypeError("installed_package_manifest_mismatch");
        observed.push({ path: packagePath, digest });
      } else throw new TypeError("installed_package_non_regular_entry");
    }
  };
  await visit(evidence.root);
  if (observed.length !== evidence.entries.size) throw new TypeError("installed_package_manifest_mismatch");
  observed.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  if (sha256(JSON.stringify(observed)) !== evidence.binding.installedManifestDigest) {
    throw new TypeError("installed_package_manifest_digest_mismatch");
  }
}

async function verifyModuleGraph(evidence: InstalledEvidence): Promise<Readonly<Record<keyof typeof ENTRYPOINTS, string>>> {
  const visited = new Set<string>();
  const visit = async (path: string): Promise<void> => {
    const resolved = await realpath(path);
    const packagePath = containedPath(evidence.root, resolved);
    if (!evidence.entries.has(packagePath)) throw new TypeError("unverified_installed_package_module");
    if (visited.has(resolved)) return;
    visited.add(resolved);
    if (!packagePath.endsWith(".js")) return;
    const source = await readFile(resolved, "utf8");
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']([^"']+)["']/g)) {
      const specifier = match[1]!;
      if (specifier.startsWith(".")) await visit(resolve(resolved, "..", specifier));
    }
  };
  const entrypoints = {} as Record<keyof typeof ENTRYPOINTS, string>;
  for (const [key, relativePath] of Object.entries(ENTRYPOINTS) as Array<[keyof typeof ENTRYPOINTS, string]>) {
    const path = await realpath(resolve(evidence.root, relativePath));
    if (!evidence.resolvedModules.includes(path)) throw new TypeError("installed_package_resolution_mismatch");
    await visit(path);
    entrypoints[key] = path;
  }
  if (visited.size !== evidence.verifiedModuleCount) {
    throw new TypeError("installed_package_module_graph_count_mismatch");
  }
  return Object.freeze(entrypoints);
}

let cached: Promise<InstalledPackageApis> | undefined;

export function loadInstalledPackageApis(): Promise<InstalledPackageApis> {
  return cached ??= (async () => {
    const evidence = await readAndValidateEvidence();
    await verifyInstalledTree(evidence);
    const entrypoints = await verifyModuleGraph(evidence);
    const [root, webmcp, mcp, playwright] = await Promise.all([
      import(pathToFileURL(entrypoints.root).href),
      import(pathToFileURL(entrypoints.webmcp).href),
      import(pathToFileURL(entrypoints.mcp).href),
      import(pathToFileURL(entrypoints.playwright).href),
    ]);
    if (typeof root.createAgentSurface !== "function" || typeof root.normalizeAgentFailure !== "function" ||
      typeof webmcp.exportAgentSurfaceToWebMcp !== "function" ||
      typeof mcp.createAgentSurfaceMcpServer !== "function" ||
      typeof playwright.createPlaywrightSurface !== "function") {
      throw new TypeError("installed_package_api_incomplete");
    }
    return Object.freeze({
      binding: evidence.binding,
      createAgentSurface: root.createAgentSurface,
      normalizeAgentFailure: root.normalizeAgentFailure,
      exportAgentSurfaceToWebMcp: webmcp.exportAgentSurfaceToWebMcp,
      createAgentSurfaceMcpServer: mcp.createAgentSurfaceMcpServer,
      createPlaywrightSurface: playwright.createPlaywrightSurface,
    }) as InstalledPackageApis;
  })();
}
