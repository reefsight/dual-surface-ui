import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { JSDOM } from "jsdom";
import { createAgentSurface } from "../../dist/index.js";

import {
  createDocumentApprovalWorkflow,
  installWindowGlobals,
} from "./workflow.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const html = await readFile(resolve(here, "index.html"), "utf8");
const dom = new JSDOM(html, { url: "https://example.test/approvals/DOC-1042" });
installWindowGlobals(dom.window);

const workflow = createDocumentApprovalWorkflow({
  document: dom.window.document,
  createAgentSurface,
});
const outcome = await workflow.runAgentWorkflow();

console.log(
  JSON.stringify(
    {
      documentStatus: workflow.status.textContent,
      actionStatus: outcome.result.status,
      revision: outcome.result.revision,
      steps: outcome.steps,
      confirmations: workflow.confirmationCount,
      auditEvents: workflow.auditEvents.map(({ event, outcome: result }) => ({
        event,
        outcome: result,
      })),
    },
    null,
    2,
  ),
);
