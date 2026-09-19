import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { containsSecretSentinel } from "../dist/internal/secret-detection.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nodeCommand = process.execPath;
const npmCli = process.env.npm_execpath;
const temporaryRoot = await mkdtemp(join(tmpdir(), "dual-surface-trace-replay-"));

function run(command, args, cwd, scanOutput = true) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (scanOutput && containsSecretSentinel(`${stdout}\n${stderr}`)) {
    throw new Error("command output contained a prohibited secret sentinel");
  }
  if (result.status !== 0) {
    if (stderr) process.stderr.write(stderr);
    throw new Error(`command failed with status ${result.status}`);
  }
  return stdout.trim();
}

function runNpm(args, cwd) {
  if (!npmCli) throw new Error("npm_execpath is required; run through npm run");
  return run(nodeCommand, [npmCli, ...args], cwd, args[0] !== "pack");
}

try {
  const packed = JSON.parse(
    runNpm(["pack", "--pack-destination", temporaryRoot, "--json"], projectRoot),
  );
  const tarball = join(temporaryRoot, packed[0].filename);
  const consumer = join(temporaryRoot, "consumer");
  await mkdir(consumer);
  await writeFile(
    join(consumer, "package.json"),
    `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
  );
  runNpm(["install", "--ignore-scripts", "--omit=optional", tarball], consumer);

  const runtimeCheck = String.raw`
    import * as root from "dual-surface-ui";
    import { createAgentTraceRecorder, captureAndValidateAgentRuntimeTrace } from "dual-surface-ui/trace";
    import { replayAgentFixture } from "dual-surface-ui/replay";
    if (Object.keys(root).length !== 32) throw new Error("frozen root export count changed");
    const audit = (event,outcome,sequence) => ({schemaVersion:"0.1",event,correlationId:"flow-a",surfaceId:"surface-a",revision:"revision-a",sequence,timestamp:"2026-09-20T00:00:00.000Z",durationMs:1,outcome,action:"submit"});
    const recorder = createAgentTraceRecorder({sourceId:"package-check"});
    recorder.record(audit("action_requested","requested",1));
    recorder.record(audit("policy_decided","deny",2));
    recorder.record(audit("action_failed","authorization_required",3));
    const finished = await recorder.finish();
    if (finished.status !== "complete") throw new Error("trace recording failed");
    await captureAndValidateAgentRuntimeTrace(finished.trace);

    const action = {name:"submit",risk:"write",inputSchema:{type:"string"}};
    const snap = {schemaVersion:"0.1",surfaceId:"fixture-surface",revision:"r1",title:"Fixture",url:"https://fixture.example/form",generatedAt:"2026-09-20T00:00:00.000Z",capabilities:[],nodes:[{id:"submit",role:"button",name:"Submit",state:{},actions:[action]}]};
    const unsigned = {schemaVersion:"0.1",kind:"agent-replay-fixture",fixtureId:"package-invalid-input",surfaceId:"fixture-surface",environment:{origin:"https://fixture.example",generation:"g1"},initialSnapshot:snap,steps:[{request:{surfaceId:"fixture-surface",revision:"r1",elementId:"submit",action:"submit",input:7},controls:{policy:"allow",execution:{kind:"transition",nextSnapshot:snap}},expected:{outcome:{status:"failed",code:"invalid_input"},lifecycle:[{event:"action_requested",outcome:"requested",sequence:1,revisionRef:"revision-1",actionRef:"action-1"},{event:"action_failed",outcome:"invalid_input",sequence:2,revisionRef:"revision-1",actionRef:"action-1"}]}}],expectedFinalSnapshot:snap};
    const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key)=>[key,canonical(value[key])])) : value;
    const bytes = new TextEncoder().encode("dual-surface-ui:agent-replay-fixture:0.1\0"+JSON.stringify(canonical(unsigned)));
    const digest = await crypto.subtle.digest("SHA-256",bytes);
    const hex = Array.from(new Uint8Array(digest),(byte)=>byte.toString(16).padStart(2,"0")).join("");
    const replay = await replayAgentFixture({...unsigned,fixtureDigest:"sha256:"+hex});
    if (replay.status !== "matched") throw new Error("synthetic replay failed");
  `;
  run(nodeCommand, ["--input-type=module", "-e", runtimeCheck], consumer);

  await writeFile(
    join(consumer, "index.ts"),
    `import { createAgentTraceRecorder } from "dual-surface-ui/trace";\n` +
      `import { replayAgentFixture } from "dual-surface-ui/replay";\n` +
      `void createAgentTraceRecorder; void replayAgentFixture;\n`,
  );
  await writeFile(
    join(consumer, "tsconfig.json"),
    `${JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", skipLibCheck: true }, files: ["index.ts"] }, null, 2)}\n`,
  );
  run(
    nodeCommand,
    [resolve(projectRoot, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json"],
    consumer,
  );

  const packageRoot = join(consumer, "node_modules", "dual-surface-ui");
  const schemaFiles = [
    "agent-runtime-trace-0.1.schema.json",
    "agent-replay-fixture-0.1.schema.json",
  ];
  const snapshotSchema = JSON.parse(
    await readFile(join(packageRoot, "schemas", "agent-snapshot-0.1.schema.json"), "utf8"),
  );
  const requestSchema = JSON.parse(
    await readFile(join(packageRoot, "schemas", "agent-action-request-0.1.schema.json"), "utf8"),
  );
  for (const fileName of schemaFiles) {
    const source = await readFile(join(projectRoot, "schemas", "phase3", fileName), "utf8");
    const installed = await readFile(join(packageRoot, "schemas", "phase3", fileName), "utf8");
    if (source !== installed) throw new Error(`${fileName} drifted in the tarball`);
    const ajv = new Ajv2020({ strict: true });
    addFormatsModule(ajv);
    ajv.addSchema(snapshotSchema);
    ajv.addSchema(requestSchema);
    ajv.compile(JSON.parse(installed));
  }

  const allowedSchemaFiles = new Set([
    "schemas/agent-action-failure-0.1.schema.json",
    "schemas/agent-action-request-0.1.schema.json",
    "schemas/agent-action-result-0.1.schema.json",
    "schemas/agent-audit-event-0.1.schema.json",
    "schemas/agent-snapshot-0.1.schema.json",
    "schemas/manifest.json",
    "schemas/phase3/agent-replay-fixture-0.1.schema.json",
    "schemas/phase3/agent-runtime-trace-0.1.schema.json",
    "schemas/phase3/agent-snapshot-delta-0.1.schema.json",
  ]);
  const allowedPackageFile = (path) =>
    path === "license" ||
    path === "package.json" ||
    path === "readme.md" ||
    /^dist\/.+\.(?:js|js\.map|d\.ts|d\.ts\.map)$/.test(path) ||
    allowedSchemaFiles.has(path);
  const unexpected = packed[0].files
    .map((file) => file.path.toLowerCase().replaceAll("\\", "/"))
    .filter((path) => !allowedPackageFile(path));
  if (unexpected.length > 0) {
    throw new Error(`tarball contains unexpected files: ${unexpected.join(", ")}`);
  }
  for (const file of packed[0].files) {
    const packagePath = file.path.replaceAll("\\", "/");
    const normalizedPath = packagePath.toLowerCase();
    const securityRelevant =
      normalizedPath === "schemas/phase3/agent-runtime-trace-0.1.schema.json" ||
      normalizedPath === "schemas/phase3/agent-replay-fixture-0.1.schema.json";
    if (!securityRelevant) continue;
    const contents = await readFile(
      join(packageRoot, ...packagePath.split("/")),
      "utf8",
    );
    if (containsSecretSentinel(contents)) {
      throw new Error(
        `packed file contains a prohibited secret sentinel: ${normalizedPath}`,
      );
    }
  }
  console.log("Packed trace/replay consumers passed runtime, declarations, schemas, replay, redaction, and frozen-root checks.");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
