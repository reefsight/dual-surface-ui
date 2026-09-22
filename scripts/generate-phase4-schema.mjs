import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  NATIVE_PROTOCOL_CLIENT_HELLO_SCHEMA,
  NATIVE_PROTOCOL_HANDSHAKE_SCHEMA,
} from "../dist/native-protocol/schema.js";
import {
  NATIVE_PROTOCOL_DATA_SCHEMA,
  NATIVE_PROTOCOL_MESSAGE_SCHEMA,
} from "../dist/native-protocol/data-schema.js";
import { NATIVE_PROTOCOL_EXECUTION_SCHEMA } from "../dist/native-protocol/execution-schema.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(projectRoot, "schemas", "native");
await mkdir(outputDirectory, { recursive: true });

const schemas = [
  ["native-protocol-client-hello-0.1.schema.json", NATIVE_PROTOCOL_CLIENT_HELLO_SCHEMA],
  ["native-protocol-handshake-0.1.schema.json", NATIVE_PROTOCOL_HANDSHAKE_SCHEMA],
  ["native-protocol-data-0.1.schema.json", NATIVE_PROTOCOL_DATA_SCHEMA],
  ["native-protocol-execution-0.1.schema.json", NATIVE_PROTOCOL_EXECUTION_SCHEMA],
  ["native-protocol-message-0.1.schema.json", NATIVE_PROTOCOL_MESSAGE_SCHEMA],
];

for (const [fileName, schema] of schemas) {
  const outputPath = resolve(outputDirectory, fileName);
  await writeFile(outputPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
  console.log(`Generated ${outputPath}`);
}
