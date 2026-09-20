import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { containsSecretSentinel } from "../dist/internal/secret-detection.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nodeCommand = process.execPath;
const npmCli = process.env.npm_execpath;
const temporaryRoot = await mkdtemp(join(tmpdir(), "dual-surface-cli-package-"));

const commandNames = ["inspect", "validate", "diff", "record", "replay", "evaluate"];
const optionalPeers = [
  "@angular/core",
  "@modelcontextprotocol/server",
  "playwright-core",
  "react",
  "vue",
];
const baseSchemaFiles = [
  "agent-action-failure-0.1.schema.json",
  "agent-action-request-0.1.schema.json",
  "agent-action-result-0.1.schema.json",
  "agent-audit-event-0.1.schema.json",
  "agent-snapshot-0.1.schema.json",
];
const priorPhase3SchemaFiles = [
  "agent-replay-fixture-0.1.schema.json",
  "agent-runtime-trace-0.1.schema.json",
  "agent-snapshot-delta-0.1.schema.json",
];
const cliSchemaFiles = [
  "agent-cli-error-0.1.schema.json",
  "agent-cli-event-0.1.schema.json",
  "agent-cli-result-0.1.schema.json",
  "agent-evaluation-definition-0.1.schema.json",
  "agent-evaluation-result-0.1.schema.json",
];

const canonicalize = (value) => Array.isArray(value)
  ? value.map(canonicalize)
  : value !== null && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
    : value;

const domainDigest = (domain, value) => `sha256:${createHash("sha256")
  .update(`${domain}\0${JSON.stringify(canonicalize(value))}`, "utf8")
  .digest("hex")}`;

const scanOutput = (value, label) => {
  // Digests are public output and can coincidentally contain a Luhn-valid digit run.
  const withoutDigests = value.replaceAll(/sha256:[a-f0-9]{64}/g, "sha256:<digest>");
  if (containsSecretSentinel(withoutDigests)) {
    throw new Error(`${label} contained a prohibited secret sentinel`);
  }
};

function run(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    input: options.input,
    shell: false,
    stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (options.scan !== false) {
    scanOutput(`${stdout}\n${stderr}`, options.label ?? command);
  }
  if (options.status !== undefined && result.status !== options.status) {
    throw new Error(
      `${options.label ?? command} exited ${result.status}; expected ${options.status}`,
    );
  }
  return { status: result.status, stdout, stderr };
}

function runNpm(args, cwd, status = 0, scan = true) {
  if (!npmCli) throw new Error("npm_execpath is required; run through npm run");
  return run(nodeCommand, [npmCli, ...args], cwd, {
    status,
    scan,
    label: `npm ${args[0] ?? ""}`,
  });
}

const normalizePackagePath = (path) => path.replaceAll("\\", "/").toLowerCase();
const allowedDistRoots = new Set([
  "angular", "cli", "delta", "domain", "drift", "internal", "mcp",
  "playwright", "react", "replay", "trace", "vue", "webmcp",
]);
const allowedDistRootFiles = new Set([
  "audit", "definition", "dom", "errors", "idempotency", "index", "policy",
  "portable-schema", "schema", "surface", "types", "validation",
]);
const allowedDistSuffixes = [".js", ".js.map", ".d.ts", ".d.ts.map"];
const allowedSchemaPaths = new Set([
  ...baseSchemaFiles.map((file) => `schemas/${file}`),
  "schemas/manifest.json",
  ...priorPhase3SchemaFiles.map((file) => `schemas/phase3/${file}`),
  ...cliSchemaFiles.map((file) => `schemas/phase3/${file}`),
]);

const allowedPackageFile = (rawPath) => {
  const path = normalizePackagePath(rawPath);
  if (path === "license" || path === "package.json" || path === "readme.md") return true;
  if (allowedSchemaPaths.has(path)) return true;
  if (!path.startsWith("dist/") || !allowedDistSuffixes.some((suffix) => path.endsWith(suffix))) {
    return false;
  }
  const relative = path.slice("dist/".length);
  const slash = relative.indexOf("/");
  if (slash >= 0) return allowedDistRoots.has(relative.slice(0, slash));
  const suffix = allowedDistSuffixes.find((candidate) => relative.endsWith(candidate));
  return suffix !== undefined && allowedDistRootFiles.has(relative.slice(0, -suffix.length));
};

const snapshot = {
  schemaVersion: "0.1",
  surfaceId: "fixture-surface",
  revision: "r1",
  title: "Fixture",
  url: "https://fixture.example/form",
  generatedAt: "2026-09-20T00:00:00.000Z",
  capabilities: [],
  nodes: [{
    id: "submit",
    role: "button",
    name: "Submit",
    state: {},
    actions: [{ name: "submit", risk: "write", inputSchema: { type: "string" } }],
  }],
};

