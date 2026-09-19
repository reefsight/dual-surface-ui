import { createAgentSurface } from "/dist/index.js";
import { defineDomainElement } from "/dist/domain/index.js";
import {
  exportAgentSurfaceToWebMcp,
} from "/dist/webmcp/index.js";
import {
  CHECKOUT_EMAIL,
  createCheckoutWorkflow,
} from "/examples/checkout/workflow.mjs";
import {
  createDocumentApprovalWorkflow,
} from "/examples/document-approval/workflow.mjs";
import {
  adaptLegacyRegistrationForm,
} from "/examples/legacy-form/adapter.mjs";
import {
  installLegacyRegistrationApp,
} from "/examples/legacy-form/legacy-app.mjs";
import { createModelContextShim } from "./model-context-shim.mjs";

const status = document.querySelector("#browser-evidence-status");

async function installExampleMarkup(name) {
  const response = await fetch(`/examples/${name}/index.html`, { cache: "no-store" });
  if (!response.ok) throw new Error(`could not load ${name} fixture`);
  const source = await response.text();
  const parsed = new DOMParser().parseFromString(source, "text/html");
  document.body.replaceChildren(...Array.from(parsed.body.childNodes));
}

function serializable(value) {
  return JSON.parse(JSON.stringify(value));
}

async function checkoutHarness() {
  await installExampleMarkup("checkout");
  const shim = createModelContextShim();
  const workflow = createCheckoutWorkflow({
    document,
    createAgentSurface,
    defineDomainElement,
    exportAgentSurfaceToWebMcp,
    modelContext: shim,
  });
  const handle = await workflow.webMcpHandle;
  const disposeOnPageHide = () => handle.dispose();
  addEventListener("pagehide", disposeOnPageHide, { once: true });
  return {
    catalog: () => shim.catalog(),
    history: () => shim.history(),
    dispose: () => handle.dispose(),
    dispatchPageHide() {
      dispatchEvent(new PageTransitionEvent("pagehide"));
      return shim.catalog();
    },
    async disposeAndRemount() {
      handle.dispose();
      const afterDispose = shim.catalog();
      const remounted = await exportAgentSurfaceToWebMcp(workflow.surface, {
        bindings: workflow.webMcpBindings,
        modelContext: shim,
      });
      const afterRemount = shim.catalog();
      remounted.dispose();
      return { afterDispose, afterRemount, final: shim.catalog() };
    },
    async spaRouteRemount() {
      handle.dispose();
      const afterDispose = shim.catalog();
      history.pushState({}, "", "/orders/next");
      const remounted = await exportAgentSurfaceToWebMcp(workflow.surface, {
        bindings: workflow.webMcpBindings,
        modelContext: shim,
      });
      const current = shim.catalog();
      remounted.dispose();
      return { afterDispose, current, final: shim.catalog(), url: location.href };
    },
    runAgent: async () => {
      const run = await workflow.runAgentWorkflow();
      return serializable({ run, state: workflow.businessState() });
    },
    runHuman: () => serializable({
      run: workflow.runHumanWorkflow(),
      state: workflow.businessState(),
    }),
    async staleThenRefresh() {
      await workflow.prepareAgentCheckout();
      const stale = await shim.invoke("checkout.place_order", {
        input: { shippingEmail: CHECKOUT_EMAIL },
        idempotencyKey: "ORDER-1001.browser-stale.v1",
      });
      const executionsAfterStale = workflow.commandExecutions;
      await handle.refresh();
      const current = await shim.invoke("checkout.place_order", {
        input: { shippingEmail: CHECKOUT_EMAIL },
        idempotencyKey: "ORDER-1001.browser-current.v1",
      });
      return serializable({
        current,
        executionsAfterStale,
        finalExecutions: workflow.commandExecutions,
        stale,
        state: workflow.businessState(),
      });
    },
  };
}

async function approvalHarness() {
  await installExampleMarkup("document-approval");
  const shim = createModelContextShim();
  const workflow = createDocumentApprovalWorkflow({
    document,
    createAgentSurface,
    defineDomainElement,
  });
  return {
    catalog: () => shim.catalog(),
    history: () => shim.history(),
    runAgent: async () => {
      const run = await workflow.runWebMcpAgentWorkflow({
        exportAgentSurfaceToWebMcp,
        modelContext: shim,
      });
      return serializable({ run, state: workflow.getDocumentState() });
    },
    runHuman: () => serializable({
      run: workflow.runHumanWorkflow(),
      state: workflow.getDocumentState(),
    }),
  };
}

