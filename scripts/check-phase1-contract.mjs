import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { findPhase1ContractDrift } from "./phase1-contract-lib.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  await readFile(
    resolve(projectRoot, "contracts", "phase1-contract-manifest.json"),
    "utf8",
  ),
);
const packageJson = JSON.parse(
  await readFile(resolve(projectRoot, "package.json"), "utf8"),
);
const runtime = await import(
  `${pathToFileURL(resolve(projectRoot, "dist", "index.js")).href}?freeze-check=${Date.now()}`
);
const actualExports = Object.keys(runtime).sort();
const fileSha256 = {};

for (const path of Object.keys({
  ...manifest.declarationSha256,
  ...manifest.schemaSha256,
})) {
  try {
    const contents = await readFile(resolve(projectRoot, path));
    fileSha256[path] = createHash("sha256").update(contents).digest("hex");
  } catch {
    // Missing files remain absent so the shared drift checker reports them.
  }
}

const failures = findPhase1ContractDrift(manifest, {
  packageVersion: packageJson.version,
  contractVersion: runtime.AGENT_CONTRACT_SCHEMA_VERSION,
  runtimeExports: actualExports,
  fileSha256,
});

if (failures.length > 0) {
  console.error("Phase 1 contract freeze check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Phase 1 contract 0.1 frozen: ${actualExports.length} runtime exports, ` +
      `${Object.keys(manifest.declarationSha256).length} declaration files, ` +
      `${Object.keys(manifest.schemaSha256).length} schemas.`,
  );
}
