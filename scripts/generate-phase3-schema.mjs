import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AGENT_SNAPSHOT_DELTA_SCHEMA } from "../dist/delta/schema.js";
import { AGENT_RUNTIME_TRACE_SCHEMA } from "../dist/trace/schema.js";
import { AGENT_REPLAY_FIXTURE_SCHEMA } from "../dist/replay/schema.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(projectRoot, "schemas", "phase3");
await mkdir(outputDirectory, { recursive: true });

const schemas = [
  ["agent-snapshot-delta-0.1.schema.json", AGENT_SNAPSHOT_DELTA_SCHEMA],
  ["agent-runtime-trace-0.1.schema.json", AGENT_RUNTIME_TRACE_SCHEMA],
  ["agent-replay-fixture-0.1.schema.json", AGENT_REPLAY_FIXTURE_SCHEMA],
];

for (const [fileName, schema] of schemas) {
  const outputPath = resolve(outputDirectory, fileName);
  await writeFile(outputPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
  console.log(`Generated ${outputPath}`);
}
