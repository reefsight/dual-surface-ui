# ADR 0004: DOM Visibility, Disabled State, and Native Form Actions

Status: Accepted

Date: 2026-09-18

## Context

The DOM reference compiler currently excludes only elements carrying their own
`hidden` or `aria-hidden="true"` attribute. Descendants of hidden containers,
CSS-hidden controls, inert subtrees, closed dialogs/details, and
`input[type="hidden"]` can still enter the semantic surface. Disabled controls
also retain advertised actions, so a caller can attempt behavior unavailable
to the human user.

The Phase 1 roadmap separately requires native `select` and `submit` actions.
Treating a select as a generic `set_value` hides option constraints, while a
form has no native action at all.

## Decision

- A node is agent-visible only when it and its ancestor chain are not hidden by
  HTML `hidden`, `aria-hidden="true"`, `inert`, CSS `display:none`, CSS
  `content-visibility:hidden`, a closed dialog, or a closed details region
  outside its first summary. Hidden inputs are always excluded.
- CSS `visibility` is evaluated on the candidate's computed style so inherited
  hidden/collapse is respected while an explicitly visible descendant remains
  representable.
- Invisible elements cannot be resolved by ID for execution, including guessed
  registered IDs.
- Disabled native controls, disabled fieldset descendants, disabled options,
  and ARIA-disabled controls remain observable with `state.disabled: true` but
  expose no actions. Guessed actions are rejected before policy or mutation.
- Native `<select>` exposes `select` rather than `set_value`. A non-sensitive
  select publishes a string enum of currently visible, enabled option values;
  duplicate values are deduplicated. Sensitive selects retain only the string
  type, and all select inputs are checked against visible, enabled options before
  policy. A select with no eligible options exposes no action.
- Native `<form>` exposes `submit` and executes through `requestSubmit()` so
  browser constraint validation and submit events remain authoritative.
- Native `select` verifies exact resulting value. Native `submit` requires a
  semantic revision transition, matching the existing conservative click rule.
- Option selected/disabled state and effective disabled state contribute to the
  semantic signature, so dynamic changes advance revision and invalidate stale
  requests.

## Consequences

Positive:

- the agent catalog tracks what a human can currently see and operate;
- hidden and disabled controls fail closed even when IDs are guessed;
- select choices are typed and validated before policy/execution;
- form submission uses the browser's native validation and event lifecycle;
- visibility, enablement, options, and selection changes become stale-safe.

Negative:

- applications relying on guessed hidden or disabled actions stop working and
  must expose an explicit visible domain action instead;
- select integrations migrate from action name `set_value` to `select`;
- submit success requires an observable semantic transition or an explicit
  domain action with authoritative effect verification;
- computed-style checks add bounded work during snapshot compilation.

## Alternatives rejected

1. Keep hidden nodes but label them: still exposes operations unavailable in
   the visible UI and increases prompt-injection surface.
2. Expose disabled actions and rely on the browser: direct value assignment can
   mutate disabled controls and custom handlers may still run.
3. Keep select as `set_value`: does not communicate available choices and makes
   invalid values reach execution.
4. Call `form.submit()`: bypasses submit events and constraint validation.
5. Treat a fired submit event as verified success: an event alone does not
   prove an authoritative state transition.

## Revisit conditions

Revisit when Shadow DOM, iframe, browser-layout integration, or async navigation
support begins. Those require browser-level conformance evidence beyond jsdom.
