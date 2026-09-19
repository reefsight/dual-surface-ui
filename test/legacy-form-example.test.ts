// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AgentActionNotFoundError,
  AgentAuthorizationRequiredError,
  createAgentSurface,
} from "../src/index.js";
import { defineDomainElement } from "../src/domain/index.js";
import {
  exportAgentSurfaceToWebMcp,
  mountDeclarativeWebMcpForm,
  type WebMcpModelContext,
  type WebMcpTool,
} from "../src/webmcp/index.js";
import {
  adaptLegacyRegistrationForm,
  mountLegacyDeclarativeFallback,
} from "../examples/legacy-form/adapter.mjs";
import { installLegacyRegistrationApp } from "../examples/legacy-form/legacy-app.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

class FakeModelContext implements WebMcpModelContext {
  readonly tools = new Map<string, WebMcpTool>();
  readonly registrations: WebMcpTool[] = [];

  registerTool(tool: WebMcpTool, options: { signal: AbortSignal }): void {
    if (this.tools.has(tool.name)) throw new Error("duplicate active tool");
    this.tools.set(tool.name, tool);
    this.registrations.push(tool);
    options.signal.addEventListener("abort", () => this.tools.delete(tool.name), {
      once: true,
    });
  }
}

async function fixture(options = {}) {
  document.documentElement.innerHTML = await readFile(
    resolve(projectRoot, "examples", "legacy-form", "index.html"),
    "utf8",
  );
  const settings = options as {
    principal?: { id: string; roles: string[] };
    allowedOrigin?: string;
    confirmSubmission?: boolean;
  };
  const legacyApp = installLegacyRegistrationApp(document, settings);
  const modelContext = new FakeModelContext();
  const adapter = await adaptLegacyRegistrationForm({
    document,
    legacyApp,
    createAgentSurface,
    defineDomainElement,
    exportAgentSurfaceToWebMcp,
    modelContext,
    ...settings,
  });
  return { adapter, legacyApp, modelContext };
}

function fillHumanForm() {
  const email = document.querySelector<HTMLInputElement>("#legacy-email")!;
  const plan = document.querySelector<HTMLSelectElement>("#legacy-plan")!;
  const pin = document.querySelector<HTMLInputElement>("#legacy-pin")!;
  const terms = document.querySelector<HTMLInputElement>("#legacy-terms")!;
  email.value = "reviewer@example.com";
  plan.value = "team";
  pin.value = "4821";
  terms.checked = true;
}

async function invokeRegistrationTool(
  fixtureValue: Awaited<ReturnType<typeof fixture>>,
  idempotencyKey: string,
) {
  const tool = fixtureValue.modelContext.tools.get(
    "accounts.submit_registration",
  );
  if (!tool) throw new Error("registration tool was not exported");
  return tool.execute({ idempotencyKey });
}

async function prepareAgentForm(
  fixtureValue: Awaited<ReturnType<typeof fixture>>,
) {
  fixtureValue.adapter.controls.pin.value = "4821";
  const initial = fixtureValue.adapter.surface.snapshot();
  let revision = initial.revision;
  for (const [elementId, action, input] of [
    ["legacy-email", "set_value", "reviewer@example.com"],
    ["legacy-plan", "select", "team"],
    ["legacy-terms", "toggle", undefined],
  ] as const) {
    const result = await fixtureValue.adapter.surface.perform({
      surfaceId: initial.surfaceId,
      revision,
      elementId,
      action,
      ...(input === undefined ? {} : { input }),
    });
    revision = result.revision;
  }
  await fixtureValue.adapter.exporter.refresh();
}

