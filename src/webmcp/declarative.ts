import type {
  WebMcpDeclarativeCapabilities,
  WebMcpDeclarativeControl,
  WebMcpDeclarativeFieldBinding,
  WebMcpDeclarativeFormHandle,
  WebMcpDeclarativeFormOptions,
} from "./types.js";

const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,30}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const MAX_TOOL_DESCRIPTION = 500;
const MAX_PARAMETER_DESCRIPTION = 150;
const CREDENTIAL_AUTOCOMPLETE_TOKENS = new Set([
  "current-password",
  "new-password",
  "one-time-code",
  "cc-number",
  "cc-csc",
  "webauthn",
]);
const SAFE_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "url",
  "tel",
  "number",
  "date",
  "time",
  "datetime-local",
  "month",
  "week",
]);

interface AttributeSnapshot {
  element: Element;
  name: string;
  present: boolean;
  value: string | null;
}

const activeForms = new WeakSet<HTMLFormElement>();

function isModelContextDocument(
  document: Document,
): document is Document & { modelContext: { registerTool: unknown } } {
  try {
    const candidate = document as Document & {
      modelContext?: { registerTool?: unknown };
    };
    return typeof candidate.modelContext?.registerTool === "function";
  } catch {
    return false;
  }
}

export function detectWebMcpDeclarativeCapabilities(
  document: Document | undefined = globalThis.document,
): WebMcpDeclarativeCapabilities {
  if (!document) {
    return {
      imperative: false,
      submitEventExtensions: false,
      activeSelectors: false,
      declarative: "unknown",
    };
  }
  const view = document.defaultView;
  const submitPrototype = view?.SubmitEvent?.prototype as
    | (SubmitEvent & { agentInvoked?: boolean; respondWith?: unknown })
    | undefined;
  const submitEventExtensions =
    !!submitPrototype &&
    "agentInvoked" in submitPrototype &&
    typeof submitPrototype.respondWith === "function";
  let activeSelectors = false;
  try {
    activeSelectors =
      !!view?.CSS?.supports?.("selector(form:tool-form-active)") &&
      !!view.CSS.supports("selector(:tool-submit-active)");
  } catch {
    activeSelectors = false;
  }
  const imperative = isModelContextDocument(document);
  return {
    imperative,
    submitEventExtensions,
    activeSelectors,
    declarative:
      imperative && submitEventExtensions && activeSelectors
        ? "likely-supported"
        : "unknown",
  };
}

function validateDescription(
  value: string,
  maxLength: number,
  label: string,
): void {
  if (
    value.length === 0 ||
    value.length > maxLength ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    throw new TypeError(`Invalid trusted ${label}`);
  }
}

function isParameterControl(element: Element): element is WebMcpDeclarativeControl {
  return element.tagName === "INPUT" || element.tagName === "TEXTAREA";
}

function isHiddenOrInert(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (
      current.hasAttribute("hidden") ||
      current.hasAttribute("inert") ||
      current.getAttribute("aria-hidden")?.toLowerCase() === "true"
    ) {
      return true;
    }
    const style = view?.getComputedStyle(current);
    if (
      style?.display === "none" ||
      style?.visibility === "hidden" ||
      style?.visibility === "collapse"
    ) {
      return true;
    }
  }
  const control = element as WebMcpDeclarativeControl;
  if (control instanceof HTMLInputElement && control.type === "hidden") {
    return true;
  }
  return false;
}

function hasCredentialSemantics(control: WebMcpDeclarativeControl): boolean {
  if (control.closest("[data-agent-sensitive='true']")) return true;
  if (control instanceof HTMLInputElement && control.type === "password") {
    return true;
  }
  return control.autocomplete
    .toLowerCase()
    .split(/\s+/)
    .some((token) => CREDENTIAL_AUTOCOMPLETE_TOKENS.has(token));
}

function validateOrigin(form: HTMLFormElement): void {
  const document = form.ownerDocument;
  const view = document.defaultView;
  if (view && view.top !== view) {
    throw new TypeError("Declarative WebMCP forms in frames are unsupported");
  }
  if (form.target && form.target.toLowerCase() !== "_self") {
    throw new TypeError("Declarative WebMCP forms must target the current context");
  }
  const action = new URL(form.action || document.URL, document.baseURI);
  if (!/^https?:$/.test(action.protocol) || action.origin !== document.location.origin) {
    throw new TypeError("Declarative WebMCP forms require a same-origin HTTP(S) action");
  }
}

function validateField(
  form: HTMLFormElement,
  field: WebMcpDeclarativeFieldBinding,
): void {
  const { control } = field;
  validateDescription(
    field.description,
    MAX_PARAMETER_DESCRIPTION,
    "parameter description",
  );
  if (
    control.ownerDocument !== form.ownerDocument ||
    control.form !== form ||
    !form.contains(control) ||
    !control.isConnected
  ) {
    throw new TypeError(
      "Declarative WebMCP controls must belong to the mounted form as descendants",
    );
  }
  if (!control.name) {
    throw new TypeError("Declarative WebMCP controls require a name");
  }
  if (
    control.disabled ||
    control.matches(":disabled") ||
    control.getAttribute("aria-disabled")?.toLowerCase() === "true"
  ) {
    throw new TypeError("Disabled declarative WebMCP controls are unsupported");
  }
  if (isHiddenOrInert(control)) {
    throw new TypeError("Hidden declarative WebMCP controls are unsupported");
  }
  if (hasCredentialSemantics(control)) {
    throw new TypeError("Credential or sensitive controls cannot be exported");
  }
  if (control instanceof HTMLInputElement && !SAFE_INPUT_TYPES.has(control.type)) {
    throw new TypeError(
      `Input type "${control.type}" is outside the declarative compatibility subset`,
    );
  }
}