async function legacyHarness() {
  await installExampleMarkup("legacy-form");
  const shim = createModelContextShim();
  const legacyApp = installLegacyRegistrationApp(document);
  const adapter = await adaptLegacyRegistrationForm({
    document,
    legacyApp,
    createAgentSurface,
    defineDomainElement,
    exportAgentSurfaceToWebMcp,
    modelContext: shim,
  });

  function fillHumanForm() {
    adapter.controls.email.value = "reviewer@example.com";
    adapter.controls.plan.value = "team";
    adapter.controls.pin.value = "4821";
    adapter.controls.terms.checked = true;
  }

  return {
    catalog: () => shim.catalog(),
    history: () => shim.history(),
    dispose: () => adapter.dispose(),
    runHuman() {
      fillHumanForm();
      legacyApp.submitButton.click();
      return serializable({
        count: legacyApp.submissionCount,
        state: legacyApp.lastSubmission,
        status: legacyApp.status.textContent,
      });
    },
    async runAgent() {
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
      const result = await shim.invoke("accounts.submit_registration", {
        idempotencyKey: "legacy.browser-agent.v1",
      });
      return serializable({
        count: legacyApp.submissionCount,
        result,
        state: legacyApp.lastSubmission,
        status: legacyApp.status.textContent,
      });
    },
  };
}

async function fallbackHarness() {
  document.body.innerHTML = '<main id="fallback-root"><button id="fallback-button">Run</button></main>';
  const root = document.querySelector("#fallback-root");
  const button = document.querySelector("#fallback-button");
  const surface = createAgentSurface({ root, surfaceId: "fallback-browser" });
  surface.register(button, {
    id: "fallback-button",
    description: "Run the fallback probe",
    actions: {
      probe: { description: "Return the fallback probe result", risk: "read", handler: () => "ok" },
    },
  });
  const before = document.body.innerHTML;
  const handle = await exportAgentSurfaceToWebMcp(surface, {
    document,
    bindings: [{
      name: "fallback.probe",
      description: "Return the fallback probe result",
      elementId: "fallback-button",
      action: "probe",
    }],
  });
  return {
    result: () => ({
      after: document.body.innerHTML,
      before,
      supported: handle.supported,
      toolNames: handle.toolNames,
    }),
  };
}

async function rollbackHarness() {
  document.body.innerHTML = '<main id="rollback-root"><button id="one">One</button><button id="two">Two</button></main>';
  const root = document.querySelector("#rollback-root");
  const surface = createAgentSurface({ root, surfaceId: "rollback-browser" });
  for (const id of ["one", "two"]) {
    surface.register(document.querySelector(`#${id}`), {
      id,
      description: `Probe ${id}`,
      actions: {
        probe: { description: `Run probe ${id}`, risk: "read", handler: () => id },
      },
    });
  }
  const shim = createModelContextShim({ failAt: 2 });
  let error;
  try {
    await exportAgentSurfaceToWebMcp(surface, {
      modelContext: shim,
      bindings: ["one", "two"].map((id) => ({
        name: `rollback.${id}`,
        description: `Run rollback probe ${id}`,
        elementId: id,
        action: "probe",
      })),
    });
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  return { result: () => ({ catalog: shim.catalog(), error }) };
}

const scenario = new URL(location.href).searchParams.get("scenario") ?? "checkout";
const factories = {
  approval: approvalHarness,
  checkout: checkoutHarness,
  fallback: fallbackHarness,
  legacy: legacyHarness,
  rollback: rollbackHarness,
};

try {
  const factory = factories[scenario];
  if (!factory) throw new Error(`unknown browser evidence scenario: ${scenario}`);
  window.browserEvidence = await factory();
  document.documentElement.dataset.browserEvidence = "ready";
  if (status?.isConnected) status.textContent = "Ready";
} catch (error) {
  window.browserEvidenceError = error instanceof Error ? error.stack : String(error);
  document.documentElement.dataset.browserEvidence = "failed";
  if (status?.isConnected) status.textContent = "Failed";
}
