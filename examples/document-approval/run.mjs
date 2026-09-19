import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { JSDOM } from "jsdom";
import { createAgentSurface } from "../../dist/index.js";
import { defineDomainElement } from "../../dist/domain/index.js";
import { exportAgentSurfaceToWebMcp } from "../../dist/webmcp/index.js";

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
  defineDomainElement,
});
const outcome = await workflow.runWebMcpAgentWorkflow({
  exportAgentSurfaceToWebMcp,
});

console.log(
  JSON.stringify(
    {
      documentStatus: workflow.status.textContent,
      actionStatus: outcome.result.status,
      revision: outcome.result.revision,
      steps: outcome.steps,
      confirmations: workflow.confirmationCount,
      invokedTool: outcome.invokedTool,
      registrations: outcome.registrations,
      auditEvents: workflow.auditEvents.map(({ event, outcome: result }) => ({
        event,
        outcome: result,
      })),
    },
    null,
    2,
  ),
);
