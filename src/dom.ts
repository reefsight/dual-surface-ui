import type {
  AgentActionSnapshot,
  AgentBounds,
  AgentElementState,
  AgentRisk,
} from "./types.js";

const implicitRoles: Record<string, string> = {
  A: "link",
  BUTTON: "button",
  FORM: "form",
  H1: "heading",
  H2: "heading",
  H3: "heading",
  H4: "heading",
  H5: "heading",
  H6: "heading",
  IMG: "img",
  LI: "listitem",
  MAIN: "main",
  NAV: "navigation",
  OL: "list",
  OPTION: "option",
  SELECT: "combobox",
  TABLE: "table",
  TEXTAREA: "textbox",
  UL: "list",
};

export function roleOf(element: Element): string {
  const explicitRole = element.getAttribute("role")?.trim();
  if (explicitRole) return explicitRole.split(/\s+/)[0] ?? "generic";

  if (element instanceof HTMLInputElement) {
    const roles: Record<string, string> = {
      button: "button",
      checkbox: "checkbox",
      email: "textbox",
      number: "spinbutton",
      radio: "radio",
      range: "slider",
      reset: "button",
      search: "searchbox",
      submit: "button",
      tel: "textbox",
      text: "textbox",
      url: "textbox",
    };
    return roles[element.type] ?? "textbox";
  }

  return implicitRoles[element.tagName] ?? "generic";
}

function textFromIds(element: Element, ids: string): string {
  const document = element.ownerDocument;
  return ids
    .split(/\s+/)
    .map((id) => {
      const reference = document.getElementById(id);
      return reference && isAgentVisible(reference)
        ? visibleTextContent(reference)
        : "";
    })
    .filter(Boolean)
    .join(" ");
}

function visibleTextContent(element: Element): string {
  function collect(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (!(node instanceof Element)) return "";
    if (node !== element && !isAgentVisible(node)) return "";
    if (["SCRIPT", "STYLE", "TEMPLATE"].includes(node.tagName)) return "";
    return Array.from(node.childNodes).map(collect).join(" ");
  }

  return collect(element).replace(/\s+/g, " ").trim();
}

export function accessibleNameOf(element: Element): string {
  const ariaLabel = element.getAttribute("aria-label")?.trim();
  if (ariaLabel) return ariaLabel;

  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const value = textFromIds(element, labelledBy);
    if (value) return value;
  }

  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  ) {
    const labelElement = element.labels?.[0];
    const label = labelElement ? visibleTextContent(labelElement) : "";
    if (label) return label;
    if (
      (element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement) &&
      element.placeholder
    ) {
      return element.placeholder;
    }
  }

  if (element instanceof HTMLImageElement && element.alt) return element.alt;

  return (
    visibleTextContent(element) ||
    element.getAttribute("title")?.trim() ||
    ""
  );
}

export function stateOf(element: Element): AgentElementState {
  const state: AgentElementState = {};
  const sensitive =
    (element instanceof HTMLInputElement && element.type === "password") ||
    element.getAttribute("data-agent-sensitive") === "true";

  if (supportsDisabledState(element)) {
    state.disabled = isEffectivelyDisabled(element);
  }

  if (element instanceof HTMLInputElement) {
    if (element.type === "checkbox" || element.type === "radio") {
      state.checked = element.checked;
    }
    if (sensitive) {
      state.sensitive = true;
      state.valuePresent = element.value.length > 0;
    } else if (!["button", "reset", "submit"].includes(element.type)) {
      state.value = element.value;
    }
  } else if (
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  ) {
    if (sensitive) {
      state.sensitive = true;
      state.valuePresent = element.value.length > 0;
    } else {
      state.value = element.value;
    }
  }

  if (element instanceof HTMLOptionElement) {
    state.selected = element.selected;
  }

  const expanded = element.getAttribute("aria-expanded");
  if (expanded !== null) state.expanded = expanded === "true";

  const selected = element.getAttribute("aria-selected");
  if (selected !== null && !(element instanceof HTMLOptionElement)) {
    state.selected = selected === "true";
  }

  return state;
}

