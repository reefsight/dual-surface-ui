import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AGENT_ACTION_REQUEST_SCHEMA,
  AGENT_ACTION_RESULT_SCHEMA,
  AGENT_SNAPSHOT_SCHEMA,
} from "../dist/schema.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(projectRoot, "schemas");
await mkdir(outputDirectory, { recursive: true });

const schemas = [
  ["agent-snapshot-0.1.schema.json", AGENT_SNAPSHOT_SCHEMA],
  ["agent-action-request-0.1.schema.json", AGENT_ACTION_REQUEST_SCHEMA],
  ["agent-action-result-0.1.schema.json", AGENT_ACTION_RESULT_SCHEMA],
];

for (const [fileName, schema] of schemas) {
  const outputPath = resolve(outputDirectory, fileName);
  await writeFile(outputPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
  console.log(`Generated ${outputPath}`);
}
