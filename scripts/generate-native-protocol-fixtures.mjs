import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createNativeProtocolFixtureCorpus } from "./native-protocol-fixture-corpus.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(projectRoot, "fixtures", "native-protocol");
const outputPath = resolve(outputDirectory, "corpus-0.1.json");
await mkdir(outputDirectory, { recursive: true });
await writeFile(
  outputPath,
  `${JSON.stringify(createNativeProtocolFixtureCorpus(), null, 2)}\n`,
  "utf8",
);
console.log(`Generated ${outputPath}`);