describe("migrated legacy-form example", () => {
  beforeEach(() => {
    document.documentElement.innerHTML = "<head></head><body></body>";
    window.history.replaceState({}, "", "/");
  });

  it("adapts the existing form with one domain definition and WebMCP allowlist", async () => {
    const { adapter, modelContext } = await fixture();
    const action = adapter.surface.snapshot().nodes
      .find((node) => node.id === "legacy-registration")?.actions
      .find((item) => item.name === "submit_registration");

    expect(action).toEqual(expect.objectContaining({
      risk: "consequential",
      preconditions: ["legacy_form_valid"],
      effects: ["legacy_registration_submitted"],
      requiresConfirmation: true,
      idempotency: "keyed",
    }));
    expect(adapter.webMcpBindings).toEqual([{
      name: "accounts.submit_registration",
      description: "Submit the reviewed legacy registration form",
      elementId: "legacy-registration",
      action: "submit_registration",
    }]);
    expect(adapter.exporter.supported).toBe(true);
    expect(modelContext.tools.has("accounts.submit_registration")).toBe(true);
  });

  it("preserves the native human submit lifecycle", async () => {
    const { legacyApp } = await fixture();
    const submit = vi.fn();
    legacyApp.form.addEventListener("submit", submit);
    fillHumanForm();

    legacyApp.submitButton.click();

    expect(submit).toHaveBeenCalledOnce();
    expect(legacyApp.submissionCount).toBe(1);
    expect(legacyApp.lastSubmission).toEqual({
      email: "reviewer@example.com",
      plan: "team",
      accepted: true,
    });
  });

  it("uses the same native submit transition for agent and human outcomes", async () => {
    const human = await fixture();
    fillHumanForm();
    human.legacyApp.submitButton.click();
    const humanOutcome = human.legacyApp.lastSubmission;
    const humanStatus = human.legacyApp.status.textContent;

    const agent = await fixture();
    await prepareAgentForm(agent);
    const result = await invokeRegistrationTool(
      agent,
      "legacy.registration.reviewer.v1",
    );

    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      output: humanOutcome,
    }));
    expect(agent.legacyApp.lastSubmission).toEqual(humanOutcome);
    expect(agent.legacyApp.status.textContent).toBe(humanStatus);
    expect(agent.legacyApp.submissionCount).toBe(1);
    expect(JSON.stringify(result.output).length).toBeLessThanOrEqual(4096);
  });

  it("replays one exported submission without duplicating the legacy transition", async () => {
    const value = await fixture();
    await prepareAgentForm(value);

    const first = await invokeRegistrationTool(value, "legacy.registration.replay.v1");
    const replay = await invokeRegistrationTool(value, "legacy.registration.replay.v1");

    expect(replay).toEqual(first);
    expect(value.legacyApp.submissionCount).toBe(1);
  });

  it("does not submit when trusted confirmation is declined", async () => {
    const value = await fixture({ confirmSubmission: false });
    await prepareAgentForm(value);

    const result = await invokeRegistrationTool(
      value,
      "legacy.registration.declined.v1",
    );

    expect(result).toEqual(expect.objectContaining({
      status: "failed",
      error: expect.objectContaining({ code: "confirmation_required" }),
    }));
    expect(value.legacyApp.submissionCount).toBe(0);
  });

  it("does not expose an inferred submit click that bypasses confirmation", async () => {
    const value = await fixture({ confirmSubmission: false });
    fillHumanForm();
    const snapshot = value.adapter.surface.snapshot();
    const nativeSubmit = snapshot.nodes.find((node) => node.id === "legacy-submit");

    expect(nativeSubmit).toEqual(expect.objectContaining({ actions: [] }));
    await expect(value.adapter.surface.perform({
      surfaceId: snapshot.surfaceId,
      revision: snapshot.revision,
      elementId: "legacy-submit",
      action: "click",
    })).rejects.toBeInstanceOf(AgentActionNotFoundError);
    expect(value.legacyApp.submissionCount).toBe(0);
    expect(value.legacyApp.lastSubmission).toBeUndefined();
  });

  it("denies a guest in both human and exported-agent paths without mutation", async () => {
    const guest = { id: "guest-1", roles: ["guest"] };
    const human = await fixture({ principal: guest });
    fillHumanForm();
    human.legacyApp.submitButton.click();

    expect(human.legacyApp.submissionCount).toBe(0);
    expect(human.legacyApp.lastSubmission).toBeUndefined();
    expect(human.legacyApp.status.textContent).toBe("Registration is not authorized");

    const agent = await fixture({ principal: guest });
    fillHumanForm();
    await agent.adapter.exporter.refresh();
    const result = await invokeRegistrationTool(
      agent,
      "legacy.registration.guest.v1",
    );

    expect(result).toEqual(expect.objectContaining({
      status: "failed",
      error: expect.objectContaining({ code: "authorization_required" }),
    }));
    expect(agent.legacyApp.submissionCount).toBe(0);
    expect(agent.legacyApp.lastSubmission).toBeUndefined();
    expect(agent.legacyApp.status.textContent).toBe("Ready");
  });

  it("fails closed before native submission when browser constraints are invalid", async () => {
    const value = await fixture();
    const { adapter, legacyApp } = value;
    const submit = vi.fn();
    legacyApp.form.addEventListener("submit", submit);

    const result = await invokeRegistrationTool(
      value,
      "legacy.registration.invalid.v1",
    );
    expect(result).toEqual(expect.objectContaining({
      status: "failed",
      error: expect.objectContaining({ code: "precondition_failed" }),
    }));
    expect(submit).not.toHaveBeenCalled();
    expect(legacyApp.submissionCount).toBe(0);
  });

  it("fails closed when a required control is disabled", async () => {
    const value = await fixture();
    fillHumanForm();
    value.adapter.controls.email.disabled = true;
    await value.adapter.exporter.refresh();

    const result = await invokeRegistrationTool(
      value,
      "legacy.registration.disabled.v1",
    );

    expect(result).toEqual(expect.objectContaining({
      status: "failed",
      error: expect.objectContaining({ code: "precondition_failed" }),
    }));
    expect(value.legacyApp.submissionCount).toBe(0);
  });

  it("fails closed when the legacy form action becomes cross-origin", async () => {
    const value = await fixture();
    fillHumanForm();
    value.legacyApp.form.action = "https://untrusted.example/register";
    await value.adapter.exporter.refresh();

    const result = await invokeRegistrationTool(
      value,
      "legacy.registration.cross-origin.v1",
    );

    expect(result).toEqual(expect.objectContaining({
      status: "failed",
      error: expect.objectContaining({ code: "precondition_failed" }),
    }));
    expect(value.legacyApp.submissionCount).toBe(0);
  });

  it("does not expose hidden controls or serialize the hidden legacy secret", async () => {
    const { adapter } = await fixture();
    const snapshot = adapter.surface.snapshot();
    const serialized = JSON.stringify(snapshot);

    expect(snapshot.nodes.some((node) => node.id === "legacy-admin-override")).toBe(false);
    expect(serialized).not.toContain("LEGACY_SECRET_SENTINEL");
    expect(adapter.webMcpBindings.some(
      (binding: { elementId: string }) => binding.elementId === "legacy-admin-override",
    )).toBe(false);
  });

  it("keeps aggregate secrets out of snapshot, result, tool metadata, and audit", async () => {
    const value = await fixture();
    await prepareAgentForm(value);
    const snapshot = value.adapter.surface.snapshot();
    const result = await invokeRegistrationTool(
      value,
      "legacy.registration.secret-audit.v1",
    );
    const serialized = JSON.stringify({
      snapshot,
      result,
      toolDescriptors: value.adapter.exporter.toolDescriptors,
      toolObservations: value.adapter.exporter.toolObservations,
      bindings: value.adapter.webMcpBindings,
      audit: value.adapter.auditEvents,
    });

    expect(result.status).toBe("succeeded");
    expect(serialized).not.toContain("LEGACY_SECRET_SENTINEL");
    expect(serialized).not.toContain("4821");
  });

  it("keeps credential values redacted and denies credential mutation", async () => {
    const { adapter } = await fixture();
    adapter.controls.pin.value = "4821";
    const pin = adapter.surface.snapshot().nodes.find((node) => node.id === "legacy-pin");

    expect(pin?.state).toEqual(expect.objectContaining({
      sensitive: true,
      valuePresent: true,
    }));
    expect(JSON.stringify(pin)).not.toContain("4821");
    const snapshot = adapter.surface.snapshot();
    await expect(adapter.surface.perform({
      surfaceId: snapshot.surfaceId,
      revision: snapshot.revision,
      elementId: "legacy-pin",
      action: "set_value",
      input: "9999",
    })).rejects.toBeInstanceOf(AgentAuthorizationRequiredError);
    expect(adapter.controls.pin.value).toBe("4821");
  });

  it("rejects stale revisions before invoking the legacy submit flow", async () => {
    const value = await fixture();
    const { adapter, legacyApp } = value;
    fillHumanForm();
    const result = await invokeRegistrationTool(
      value,
      "legacy.registration.stale.v1",
    );
    expect(result).toEqual(expect.objectContaining({
      status: "failed",
      error: expect.objectContaining({ code: "stale_revision" }),
    }));
    expect(legacyApp.submissionCount).toBe(0);
  });

  it("refreshes registrations and disposes both export and surface lifecycle", async () => {
    const value = await fixture();
    fillHumanForm();
    const firstTool = value.modelContext.tools.get("accounts.submit_registration");

    await value.adapter.exporter.refresh();

    const secondTool = value.modelContext.tools.get("accounts.submit_registration");
    expect(secondTool).toBeDefined();
    expect(secondTool).not.toBe(firstTool);
    expect(value.adapter.exporter.toolObservations[0]).toEqual(
      expect.objectContaining({ generation: 2 }),
    );
    value.adapter.dispose();
    value.adapter.dispose();
    expect(value.modelContext.tools.size).toBe(0);
    expect(value.adapter.surface.snapshot().nodes.some(
      (node: { id: string }) => node.id === "legacy-registration",
    )).toBe(false);
  });

  it("fails closed when the real declarative subset cannot represent the legacy form", async () => {
    await fixture();
    const form = document.querySelector<HTMLFormElement>("#legacy-registration")!;
    const email = document.querySelector<HTMLInputElement>("#legacy-email")!;

    expect(() => mountLegacyDeclarativeFallback({
      document,
      mountDeclarativeWebMcpForm,
    })).toThrow();
    expect(form.hasAttribute("toolname")).toBe(false);
    expect(form.hasAttribute("tooldescription")).toBe(false);
    expect(email.hasAttribute("toolparamdescription")).toBe(false);
  });

  it("restores actual declarative annotations for a compatible legacy form", () => {
    document.body.innerHTML = `
      <form id="legacy-contact" action="/contact" method="post">
        <input id="contact-email" name="email" type="email" required>
        <textarea id="contact-note" name="note"></textarea>
        <button type="submit">Send</button>
      </form>
    `;
    const form = document.querySelector<HTMLFormElement>("#legacy-contact")!;
    const email = document.querySelector<HTMLInputElement>("#contact-email")!;
    const note = document.querySelector<HTMLTextAreaElement>("#contact-note")!;
    form.setAttribute("tooldescription", "original");
    const mounted = mountDeclarativeWebMcpForm({
      form,
      name: "contact.prepare",
      description: "Prepare the legacy contact form for human review",
      fields: [
        { control: email, description: "Contact email address" },
        { control: note, description: "Non-sensitive contact note" },
      ],
    });

    expect(form.getAttribute("toolname")).toBe("contact.prepare");
    expect(form.hasAttribute("toolautosubmit")).toBe(false);
    mounted.dispose();
    expect(form.hasAttribute("toolname")).toBe(false);
    expect(form.getAttribute("tooldescription")).toBe("original");
    expect(email.hasAttribute("toolparamdescription")).toBe(false);
    expect(note.hasAttribute("toolparamdescription")).toBe(false);
  });
});
