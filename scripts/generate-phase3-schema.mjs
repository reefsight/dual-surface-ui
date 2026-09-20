import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AGENT_SNAPSHOT_DELTA_SCHEMA } from "../dist/delta/schema.js";
import { AGENT_RUNTIME_TRACE_SCHEMA } from "../dist/trace/schema.js";
import { AGENT_REPLAY_FIXTURE_SCHEMA } from "../dist/replay/schema.js";
import {
  AGENT_EVALUATION_DEFINITION_SCHEMA,
  AGENT_EVALUATION_RESULT_SCHEMA,
} from "../dist/cli/evaluation-schema.js";
import {
  AGENT_CLI_ERROR_SCHEMA,
  AGENT_CLI_EVENT_SCHEMA,
  AGENT_CLI_RESULT_SCHEMA,
} from "../dist/cli/output-schema.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(projectRoot, "schemas", "phase3");
await mkdir(outputDirectory, { recursive: true });

const schemas = [
  ["agent-snapshot-delta-0.1.schema.json", AGENT_SNAPSHOT_DELTA_SCHEMA],
  ["agent-runtime-trace-0.1.schema.json", AGENT_RUNTIME_TRACE_SCHEMA],
  ["agent-replay-fixture-0.1.schema.json", AGENT_REPLAY_FIXTURE_SCHEMA],
  ["agent-evaluation-definition-0.1.schema.json", AGENT_EVALUATION_DEFINITION_SCHEMA],
  ["agent-evaluation-result-0.1.schema.json", AGENT_EVALUATION_RESULT_SCHEMA],
  ["agent-cli-result-0.1.schema.json", AGENT_CLI_RESULT_SCHEMA],
  ["agent-cli-event-0.1.schema.json", AGENT_CLI_EVENT_SCHEMA],
  ["agent-cli-error-0.1.schema.json", AGENT_CLI_ERROR_SCHEMA],
];

for (const [fileName, schema] of schemas) {
  const outputPath = resolve(outputDirectory, fileName);
  await writeFile(outputPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
  console.log(`Generated ${outputPath}`);
}
