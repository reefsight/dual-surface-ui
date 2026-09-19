import { createAgentSurface } from "/dist/index.js";
import {
  exportAgentSurfaceToWebMcp,
  mountDeclarativeWebMcpForm,
} from "/dist/webmcp/index.js";
import { createModelContextShim } from "./model-context-shim.mjs";

const mode = new URL(location.href).searchParams.get("mode") ?? "imperative";
const form = document.querySelector("#child-form");
const status = document.querySelector("#child-status");
let submitCount = 0;
form.addEventListener("submit", (event) => {
  event.preventDefault();
  submitCount += 1;
  status.textContent = "Child form submitted";
});

if (mode === "declarative") {
  let error;
  const before = form.outerHTML;
  try {
    mountDeclarativeWebMcpForm({
      form,
      name: "child.form",
      description: "Prepare the child form",
      fields: [{
        control: document.querySelector("#child-email"),
        description: "Child email",
      }],
    });
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  window.browserEvidence = {
    clickHumanSubmit() {
      document.querySelector("#child-email").value = "child@example.test";
      form.querySelector('button[type="submit"]').click();
      return { status: status.textContent, submitCount };
    },
    result: () => ({ after: form.outerHTML, before, error }),
  };
} else {
  const shim = createModelContextShim();
  const surface = createAgentSurface({
    root: document.querySelector("#child-root"),
    surfaceId: "frame-child",
  });
  surface.register(document.querySelector("#child-only-control"), {
    id: "child-only-control",
    description: "Child-only control",
    actions: {
      inspect: { description: "Inspect the child", risk: "read", handler: () => "child" },
    },
  });
  const exporter = await exportAgentSurfaceToWebMcp(surface, {
    modelContext: shim,
    bindings: [{
      name: "frame.inspect_child",
      description: "Inspect the child frame fixture",
      elementId: "child-only-control",
      action: "inspect",
    }],
  });
  window.browserEvidence = {
    catalog: () => shim.catalog(),
    dispose: () => exporter.dispose(),
    snapshot: () => surface.snapshot(),
  };
}

document.documentElement.dataset.browserEvidence = "ready";