const replayUnsigned = {
  schemaVersion: "0.1",
  kind: "agent-replay-fixture",
  fixtureId: "package-invalid-input",
  surfaceId: "fixture-surface",
  environment: { origin: "https://fixture.example", generation: "g1" },
  initialSnapshot: snapshot,
  steps: [{
    request: {
      surfaceId: "fixture-surface",
      revision: "r1",
      elementId: "submit",
      action: "submit",
      input: 7,
    },
    controls: {
      policy: "allow",
      execution: { kind: "transition", nextSnapshot: snapshot },
    },
    expected: {
      outcome: { status: "failed", code: "invalid_input" },
      lifecycle: [
        {
          event: "action_requested",
          outcome: "requested",
          sequence: 1,
          revisionRef: "revision-1",
          actionRef: "action-1",
        },
        {
          event: "action_failed",
          outcome: "invalid_input",
          sequence: 2,
          revisionRef: "revision-1",
          actionRef: "action-1",
        },
      ],
    },
  }],
  expectedFinalSnapshot: snapshot,
};
const replayFixture = {
  ...replayUnsigned,
  fixtureDigest: domainDigest("dual-surface-ui:agent-replay-fixture:0.1", replayUnsigned),
};

const evaluationUnsigned = {
  schemaVersion: "0.1",
  kind: "agent-evaluation-definition",
  suiteId: "package-cli-suite",
  dimensions: ["answer", "calls"],
  cases: [{
    caseId: "package-case",
    input: { fixture: true },
    expected: { answer: { fixture: true }, calls: 1 },
  }],
};
const evaluationDefinition = {
  ...evaluationUnsigned,
  definitionDigest: domainDigest(
    "dual-surface-ui:evaluation-definition:0.1",
    evaluationUnsigned,
  ),
};

