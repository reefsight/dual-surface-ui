import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npmCli = process.env.npm_execpath;
const temporaryRoot = await mkdtemp(join(tmpdir(), "dual-surface-conformance-package-"));
const evidenceDirectory = join(projectRoot, ".conformance-evidence");
const installedConsumer = join(evidenceDirectory, "installed-consumer");
const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const canonicalJson = (value) => value === null || typeof value !== "object"
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? `[${value.map(canonicalJson).join(",")}]`
    : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
const sentinelCorpus = JSON.parse(await readFile(
  join(projectRoot, "fixtures", "conformance", "sentinels-0.1.json"),
  "utf8",
));
const sentinelBytes = sentinelCorpus.sentinels.map(({ value }) => Buffer.from(value, "utf8"));
const scanBytes = (bytes, channel) => {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (sentinelBytes.some((sentinel) => buffer.includes(sentinel))) {
    throw new Error(`${channel} contained a conformance sentinel`);
  }
  return buffer.byteLength;
};

const run = (command, args, cwd, scanOutput = true) => {
  const result = spawnSync(command, args, {
  cwd,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (scanOutput) {
    scanBytes(stdout, "stdout");
    scanBytes(stderr, "stderr");
  }
  if (result.status !== 0) {
    if (stderr) process.stderr.write(stderr);
    throw new Error(`command failed with status ${result.status}`);
  }
  return stdout.trim();
};

const runNpm = (args, cwd) => {
  if (!npmCli) throw new Error("npm_execpath is required; run through npm run");
  return run(process.execPath, [npmCli, ...args], cwd);
};

const initializeConsumer = async (directory) => {
  await mkdir(directory);
  await writeFile(
    join(directory, "package.json"),
    `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
  );
};

const manifestOf = async (root) => {
  const entries = [];
  let bytesScanned = 0;
  const visit = async (directory) => {
    const names = (await readdir(directory)).sort();
    for (const name of names) {
      const path = join(directory, name);
      const info = await lstat(path);
      if (info.isSymbolicLink()) throw new Error("installed package contains a symbolic link");
      if (info.isDirectory()) await visit(path);
      else if (info.isFile()) {
        const packagePath = relative(root, path).replaceAll("\\", "/");
        const contents = await readFile(path);
        bytesScanned += scanBytes(contents, "installed_package_files");
        entries.push({ path: packagePath, digest: sha256(contents) });
      } else throw new Error("installed package contains a non-regular entry");
    }
  };
  await visit(root);
  entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return { entries, digest: sha256(Buffer.from(JSON.stringify(entries), "utf8")), bytesScanned };
};

const verifyInstalledModuleGraph = async (root, manifest, entrypoints) => {
  const manifestPaths = new Set(manifest.entries.map(({ path }) => path));
  const visited = new Set();
  const visit = async (path) => {
    const resolved = await realpath(path);
    const rel = relative(root, resolved);
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) throw new Error("package module graph escaped install root");
    const packagePath = rel.replaceAll("\\", "/");
    if (!manifestPaths.has(packagePath)) throw new Error("package module graph referenced an unverified file");
    if (visited.has(resolved)) return;
    visited.add(resolved);
    if (!packagePath.endsWith(".js")) return;
    const source = await readFile(resolved, "utf8");
    const specifiers = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']([^"']+)["']/g)].map((match) => match[1]);
    for (const specifier of specifiers) {
      if (!specifier.startsWith(".")) continue;
      await visit(resolve(dirname(resolved), specifier));
    }
  };
  for (const entrypoint of entrypoints) await visit(entrypoint);
  return visited.size;
};

try {
  const packed = JSON.parse(runNpm(
    ["pack", "--pack-destination", temporaryRoot, "--json"],
    projectRoot,
  ));
  if (!Array.isArray(packed) || packed.length !== 1) throw new Error("invalid pack manifest");
  const packedFiles = packed[0].files.map(({ path }) => path);
  if (packedFiles.some((path) =>
    path.startsWith("fixtures/conformance/") ||
    path.startsWith("test/conformance/") ||
    path.includes("cross-exporter-conformance")
  )) throw new Error("private conformance material leaked into the package");

  const tarball = join(temporaryRoot, packed[0].filename);
  const tarballBytes = await readFile(tarball);
  const tarballDigest = sha256(tarballBytes);
  let packedBytesScanned = 0;
  for (const path of packedFiles) {
    const result = spawnSync("tar", ["-xOf", tarball, `package/${path.replaceAll("\\", "/")}`], {
      encoding: null,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error("unable to inspect packed package file");
    packedBytesScanned += scanBytes(result.stdout ?? Buffer.alloc(0), "packed_tarball_files");
    scanBytes(result.stderr ?? Buffer.alloc(0), "stderr");
  }
  if (packedBytesScanned === 0) throw new Error("packed package scan was empty");
  const rootConsumer = join(temporaryRoot, "root-consumer");
  const adapterConsumer = installedConsumer;
  await rm(adapterConsumer, { recursive: true, force: true });
  await mkdir(evidenceDirectory, { recursive: true });
  await Promise.all([initializeConsumer(rootConsumer), initializeConsumer(adapterConsumer)]);

  runNpm(["install", "--ignore-scripts", "--omit=optional", tarball], rootConsumer);
  for (const peer of ["@modelcontextprotocol/server", "playwright-core"]) {
    try {
      await access(join(rootConsumer, "node_modules", ...peer.split("/")));
      throw new Error(`optional peer was installed: ${peer}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("optional peer was installed:")) throw error;
      if (!error || typeof error !== "object" || error.code !== "ENOENT") throw error;
    }
  }
  const rootCheck = String.raw`
    import * as root from "dual-surface-ui";
    if (Object.keys(root).length !== 32) throw new Error("frozen root export count changed");
    try {
      await import("dual-surface-ui/conformance");
      throw new Error("private conformance export leaked");
    } catch (error) {
      if (error instanceof Error && error.message === "private conformance export leaked") throw error;
      if (!error || typeof error !== "object" || error.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error;
    }
  `;
  run(process.execPath, ["--input-type=module", "-e", rootCheck], rootConsumer);

  const mcpVersion = JSON.parse(await readFile(
    join(projectRoot, "node_modules", "@modelcontextprotocol", "server", "package.json"),
    "utf8",
  )).version;
  const mcpClientVersion = JSON.parse(await readFile(
    join(projectRoot, "node_modules", "@modelcontextprotocol", "client", "package.json"),
    "utf8",
  )).version;
  const playwrightVersion = JSON.parse(await readFile(
    join(projectRoot, "node_modules", "playwright-core", "package.json"),
    "utf8",
  )).version;
  runNpm([
    "install", "--ignore-scripts", tarball,
    `@modelcontextprotocol/server@${mcpVersion}`,
    `@modelcontextprotocol/client@${mcpClientVersion}`,
    `playwright-core@${playwrightVersion}`,
  ], adapterConsumer);

  const packageRoot = await realpath(join(adapterConsumer, "node_modules", "dual-surface-ui"));
  const installedManifest = await manifestOf(packageRoot);
  const resolutionCheck = String.raw`
    import { fileURLToPath } from "node:url";
    import { realpath } from "node:fs/promises";
    import { isAbsolute, relative } from "node:path";
    import { Client } from "@modelcontextprotocol/client";
    import { InMemoryTransport } from "@modelcontextprotocol/server";
    const root = await realpath(${JSON.stringify(packageRoot)});
    const specs = ["dual-surface-ui", "dual-surface-ui/webmcp", "dual-surface-ui/mcp", "dual-surface-ui/playwright"];
    const resolvedPackageModules = [];
    for (const spec of specs) {
      const resolved = await realpath(fileURLToPath(import.meta.resolve(spec)));
      const rel = relative(root, resolved);
      if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) throw new Error("package resolution escaped install root");
      resolvedPackageModules.push(resolved);
    }
    const [rootModule, webmcp, mcp, playwright] = await Promise.all(specs.map((spec) => import(spec)));
    if (Object.keys(rootModule).length !== 32 ||
        typeof webmcp.exportAgentSurfaceToWebMcp !== "function" ||
        typeof mcp.createAgentSurfaceMcpServer !== "function" ||
        typeof playwright.createPlaywrightSurface !== "function") {
      throw new Error("installed adapter imports are incomplete");
    }
    const action = { name: "approve", risk: "consequential" };
    const makeSurface = () => {
      const state = { mutations: 0 };
      const snapshot = { schemaVersion: "0.1", surfaceId: "package-conformance", revision: "revision-1", title: "Package conformance", url: "https://conformance.invalid/", generatedAt: "2026-09-20T00:00:00.000Z", capabilities: ["snapshot", "perform"], nodes: [{ id: "approval", role: "button", name: "Approve", state: {}, actions: [action] }] };
      return { state, snapshot: () => snapshot, performSafe: async (request) => { state.mutations += 1; return { schemaVersion: "0.1", surfaceId: snapshot.surfaceId, status: "succeeded", previousRevision: snapshot.revision, revision: "revision-2", action: request.action, targetId: request.elementId, targetPresent: true }; } };
    };
    const webSurface = makeSurface();
    let registered;
    const webHandle = await webmcp.exportAgentSurfaceToWebMcp(webSurface, { modelContext: { registerTool(tool) { registered = tool; } }, bindings: [{ name: "conformance.approve", description: "Approve", elementId: "approval", action: "approve" }] });
    if (!registered || !webHandle.supported) throw new Error("installed WebMCP conformance registration failed");
    const webResult = await registered.execute({});
    if (webResult.status !== "succeeded" || webSurface.state.mutations !== 1) throw new Error("installed WebMCP conformance execution failed");
    webHandle.dispose();
    const mcpSurface = makeSurface();
    const mcpHandle = mcp.createAgentSurfaceMcpServer(mcpSurface, { serverName: "package-conformance", serverVersion: "0.1.0", surfaceRef: "surface", principalRef: "principal", bindings: [{ name: "conformance.approve", description: "Approve", elementId: "approval", action: "approve" }], authorize: () => true });
    const client = new Client({ name: "package-conformance", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcpHandle.server.connect(serverTransport), client.connect(clientTransport)]);
    const mcpResult = await client.callTool({ name: "conformance.approve", arguments: { revision: "revision-1" } });
    if (mcpResult.structuredContent?.status !== "succeeded" || mcpSurface.state.mutations !== 1) throw new Error("installed MCP conformance execution failed");
    await client.close();
    await mcpHandle.dispose();
    console.log(JSON.stringify({ tarballDigest: ${JSON.stringify(tarballDigest)}, installedManifestDigest: ${JSON.stringify(installedManifest.digest)}, webmcpMutations: webSurface.state.mutations, mcpMutations: mcpSurface.state.mutations, resolvedPackageModules }));
  `;
  const consumerEvidence = JSON.parse(run(process.execPath, ["--input-type=module", "-e", resolutionCheck], adapterConsumer));
  if (consumerEvidence.tarballDigest !== tarballDigest || consumerEvidence.installedManifestDigest !== installedManifest.digest || consumerEvidence.webmcpMutations !== 1 || consumerEvidence.mcpMutations !== 1) {
    throw new Error("installed conformance consumer evidence did not bind package digests");
  }
  if (!Array.isArray(consumerEvidence.resolvedPackageModules) || consumerEvidence.resolvedPackageModules.length !== 4) throw new Error("installed conformance consumer omitted module resolution evidence");
  const verifiedModuleCount = await verifyInstalledModuleGraph(packageRoot, installedManifest, consumerEvidence.resolvedPackageModules);

  if (!tarballDigest.startsWith("sha256:") || !installedManifest.digest.startsWith("sha256:")) {
    throw new Error("package evidence digest failed");
  }
  const packageEvidenceProjection = {
    schemaVersion: "0.1",
    kind: "agent-conformance-package-evidence",
    package: {
      name: "dual-surface-ui",
      version: JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8")).version,
      tarballDigest,
      installedManifestDigest: installedManifest.digest,
    },
    scan: {
      packed_tarball_files: packedBytesScanned,
      installed_package_files: installedManifest.bytesScanned,
    },
    install: {
      root: packageRoot,
      manifestEntries: installedManifest.entries,
      resolvedModules: consumerEvidence.resolvedPackageModules,
      verifiedModuleCount,
    },
  };
  const packageEvidence = {
    ...packageEvidenceProjection,
    evidenceDigest: sha256(Buffer.from(`dual-surface-ui:agent-conformance-package-evidence:0.1\0${canonicalJson(packageEvidenceProjection)}`, "utf8")),
  };
  await writeFile(join(evidenceDirectory, "package.json"), `${JSON.stringify(packageEvidence)}\n`, "utf8");
  console.log(JSON.stringify({
    installedFileCount: installedManifest.entries.length,
    installedManifestDigest: installedManifest.digest,
    installedPackageBytesScanned: installedManifest.bytesScanned,
    packedPackageBytesScanned: packedBytesScanned,
    verifiedPackageModuleCount: verifiedModuleCount,
    tarballDigest,
    status: "passed",
  }));
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
