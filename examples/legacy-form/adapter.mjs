function requireControl(document, selector) {
  const control = document.querySelector(selector);
  if (!control) throw new Error(`Legacy adapter is missing ${selector}`);
  return control;
}

const TOOL_DESCRIPTION = "Submit the reviewed legacy registration form";

export async function adaptLegacyRegistrationForm({
  document,
  legacyApp,
  createAgentSurface,
  defineDomainElement,
  exportAgentSurfaceToWebMcp,
  modelContext,
  confirmSubmission = true,
  principal = { id: "registrant-1", roles: ["registrant"] },
  allowedOrigin = document.location.origin,
}) {
  const form = legacyApp.form;
  const email = requireControl(document, "#legacy-email");
  const plan = requireControl(document, "#legacy-plan");
  const pin = requireControl(document, "#legacy-pin");
  const terms = requireControl(document, "#legacy-terms");
  const auditEvents = [];

  const surface = createAgentSurface({
    root: form,
    surfaceId: "legacy-registration-example",
    getPrincipal: () => principal,
    policy: ({ principal: activePrincipal, risk, origin }) => {
      if (
        !legacyApp.isAuthorized() ||
        activePrincipal?.id !== principal.id ||
        origin !== allowedOrigin
      ) {
        return { outcome: "deny" };
      }
      if (risk === "credential") return { outcome: "deny" };
      return risk === "consequential"
        ? { outcome: "require_confirmation" }
        : { outcome: "allow" };
    },
    confirm: () => confirmSubmission,
    checkPrecondition: ({ precondition }) =>
      precondition === "legacy_form_valid" && legacyApp.canSubmit(),
    verifyEffect: ({ effect }) =>
      effect === "legacy_registration_submitted" &&
      legacyApp.lastSubmission !== undefined,
    onAudit: (event) => auditEvents.push(event),
  });

  const compiled = defineDomainElement({
    id: "legacy-registration",
    description: "Submit the existing account registration form",
    actions: {
      submit_registration: {
        description: TOOL_DESCRIPTION,
        risk: "consequential",
        webMcpName: "accounts.submit_registration",
        outputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            email: { type: "string", format: "email", maxLength: 254 },
            plan: { type: "string", enum: ["starter", "team"] },
            accepted: { type: "boolean", const: true },
          },
          required: ["email", "plan", "accepted"],
        },
        preconditions: ["legacy_form_valid"],
        effects: ["legacy_registration_submitted"],
        requiresConfirmation: true,
        idempotency: "keyed",
        handler: () => {
          const before = legacyApp.submissionCount;
          form.requestSubmit(legacyApp.submitButton);
          if (legacyApp.submissionCount !== before + 1 || !legacyApp.lastSubmission) {
            throw new Error("The legacy submit lifecycle did not complete");
          }
          return legacyApp.lastSubmission;
        },
      },
    },
  });

  const unregister = surface.register(form, compiled.definition);
  const suppressSubmitAction = surface.register(legacyApp.submitButton, {
    id: "legacy-submit",
    description: "Submit through the reviewed registration action",
    actions: {},
  });
  let exporter;
  try {
    exporter = await exportAgentSurfaceToWebMcp(surface, {
      document,
      modelContext,
      bindings: compiled.webMcpBindings,
    });
  } catch (error) {
    suppressSubmitAction();
    unregister();
    throw error;
  }
  let disposed = false;

  return Object.freeze({
    auditEvents,
    compiled,
    controls: Object.freeze({ email, pin, plan, terms }),
    dispose() {
      if (disposed) return;
      disposed = true;
      exporter.dispose();
      suppressSubmitAction();
      unregister();
    },
    exporter,
    legacyApp,
    surface,
    webMcpBindings: compiled.webMcpBindings,
  });
}

export function mountLegacyDeclarativeFallback({
  document,
  mountDeclarativeWebMcpForm,
}) {
  const form = requireControl(document, "#legacy-registration");
  const email = requireControl(document, "#legacy-email");
  return mountDeclarativeWebMcpForm({
    form,
    name: "accounts.registration",
    description: TOOL_DESCRIPTION,
    fields: [
      { control: email, description: "Account email address" },
    ],
  });
}
