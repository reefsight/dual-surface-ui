import type {
  AgentActionSnapshot,
  AgentBounds,
  AgentElementState,
  AgentRisk,
} from "./types.js";

const implicitRoles: Record<string, string> = {
  A: "link",
  BUTTON: "button",
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
    .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
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
    const label = element.labels?.[0]?.textContent?.trim();
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
    element.textContent?.replace(/\s+/g, " ").trim() ||
    element.getAttribute("title")?.trim() ||
    ""
  );
}

export function stateOf(element: Element): AgentElementState {
  const state: AgentElementState = {};
  const sensitive =
    (element instanceof HTMLInputElement && element.type === "password") ||
    element.getAttribute("data-agent-sensitive") === "true";

  if (
    element instanceof HTMLButtonElement ||
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  ) {
    state.disabled = element.disabled;
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

  const expanded = element.getAttribute("aria-expanded");
  if (expanded !== null) state.expanded = expanded === "true";

  const selected = element.getAttribute("aria-selected");
  if (selected !== null) state.selected = selected === "true";

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

  if (
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
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
  if (element.hasAttribute("hidden")) return false;
  if (element.getAttribute("aria-hidden") === "true") return false;
  return roleOf(element) !== "generic" || element.hasAttribute("data-agent-id");
}

export function runNativeAction(
  element: Element,
  actionName: string,
  input: unknown,
): void {
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
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement)
  ) {
    if (typeof input !== "string") {
      throw new TypeError("set_value requires a string input");
    }
    element.value = input;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  throw new Error(`Action "${actionName}" is not supported for this element`);
}
