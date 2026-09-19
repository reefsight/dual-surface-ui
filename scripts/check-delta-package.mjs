import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nodeCommand = process.execPath;
const npmCli = process.env.npm_execpath;
const temporaryRoot = await mkdtemp(join(tmpdir(), "dual-surface-delta-package-"));

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}

function runNpm(args, cwd) {
  if (!npmCli) throw new Error("npm_execpath is required; run through npm run");
  return run(nodeCommand, [npmCli, ...args], cwd);
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

  await access(
    join(
      consumer,
      "node_modules",
      "dual-surface-ui",
      "schemas",
      "phase3",
      "agent-snapshot-delta-0.1.schema.json",
    ),
  );

  const runtimeCheck = `
    import * as root from "dual-surface-ui";
    import { createAgentSnapshotDelta, applyAgentSnapshotDelta } from "dual-surface-ui/delta";
    if (Object.keys(root).length !== 32) throw new Error("frozen root export count changed");
    const base = {schemaVersion:"0.1",surfaceId:"s",revision:"1",title:"T",url:"https://example.test",generatedAt:"2026-09-20T00:00:00.000Z",capabilities:[],nodes:[]};
    const target = {...base,revision:"2",generatedAt:"2026-09-20T00:00:01.000Z",title:"T2"};
    const made = await createAgentSnapshotDelta(base,target);
    if (made.status !== "delta") throw new Error("delta creation failed");
    const applied = await applyAgentSnapshotDelta(base,made.delta);
    if (applied.status !== "applied" || applied.snapshot.title !== "T2") throw new Error("delta apply failed");
    const stale = await applyAgentSnapshotDelta({...base,revision:"stale"},made.delta);
    if (stale.status !== "resync_required") throw new Error("stale base did not resync");
  `;
  run(nodeCommand, ["--input-type=module", "-e", runtimeCheck], consumer);

  await writeFile(
    join(consumer, "index.ts"),
    `import type { AgentSnapshotDelta } from "dual-surface-ui/delta";\n` +
      `import { createAgentSnapshotDelta } from "dual-surface-ui/delta";\n` +
      `const create: typeof createAgentSnapshotDelta = createAgentSnapshotDelta;\n` +
      `let delta: AgentSnapshotDelta | undefined;\n` +
      `void create; void delta;\n`,
  );
  await writeFile(
    join(consumer, "tsconfig.json"),
    `${JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", skipLibCheck: true }, files: ["index.ts"] }, null, 2)}\n`,
  );
  const tsc = resolve(projectRoot, "node_modules", "typescript", "bin", "tsc");
  run(nodeCommand, [tsc, "-p", "tsconfig.json"], consumer);

  const sourceSchemaPath = join(
    projectRoot,
    "schemas",
    "phase3",
    "agent-snapshot-delta-0.1.schema.json",
  );
  const packedSchemaPath = join(
    consumer,
    "node_modules",
    "dual-surface-ui",
    "schemas",
    "phase3",
    "agent-snapshot-delta-0.1.schema.json",
  );
  const [schemaText, packedSchemaText, packedSnapshotText] = await Promise.all([
    readFile(sourceSchemaPath, "utf8"),
    readFile(packedSchemaPath, "utf8"),
    readFile(
      join(
        consumer,
        "node_modules",
        "dual-surface-ui",
        "schemas",
        "agent-snapshot-0.1.schema.json",
      ),
      "utf8",
    ),
  ]);
  if (packedSchemaText !== schemaText) {
    throw new Error("packed delta schema drifted from the generated artifact");
  }
  const deltaSchema = JSON.parse(packedSchemaText);
  const snapshotSchema = JSON.parse(packedSnapshotText);
  const ajv = new Ajv2020({ strict: true });
  addFormatsModule(ajv);
  ajv.addSchema(snapshotSchema);
  ajv.compile(deltaSchema);
  if (!schemaText.includes('"kind":')) {
    throw new Error("generated delta schema invalid");
  }

  console.log("Packed delta consumer passed runtime, declarations, schema, round-trip, stale-base, and frozen-root checks.");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
