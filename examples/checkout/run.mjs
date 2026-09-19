import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { JSDOM } from "jsdom";
import { createAgentSurface } from "../../dist/index.js";
import { defineDomainElement } from "../../dist/domain/index.js";
import { exportAgentSurfaceToWebMcp } from "../../dist/webmcp/index.js";

import { createCheckoutWorkflow, installWindowGlobals } from "./workflow.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const html = await readFile(resolve(here, "index.html"), "utf8");
const dom = new JSDOM(html, { url: "https://shop.example.test/checkout" });
installWindowGlobals(dom.window);

const workflow = createCheckoutWorkflow({
  document: dom.window.document,
  createAgentSurface,
  defineDomainElement,
  exportAgentSurfaceToWebMcp,
});
const outcome = await workflow.runAgentWorkflow();

console.log(JSON.stringify({
  result: outcome.result,
  businessState: workflow.businessState(),
  confirmations: workflow.confirmationCount,
  commandExecutions: workflow.commandExecutions,
}, null, 2));
