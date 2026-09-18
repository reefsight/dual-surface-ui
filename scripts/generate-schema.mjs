import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AGENT_SNAPSHOT_SCHEMA } from "../dist/schema.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(projectRoot, "schemas");
const outputPath = resolve(outputDirectory, "agent-snapshot-0.1.schema.json");

await mkdir(outputDirectory, { recursive: true });
await writeFile(
  outputPath,
  `${JSON.stringify(AGENT_SNAPSHOT_SCHEMA, null, 2)}\n`,
  "utf8",
);

console.log(`Generated ${outputPath}`);