function validateOptions(options: WebMcpDeclarativeFormOptions): void {
  const { form } = options;
  if (!TOOL_NAME_PATTERN.test(options.name)) {
    throw new TypeError(
      "Invalid WebMCP form tool name; expected 1-30 ASCII letters, digits, _, -, or .",
    );
  }
  validateDescription(options.description, MAX_TOOL_DESCRIPTION, "tool description");
  if (!form.isConnected) {
    throw new TypeError("Declarative WebMCP form must be connected");
  }
  if (isHiddenOrInert(form)) {
    throw new TypeError("Declarative WebMCP form must be visible");
  }
  validateOrigin(form);

  const fieldControls = new Set<Element>();
  const fieldNames = new Set<string>();
  for (const field of options.fields) {
    validateField(form, field);
    if (fieldControls.has(field.control) || fieldNames.has(field.control.name)) {
      throw new TypeError("Declarative WebMCP field bindings must be unique");
    }
    fieldControls.add(field.control);
    fieldNames.add(field.control.name);
  }

  for (const element of Array.from(form.elements)) {
    const inputType =
      element.tagName === "INPUT"
        ? (element as HTMLInputElement).type
        : element.tagName.toLowerCase();
    if (["submit", "reset", "button", "image"].includes(inputType)) continue;
    if (!isParameterControl(element)) {
      if ((element as HTMLSelectElement).name) {
        throw new TypeError(
          `Control type "${element.tagName.toLowerCase()}" is outside the declarative compatibility subset`,
        );
      }
      continue;
    }
    if (!fieldControls.has(element)) {
      throw new TypeError(
        "Every successful form control must be explicitly bound",
      );
    }
  }
}

function captureAttribute(element: Element, name: string): AttributeSnapshot {
  return {
    element,
    name,
    present: element.hasAttribute(name),
    value: element.getAttribute(name),
  };
}

function restoreAttribute(snapshot: AttributeSnapshot): void {
  if (snapshot.present) {
    snapshot.element.setAttribute(snapshot.name, snapshot.value ?? "");
  } else {
    snapshot.element.removeAttribute(snapshot.name);
  }
}

function hasExactMountedAnnotations(
  options: WebMcpDeclarativeFormOptions,
): boolean {
  return (
    options.form.getAttribute("toolname") === options.name &&
    options.form.getAttribute("tooldescription") === options.description &&
    !options.form.hasAttribute("toolautosubmit") &&
    options.fields.every(
      (field) =>
        field.control.getAttribute("toolparamdescription") === field.description,
    )
  );
}

export function mountDeclarativeWebMcpForm(
  options: WebMcpDeclarativeFormOptions,
): WebMcpDeclarativeFormHandle {
  const mounted: WebMcpDeclarativeFormOptions = Object.freeze({
    form: options.form,
    name: options.name,
    description: options.description,
    fields: Object.freeze(
      options.fields.map((field) =>
        Object.freeze({
          control: field.control,
          description: field.description,
        }),
      ),
    ),
  });
  if (activeForms.has(mounted.form)) {
    throw new TypeError("This form already has an active declarative WebMCP mount");
  }
  validateOptions(mounted);

  const snapshots = [
    captureAttribute(mounted.form, "toolname"),
    captureAttribute(mounted.form, "tooldescription"),
    captureAttribute(mounted.form, "toolautosubmit"),
    ...mounted.fields.map((field) =>
      captureAttribute(field.control, "toolparamdescription"),
    ),
  ];
  mounted.form.setAttribute("toolname", mounted.name);
  mounted.form.setAttribute("tooldescription", mounted.description);
  mounted.form.removeAttribute("toolautosubmit");
  for (const field of mounted.fields) {
    field.control.setAttribute("toolparamdescription", field.description);
  }
  activeForms.add(mounted.form);

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    observer?.disconnect();
    for (const snapshot of snapshots) restoreAttribute(snapshot);
    activeForms.delete(mounted.form);
  };
  const MutationObserverConstructor =
    mounted.form.ownerDocument.defaultView?.MutationObserver;
  const observer = MutationObserverConstructor
    ? new MutationObserverConstructor(() => {
        if (disposed) return;
        try {
          validateOptions(mounted);
          if (!hasExactMountedAnnotations(mounted)) dispose();
        } catch {
          dispose();
        }
      })
    : undefined;
  observer?.observe(mounted.form, {
    attributes: true,
    childList: true,
    subtree: true,
  });
  const documentRoot = mounted.form.ownerDocument.documentElement;
  if (documentRoot && documentRoot !== mounted.form) {
    observer?.observe(documentRoot, {
      attributes: true,
      childList: true,
      subtree: true,
    });
  }

  return {
    form: mounted.form,
    name: mounted.name,
    dispose,
  };
}
