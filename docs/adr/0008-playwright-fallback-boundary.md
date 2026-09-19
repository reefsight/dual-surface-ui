# ADR 0008: Playwright Fallback Shares the Core Action Lifecycle

Status: Accepted for P3.2 implementation on 2026-09-19

Date: 2026-09-19

## Context

Phase 3 needs to operate legacy pages that do not embed Dual Surface UI or
WebMCP. Playwright can observe and operate those pages, but its controller has
more authority than page JavaScript and can see cross-origin frames, browser
state, and credential controls. A generic selector, coordinate, script, or
navigation tool would therefore bypass the package's stable identity, policy,
confirmation, revision, replay, verification, and redaction guarantees.

The existing `AgentSurface` lifecycle is correct but coupled to a local DOM.
Copying that lifecycle into a Playwright adapter would create two security
implementations that can drift. Playwright 1.63 adds AI-oriented JSON ARIA
snapshots, but the returned object is intentionally free-form and its `ref`
values are not a documented public action API.

## Decision

1. Extract the current action lifecycle into one package-internal,
   transport-neutral coordinator. DOM `AgentSurface` and the Playwright
   surface must share that coordinator for request validation, policy,
   confirmation, stale checks, preconditions, idempotency/replay, execution
   boundaries, effect verification, failure normalization, and audit.
2. Preserve the frozen root API and schema. The refactor must be behavior-
   preserving and proven by the existing core suites plus lifecycle parity
   tests before the Playwright subpath is added.
3. Add Playwright only through the optional `dual-surface-ui/playwright`
   subpath. It accepts a caller-owned `Page`; it does not launch a browser,
   open a URL, create an authenticated profile, or own transport identity.
4. Require an explicit trusted allowlist of element IDs, exact accessible
   role/name targets, action metadata, and one of the closed operations:
   `click`, `fill`, `set-checked`, or `select-option`. P3.2 exposes no CSS,
   XPath, regular-expression name, `nth`, coordinate, keyboard, mouse,
   arbitrary locator, script evaluation, file, download, clipboard,
   permission, dialog-acceptance, popup, or navigation primitive.
5. Resolve every target through public semantic locator APIs and require
   exactly one match. Playwright `ref` values, selectors, locators, handles,
   coordinates, frame references, and browser state are internal and never
   serialized. Ambiguous, missing, detached, replaced, hidden, disabled, or
   retargeted controls fail closed.
6. Normalize Playwright's JSON ARIA result immediately into the package's
   bounded snapshot contract. Raw ARIA JSON is never a public contract or
   trace payload. Values from credentials and host-marked sensitive controls
   are excluded before any serialization.
7. Scope one surface to one caller-owned top-level page and an explicit
   allowlist of origins. Frames are excluded from the first slice. Later frame
   support requires one separately configured surface and origin boundary per
   frame; cross-origin contents never inherit parent authority.
8. Bind a monotonic generation to surface, revision, page/frame, origin,
   navigation epoch, target fingerprint, and action. Recheck it after every
   asynchronous policy, confirmation, and precondition step and immediately
   before the single Playwright mutation. Navigation and semantic ABA changes
   invalidate older generations even when the URL or visible state returns.
9. Playwright actionability is an additional guard, not authorization.
   `force: true` is prohibited. A resolved Playwright promise is not success;
   the shared lifecycle still requires deterministic native-state or declared
   application-effect verification.
10. Credential-risk actions and controls are unavailable. Password, OTP,
    token, payment, WebAuthn, client-certificate, file, and host-marked secret
    controls expose neither value nor executable fallback action.
11. Visual fallback is discovery assistance only. A host-provided visual
    selector may choose among current allowlisted semantic node IDs from a
    bounded, ephemeral, masked image. It cannot return a selector, coordinate,
    URL, script, action, risk, confirmation, or new capability. The chosen ID
    must still uniquely resolve at the same current generation and execute
    through `performSafe()`.
12. Images are disabled unless explicitly configured. Before a visual callback
    receives an image, credential/sensitive controls and every excluded frame
    are masked. Images are not returned by snapshot APIs, logged, traced,
    packaged, or retained by the adapter. Failure to mask every required region
    disables visual discovery for that observation.
13. Unexpected navigation, origin change, frame detach, popup, download,
    dialog, page/context close, crash, or browser disconnect invalidates the
    generation and produces a fixed secret-safe failure. It never becomes an
    implicit continuation or confirmation.
14. `playwright-core >=1.63.0 <2` is an optional peer. The root package has no
    Playwright runtime dependency or import side effect. Compatibility with
    the broad peer range is a measured packaging gate, not an assumption.

## Public boundary

The subpath exposes a Playwright surface with asynchronous `snapshot`,
`perform`, `performSafe`, and idempotent `dispose`. Bindings use exact semantic
targets and a closed operation union. The host may supply the same trusted
policy, principal, confirmation, precondition, effect-verification, and audit
callbacks accepted by the DOM surface.

The visual callback, when enabled, receives only a masked in-memory PNG and a
bounded list of current allowlisted candidates. Its result is an optional node
ID. This callback is untrusted selection input and cannot execute anything.

## Consequences

- A legacy page needs no package code, but the host must provide a reviewed
  semantic allowlist. P3.2 does not claim safe automatic execution of every
  arbitrary page.
- The core lifecycle extraction is the highest-risk part and is committed and
  verified independently before adapter behavior is added.
- Exact accessible names may change with localization. Hosts must version and
  review bindings; ambiguity is surfaced rather than silently resolved.
- Visual discovery can improve selection among existing semantic candidates,
  but cannot create a pixel-only action or weaken policy and verification.
- Same-origin and cross-origin frame support remains unavailable until its own
  provenance tests and separate-surface design are accepted.

## Rejected alternatives

- Generic `click(selector)`, `evaluate(script)`, `goto(url)`, keyboard, mouse,
  or coordinate tools: rejected as broad confused-deputy capabilities.
- Playwright `aria-ref` as a stable ID: rejected because action lookup by that
  ref is not a documented public API and refs are observation-scoped.
- Reimplementing policy in the adapter: rejected because lifecycle drift could
  bypass authorization, confirmation, replay, or verification.
- Raw ARIA snapshot export: rejected because it is open-ended and may include
  sensitive textbox content.
- Screenshot-to-coordinate execution: rejected because pixels cannot prove
  semantic identity, authority, current revision, or business effect.
- Implicit traversal of all frames: rejected because Playwright's visibility
  across origins is not application authorization.

## References

- [Playwright JSON ARIA snapshots](https://playwright.dev/docs/api/class-locator#locator-aria-snapshot-json)
- [Playwright locators](https://playwright.dev/docs/locators)
- [Playwright actionability checks](https://playwright.dev/docs/actionability)
- [Playwright browser-context isolation](https://playwright.dev/docs/browser-contexts)
- [Playwright frame locators](https://playwright.dev/docs/api/class-framelocator)