try {
  const packResult = runNpm(
    ["pack", "--pack-destination", temporaryRoot, "--json"],
    projectRoot,
    0,
    false,
  );
  const packed = JSON.parse(packResult.stdout);
  if (!Array.isArray(packed) || packed.length !== 1) throw new Error("npm pack returned an invalid manifest");
  const unexpected = packed[0].files
    .map((file) => file.path)
    .filter((path) => !allowedPackageFile(path));
  if (unexpected.length > 0) {
    throw new Error(`tarball contains unexpected files: ${unexpected.join(", ")}`);
  }

  const tarball = join(temporaryRoot, packed[0].filename);
  const consumer = join(temporaryRoot, "consumer");
  await mkdir(consumer);
  await writeFile(
    join(consumer, "package.json"),
    `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
  );
  runNpm(["install", "--ignore-scripts", "--omit=optional", tarball], consumer);

  const packageRoot = join(consumer, "node_modules", "dual-surface-ui");
  for (const peer of optionalPeers) {
    try {
      await access(join(consumer, "node_modules", ...peer.split("/")));
      throw new Error(`optional peer was installed: ${peer}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("optional peer was installed:")) throw error;
      if (!error || typeof error !== "object" || error.code !== "ENOENT") throw error;
    }
  }

  const runtimeCheck = String.raw`
    import * as root from "dual-surface-ui";
    import * as cli from "dual-surface-ui/cli";
    if (Object.keys(root).length !== 32) throw new Error("frozen root export count changed");
    if (typeof cli.runAgentCli !== "function" || typeof cli.serializeAgentCliOutput !== "function") {
      throw new Error("CLI subpath exports are incomplete");
    }
  `;
  run(nodeCommand, ["--input-type=module", "-e", runtimeCheck], consumer, {
    status: 0,
    label: "installed root and CLI imports",
  });

  await writeFile(
    join(consumer, "index.ts"),
    `import { runAgentCli, serializeAgentCliOutput } from "dual-surface-ui/cli";\n` +
      `import type { AgentCliHost, AgentEvaluationDefinition } from "dual-surface-ui/cli";\n` +
      `const run: typeof runAgentCli = runAgentCli;\n` +
      `const serialize: typeof serializeAgentCliOutput = serializeAgentCliOutput;\n` +
      `let host: AgentCliHost | undefined; let definition: AgentEvaluationDefinition | undefined;\n` +
      `void run; void serialize; void host; void definition;\n`,
  );
  await writeFile(
    join(consumer, "tsconfig.json"),
    `${JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        lib: ["ES2022", "DOM"],
        skipLibCheck: true,
      },
      files: ["index.ts"],
    }, null, 2)}\n`,
  );
  run(
    nodeCommand,
    [resolve(projectRoot, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json"],
    consumer,
    { status: 0, label: "installed CLI declaration compile" },
  );

  const installedPhase3Files = (await readdir(join(packageRoot, "schemas", "phase3"))).sort();
  const expectedPhase3Files = [...priorPhase3SchemaFiles, ...cliSchemaFiles].sort();
  if (JSON.stringify(installedPhase3Files) !== JSON.stringify(expectedPhase3Files)) {
    throw new Error("installed Phase 3 schema set is not the exact eight-file contract");
  }
  const newSchemaFiles = installedPhase3Files.filter(
    (file) => !priorPhase3SchemaFiles.includes(file),
  );
  if (JSON.stringify(newSchemaFiles) !== JSON.stringify([...cliSchemaFiles].sort())) {
    throw new Error("installed package does not contain exactly the five CLI schemas");
  }

  const schemaDocuments = [];
  for (const file of baseSchemaFiles) {
    schemaDocuments.push(JSON.parse(await readFile(join(packageRoot, "schemas", file), "utf8")));
  }
  for (const file of expectedPhase3Files) {
    const source = await readFile(join(projectRoot, "schemas", "phase3", file), "utf8");
    const installed = await readFile(join(packageRoot, "schemas", "phase3", file), "utf8");
    if (source !== installed) throw new Error(`${file} drifted in the tarball`);
    schemaDocuments.push(JSON.parse(installed));
  }
  const ajv = new Ajv2020({ strict: true });
  addFormatsModule(ajv);
  for (const schema of schemaDocuments) ajv.addSchema(schema);
  for (const file of cliSchemaFiles) {
    const schema = schemaDocuments.find((candidate) => candidate.$id.endsWith(`/${file.replace(".schema", "")}`));
    if (!schema || typeof ajv.getSchema(schema.$id) !== "function") {
      throw new Error(`${file} did not compile with its packaged references`);
    }
  }

  const executable = join(packageRoot, "dist", "cli", "bin.js");
  const runCli = (args, status, label) => run(nodeCommand, [executable, ...args], consumer, {
    status,
    label,
  });
  for (const command of commandNames) {
    const help = runCli([command, "--help"], 0, `${command} help`);
    if (!help.stdout.startsWith("Usage:\n") || help.stderr !== "") {
      throw new Error(`${command} help did not preserve stdout/stderr framing`);
    }
    const invalid = runCli([command, "--not-an-option"], 2, `${command} invalid arguments`);
    if (invalid.stdout !== "") throw new Error(`${command} invalid arguments wrote stdout`);
    const error = JSON.parse(invalid.stderr);
    if (error.kind !== "agent-cli-error" || error.code !== "usage") {
      throw new Error(`${command} invalid arguments did not emit the stable usage envelope`);
    }
  }

  const portableShim = runNpm(
    ["exec", "--offline", "--", "dual-surface-ui", "--version"],
    consumer,
  );
  if (portableShim.stdout !== "0.1.0\n" || portableShim.stderr !== "") {
    throw new Error("npm portable executable shim returned unexpected output");
  }

  const snapshotPath = join(consumer, "snapshot.json");
  const replayPath = join(consumer, "replay.json");
  const definitionPath = join(consumer, "evaluation.json");
  const tracePath = join(consumer, "recorded-trace.json");
  const driverPath = join(projectRoot, "fixtures", "cli-drivers", "valid.mjs");
  await Promise.all([
    writeFile(snapshotPath, `${JSON.stringify(snapshot)}\n`),
    writeFile(replayPath, `${JSON.stringify(replayFixture)}\n`),
    writeFile(definitionPath, `${JSON.stringify(evaluationDefinition)}\n`),
  ]);

  const inspect = JSON.parse(runCli(["inspect", "--input", snapshotPath], 0, "inspect fixture").stdout);
  if (inspect.command !== "inspect" || inspect.status !== "completed") throw new Error("inspect fixture failed");
  const validate = JSON.parse(runCli(["validate", "--input", snapshotPath], 0, "validate fixture").stdout);
  if (validate.command !== "validate" || validate.status !== "valid") throw new Error("validate fixture failed");
  const diff = JSON.parse(runCli([
    "diff", "--base", snapshotPath, "--target", snapshotPath,
  ], 0, "diff fixture").stdout);
  if (diff.command !== "diff" || diff.status !== "no_change") throw new Error("diff fixture failed");
  const replayRun = runCli(["replay", "--input", replayPath], undefined, "replay fixture");
  const replay = JSON.parse(replayRun.stdout);
  if (replayRun.status !== 0 || replay.command !== "replay" || replay.status !== "matched") {
    throw new Error(`replay fixture failed with ${replay.status}:${replay.data?.reason ?? "unknown"}`);
  }
  const evaluateRun = runCli([
    "evaluate", "--definition", definitionPath, "--driver", driverPath, "--trust-driver",
  ], undefined, "evaluate fixture");
  const evaluateOutput = evaluateRun.stdout || evaluateRun.stderr;
  const evaluate = JSON.parse(evaluateOutput);
  if (evaluateRun.status !== 0 || evaluate.command !== "evaluate" || evaluate.status !== "complete") {
    throw new Error(`evaluate fixture failed with ${evaluateRun.status}:${evaluate.status ?? evaluate.code}`);
  }
  const record = JSON.parse(runCli([
    "record", "--driver", driverPath, "--trust-driver", "--source-id", "package-check",
    "--output", tracePath,
  ], 0, "record fixture").stdout);
  if (record.command !== "record" || record.status !== "complete") throw new Error("record fixture failed");
  const recordedTrace = JSON.parse(await readFile(tracePath, "utf8"));
  if (recordedTrace.kind !== "agent-runtime-trace" || recordedTrace.recordCount !== 1) {
    throw new Error("record did not atomically publish the expected trace fixture");
  }

  console.log(
    "Packed CLI consumer passed frozen-root, imports, declarations, exact schemas, AJV refs, executable, shim, six-command, fixture, peer, allowlist, and leak checks.",
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
