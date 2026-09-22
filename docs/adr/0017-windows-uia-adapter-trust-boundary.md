# ADR 0017: Windows UI Automation Adapter Trust Boundary

Status: Proposed; blocked on P4.2 acceptance

Date: 2026-09-22

## Context

Microsoft UI Automation exposes semantic control patterns, but its tree,
provider text, runtime identifiers, events, and application behavior are not a
security authority. Providers can be buggy or hostile, elements can disappear
or be replaced, events can race requests, and sensitive/privileged desktops
must not be treated like ordinary application windows.

## Proposed decision

1. Keep UIA behind an internal platform adapter. Public clients receive only protocol 0.1 and core semantic projections.
2. Admit windows through trusted host policy and bind opaque references to OS user/session, desktop, process, window, and generation state.
3. Treat every UIA property, pattern, runtime ID, event, and exception as untrusted input; bound and validate before normalization or logging.
4. Use AutomationId, name, control type, and tree structure only as correlation signals; re-resolve and reject ambiguity before action.
5. Support semantic UIA patterns explicitly. P4.3 has no generic input, mouse/keyboard injection, shell, memory, or raw selector fallback.
6. Recheck policy, confirmation, revision, pattern availability, identity generation, and expected effects immediately before mutation.
7. Verify postconditions through fresh UIA state and the fixture's separate authoritative state; uncertain outcomes never become false success/failure.
8. Fail closed on provider disconnect, replacement, desktop/session change, event gap, severe resource violation, or identity ambiguity.
9. Password/sensitive controls expose classification and safe presence only; values and write actions are unavailable.
10. Keep language types, COM layout, unsafe blocks, native handles, and serializer defaults outside schemas and fixtures.

## Language boundary

P4.3 may build bounded implementation spikes needed to prove binding behavior
and gather comparable measurements. No spike is the selected production bridge
until P4.4 applies the accepted Rust decision method. The maintainer's Rust
preference is recorded, but semantic/security conformance is mandatory for
every candidate.

## Consequences

- Real-host tests are slower and less portable than mock tests, but are required for native claims.
- Providers without a reviewed semantic pattern remain unsupported instead of receiving a generic injection fallback.
- The adapter can be reimplemented after P4.4 without changing protocol 0.1.
- A later authenticated native host must wrap this boundary; P4.3 alone is not remotely callable or production-ready.

## Rejected alternatives

- Trusting AutomationId or runtime ID as authority: rejected because identifiers can be absent, duplicated, recycled, or application-controlled.
- Exposing HWND/PID/COM references: rejected because it leaks platform authority and creates confused-deputy input.
- Mouse/keyboard fallback: deferred to a separately threat-modeled and explicitly labeled future decision.
- Choosing Rust solely from preference: rejected by the evidence gate; Rust remains preferred and must satisfy the measured decision method.
