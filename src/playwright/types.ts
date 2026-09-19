import type { Page } from "playwright-core";

import type {
  AgentActionDefinition,
  AgentActionOutcome,
  AgentActionRequest,
  AgentActionResult,
  AgentSnapshot,
  AgentSurfaceOptions,
} from "../types.js";

export type PlaywrightAriaRole =
  | "alert" | "alertdialog" | "application" | "article" | "banner"
  | "blockquote" | "button" | "caption" | "cell" | "checkbox" | "code"
  | "columnheader" | "combobox" | "complementary" | "contentinfo"
  | "definition" | "deletion" | "dialog" | "directory" | "document"
  | "emphasis" | "feed" | "figure" | "form" | "generic" | "grid"
  | "gridcell" | "group" | "heading" | "img" | "insertion" | "link"
  | "list" | "listbox" | "listitem" | "log" | "main" | "marquee"
  | "math" | "meter" | "menu" | "menubar" | "menuitem"
  | "menuitemcheckbox" | "menuitemradio" | "navigation" | "none" | "note"
  | "option" | "paragraph" | "presentation" | "progressbar" | "radio"
  | "radiogroup" | "region" | "row" | "rowgroup" | "rowheader"
  | "scrollbar" | "search" | "searchbox" | "separator" | "slider"
  | "spinbutton" | "status" | "strong" | "subscript" | "superscript"
  | "switch" | "tab" | "table" | "tablist" | "tabpanel" | "term"
  | "textbox" | "time" | "timer" | "toolbar" | "tooltip" | "tree"
  | "treegrid" | "treeitem";

export interface PlaywrightSemanticTarget {
  role: PlaywrightAriaRole;
  name: string;
}

export type PlaywrightOperation =
  | { type: "click" }
  | { type: "fill" }
  | { type: "set-checked"; checked: boolean }
  | { type: "select-option" };

export interface PlaywrightActionBinding
  extends Omit<AgentActionDefinition, "handler"> {
  operation: PlaywrightOperation;
}

export interface PlaywrightElementBinding {
  id: string;
  target: PlaywrightSemanticTarget;
  description?: string;
  sensitive?: boolean;
  actions: Readonly<Record<string, PlaywrightActionBinding>>;
}

export interface PlaywrightSurfaceOptions
  extends Pick<
    AgentSurfaceOptions,
    | "authorize"
    | "checkPrecondition"
    | "confirm"
    | "createCorrelationId"
    | "getPrincipal"
    | "idempotencyCacheSize"
    | "onAudit"
    | "policy"
    | "verifyEffect"
  > {
  page: Page;
  surfaceId: string;
  allowedOrigins: readonly string[];
  bindings: readonly PlaywrightElementBinding[];
}

export interface PlaywrightSurface {
  snapshot(options?: { signal?: AbortSignal }): Promise<AgentSnapshot>;
  perform(request: AgentActionRequest, options?: { signal?: AbortSignal }): Promise<AgentActionResult>;
  performSafe(request: AgentActionRequest, options?: { signal?: AbortSignal }): Promise<AgentActionOutcome>;
  dispose(): void;
}
