import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AGENT_SNAPSHOT_DELTA_SCHEMA } from "../dist/delta/schema.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(projectRoot, "schemas", "phase3");
await mkdir(outputDirectory, { recursive: true });

const outputPath = resolve(
  outputDirectory,
  "agent-snapshot-delta-0.1.schema.json",
);
await writeFile(
  outputPath,
  `${JSON.stringify(AGENT_SNAPSHOT_DELTA_SCHEMA, null, 2)}\n`,
  "utf8",
);
console.log(`Generated ${outputPath}`);
