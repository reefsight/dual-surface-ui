import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { JSDOM } from "jsdom";
import { createAgentSurface } from "../../dist/index.js";
import { defineDomainElement } from "../../dist/domain/index.js";
import { exportAgentSurfaceToWebMcp } from "../../dist/webmcp/index.js";

import { adaptLegacyRegistrationForm } from "./adapter.mjs";
import {
  installLegacyRegistrationApp,
  installWindowGlobals,
} from "./legacy-app.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const html = await readFile(resolve(here, "index.html"), "utf8");
const dom = new JSDOM(html, { url: "https://accounts.example.test/register" });
installWindowGlobals(dom.window);

const tools = new Map();
const modelContext = {
  registerTool(tool, options) {
    tools.set(tool.name, tool);
    options.signal.addEventListener("abort", () => tools.delete(tool.name), {
      once: true,
    });
  },
};
const legacyApp = installLegacyRegistrationApp(dom.window.document);
const adapter = await adaptLegacyRegistrationForm({
  document: dom.window.document,
  legacyApp,
  createAgentSurface,
  defineDomainElement,
  exportAgentSurfaceToWebMcp,
  modelContext,
});

// The credential remains user/session owned; the agent fills only safe fields.
adapter.controls.pin.value = "4821";
const initial = adapter.surface.snapshot();
let revision = initial.revision;
for (const [elementId, action, input] of [
  ["legacy-email", "set_value", "reviewer@example.com"],
  ["legacy-plan", "select", "team"],
  ["legacy-terms", "toggle", undefined],
]) {
  const result = await adapter.surface.perform({
    surfaceId: initial.surfaceId,
    revision,
    elementId,
    action,
    ...(input === undefined ? {} : { input }),
  });
  revision = result.revision;
}
await adapter.exporter.refresh();
const outcome = await tools.get("accounts.submit_registration").execute({
  idempotencyKey: "legacy.registration.run.v1",
});

console.log(JSON.stringify({
  result: outcome,
  submission: legacyApp.lastSubmission,
  submissionCount: legacyApp.submissionCount,
}, null, 2));
adapter.dispose();
