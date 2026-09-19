function requiredElement(document, selector) {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`Legacy form fixture is missing ${selector}`);
  return element;
}

export function installWindowGlobals(window) {
  for (const name of [
    "Document",
    "Element",
    "Event",
    "HTMLAnchorElement",
    "HTMLButtonElement",
    "HTMLDetailsElement",
    "HTMLFormElement",
    "HTMLImageElement",
    "HTMLInputElement",
    "HTMLOptGroupElement",
    "HTMLOptionElement",
    "HTMLSelectElement",
    "HTMLTextAreaElement",
    "HTMLElement",
    "Node",
  ]) {
    globalThis[name] = window[name];
  }
  globalThis.document = window.document;
}

export function installLegacyRegistrationApp(
  document,
  {
    principal = { id: "registrant-1", roles: ["registrant"] },
    allowedOrigin = document.location.origin,
  } = {},
) {
  const form = requiredElement(document, "#legacy-registration");
  const submitButton = requiredElement(document, "#legacy-submit");
  const status = requiredElement(document, "#legacy-status");
  const requiredControls = [
    requiredElement(document, "#legacy-email"),
    requiredElement(document, "#legacy-plan"),
    requiredElement(document, "#legacy-pin"),
    requiredElement(document, "#legacy-terms"),
  ];
  let submissionCount = 0;
  let lastSubmission;

  const isAuthorized = () =>
    principal?.roles?.includes("registrant") &&
    document.location.origin === allowedOrigin;

  const canSubmit = () => {
    const action = new URL(form.action, document.location.href);
    return isAuthorized() &&
      action.origin === document.location.origin &&
      requiredControls.every((control) =>
        !control.disabled && !control.closest("[hidden], [inert]")
      ) &&
      form.checkValidity();
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!isAuthorized()) {
      status.textContent = "Registration is not authorized";
      return;
    }
    if (!canSubmit()) {
      status.textContent = "Complete registration details";
      return;
    }
    const FormDataConstructor = form.ownerDocument.defaultView?.FormData;
    if (!FormDataConstructor) throw new Error("FormData is unavailable");
    const data = new FormDataConstructor(form);
    const email = String(data.get("email") ?? "");
    const plan = String(data.get("plan") ?? "");

    // This is the existing application-owned business transition. The adapter
    // invokes the native submit lifecycle and never duplicates these rules.
    lastSubmission = Object.freeze({ email, plan, accepted: true });
    submissionCount += 1;
    status.textContent = `Registered ${email} on ${plan}`;
  });

  return Object.freeze({
    form,
    canSubmit,
    isAuthorized,
    status,
    submitButton,
    get lastSubmission() {
      return lastSubmission;
    },
    get submissionCount() {
      return submissionCount;
    },
  });
}
