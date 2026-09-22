import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createNativeProtocolSessionFixtureCorpus } from "./native-protocol-session-corpus.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(projectRoot, "fixtures", "native-protocol");
const outputPath = resolve(outputDirectory, "session-corpus-0.1.json");
await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(createNativeProtocolSessionFixtureCorpus(), null, 2)}\n`, "utf8");
console.log(`Generated ${outputPath}`);