export function boundsOf(element: Element): AgentBounds | undefined {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return undefined;
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

function action(
  name: string,
  risk: AgentRisk,
  inputSchema?: Record<string, unknown>,
): AgentActionSnapshot {
  return { name, risk, ...(inputSchema ? { inputSchema } : {}) };
}

export function inferredActions(element: Element): AgentActionSnapshot[] {
  if (isEffectivelyDisabled(element)) return [];

  if (element instanceof HTMLInputElement) {
    if (element.type === "checkbox" || element.type === "radio") {
      return [action("toggle", "write")];
    }
    if (["button", "reset", "submit"].includes(element.type)) {
      return [action("click", "write")];
    }
    return [
      action(
        "set_value",
        element.type === "password" ||
          element.getAttribute("data-agent-sensitive") === "true"
          ? "credential"
          : "write",
        { type: "string" },
      ),
    ];
  }

  if (element instanceof HTMLSelectElement) {
    const values = Array.from(
      new Set(
        Array.from(element.options)
          .filter(
            (option) =>
              isAgentVisible(option) && !isEffectivelyDisabled(option),
          )
          .map((option) => option.value),
      ),
    );
    if (values.length === 0) return [];
    const sensitive = element.getAttribute("data-agent-sensitive") === "true";
    return [
      action(
        "select",
        sensitive ? "credential" : "write",
        sensitive ? { type: "string" } : { type: "string", enum: values },
      ),
    ];
  }

  if (element instanceof HTMLTextAreaElement) {
    return [
      action(
        "set_value",
        element.getAttribute("data-agent-sensitive") === "true"
          ? "credential"
          : "write",
        { type: "string" },
      ),
    ];
  }

  if (element instanceof HTMLFormElement) {
    return [action("submit", "consequential")];
  }

  if (
    element instanceof HTMLButtonElement ||
    element instanceof HTMLAnchorElement ||
    element.getAttribute("role") === "button"
  ) {
    return [action("click", "write")];
  }

  return [];
}

export function isSemanticCandidate(element: Element): boolean {
  if (!isAgentVisible(element)) return false;
  return roleOf(element) !== "generic" || element.hasAttribute("data-agent-id");
}

export function isAgentVisible(element: Element): boolean {
  if (element instanceof HTMLInputElement && element.type === "hidden") {
    return false;
  }

  for (let current: Element | null = element; current; current = current.parentElement) {
    if (
      current.hasAttribute("hidden") ||
      current.hasAttribute("inert") ||
      current.getAttribute("aria-hidden")?.trim().toLowerCase() === "true"
    ) {
      return false;
    }
    if (current.tagName === "DIALOG" && !current.hasAttribute("open")) {
      return false;
    }
    if (current instanceof HTMLDetailsElement && !current.open) {
      const summary = Array.from(current.children).find(
        (child) => child instanceof HTMLElement && child.tagName === "SUMMARY",
      );
      if (!summary || (element !== summary && !summary.contains(element))) {
        return false;
      }
    }

    const style = current.ownerDocument.defaultView?.getComputedStyle(current);
    if (
      style?.display === "none" ||
      style?.getPropertyValue("content-visibility") === "hidden"
    ) {
      return false;
    }
  }

  const visibility =
    element.ownerDocument.defaultView?.getComputedStyle(element).visibility;
  return visibility !== "hidden" && visibility !== "collapse";
}

export function isEffectivelyDisabled(element: Element): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (
      current.hasAttribute("inert") ||
      current.getAttribute("aria-disabled")?.trim().toLowerCase() === "true"
    ) {
      return true;
    }
  }
  try {
    if (element.matches(":disabled")) return true;
  } catch {
    // Non-browser DOM implementations may not support :disabled.
  }
  if (element instanceof HTMLOptionElement) {
    return (
      element.disabled ||
      element.parentElement instanceof HTMLOptGroupElement &&
        element.parentElement.disabled ||
      element.closest("select")?.disabled === true
    );
  }
  return false;
}

export function isValidNativeActionInput(
  element: Element,
  actionName: string,
  input: unknown,
): boolean {
  if (actionName !== "select" || !(element instanceof HTMLSelectElement)) {
    return true;
  }
  return (
    typeof input === "string" &&
    Array.from(element.options).some(
      (option) =>
        option.value === input &&
        isAgentVisible(option) &&
        !isEffectivelyDisabled(option),
    )
  );
}

function supportsDisabledState(element: Element): boolean {
  return (
    element instanceof HTMLButtonElement ||
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLOptionElement ||
    element.hasAttribute("aria-disabled") ||
    ["button", "checkbox", "combobox", "link", "radio", "textbox"].includes(
      roleOf(element),
    )
  );
}

export function runNativeAction(
  element: Element,
  actionName: string,
  input: unknown,
): void {
  if (!isAgentVisible(element)) {
    throw new Error("Native action target is not visible");
  }
  if (isEffectivelyDisabled(element)) {
    throw new Error("Native action target is disabled");
  }

  if (actionName === "click" && element instanceof HTMLElement) {
    element.click();
    return;
  }

  if (actionName === "toggle" && element instanceof HTMLInputElement) {
    element.click();
    return;
  }

  if (
    actionName === "set_value" &&
    (element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement)
  ) {
    if (typeof input !== "string") {
      throw new TypeError("set_value requires a string input");
    }
    element.value = input;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  if (actionName === "select" && element instanceof HTMLSelectElement) {
    if (typeof input !== "string") {
      throw new TypeError("select requires a string input");
    }
    const option = Array.from(element.options).find(
      (candidate) =>
        candidate.value === input &&
        isAgentVisible(candidate) &&
        !isEffectivelyDisabled(candidate),
    );
    if (!option) throw new TypeError("select requires an enabled option");
    element.selectedIndex = option.index;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  if (actionName === "submit" && element instanceof HTMLFormElement) {
    element.requestSubmit();
    return;
  }

  throw new Error(`Action "${actionName}" is not supported for this element`);
}
