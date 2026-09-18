import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { createAgentSurface } from "../../dist/index.js";
import {
  createDocumentApprovalWorkflow,
  installWindowGlobals,
} from "../../examples/document-approval/workflow.mjs";
import { createActionCatalog, measureDataset, scaleSnapshot } from "./codec.mjs";

const experimentRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(experimentRoot, "../..");
const html = await readFile(
  resolve(projectRoot, "examples/document-approval/index.html"),
  "utf8",
);
const dom = new JSDOM(html, {
  url: "https://example.test/approvals/DOC-1042",
});
installWindowGlobals(dom.window);
const workflow = createDocumentApprovalWorkflow({
  document: dom.window.document,
  createAgentSurface,
});
const snapshot = workflow.surface.snapshot();
const scaledSnapshot = scaleSnapshot(snapshot, 20);
const actionCatalog = createActionCatalog(scaleSnapshot(snapshot, 40));

const secretSentinel = "SECRET_SENTINEL_DO_NOT_EXPOSE";
const serializedInputs = JSON.stringify({ snapshot, scaledSnapshot, actionCatalog });
if (serializedInputs.includes(secretSentinel)) {
  throw new Error("Redaction precondition failed: secret sentinel reached the codec experiment");
}

const datasets = [
  measureDataset("document-approval-snapshot", snapshot),
  measureDataset("document-approval-snapshot-scaled-20x", scaledSnapshot),
  measureDataset("uniform-action-catalog", actionCatalog),
];
dom.window.close();

const report = {
  schemaVersion: "1",
  experiment: "toon-codec",
  measuredAt: new Date().toISOString(),
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: projectRoot,
    encoding: "utf8",
  }).trim(),
  environment: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    tokenizer: "o200k_base via gpt-tokenizer 4.0.0",
    toon: "@toon-format/toon 4.1.1 strict decode",
  },
  safety: {
    inputSecretSentinelAbsent: true,
    commaRoundTrip: true,
    tabRoundTrip: true,
  },
  datasets,
};

const output = `${JSON.stringify(report, null, 2)}\n`;
if (process.argv.includes("--write")) {
  await writeFile(resolve(experimentRoot, "toon-codec-report.json"), output, "utf8");
}
process.stdout.write(output);
