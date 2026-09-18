# Native and Low-Level Language Strategy

Status: Accepted at Gate 0 on 2026-09-18

## Decision summary

The web SDK remains TypeScript through Phases 1–3. Native work begins only in
Phase 4 after web product and security evidence exists. Rust is an option for a
local native bridge, not a project requirement. C and assembly are not planned.

## Why web first

- Browser semantics and WebMCP are JavaScript-native.
- TypeScript minimizes integration friction for React, Angular, and Vue teams.
- Product contracts will change during validation; fast iteration matters more
  than low-level performance.
- Most early risk is semantic correctness and authorization, not CPU cost.

## Native architecture

```text
Agent client
    |
Authenticated local channel
    |
Native bridge (least privilege)
    |
Platform adapter
    +-- Windows UI Automation
    +-- macOS Accessibility API
    |
Running application accessibility tree
```

The bridge emits the same core snapshots/actions but retains platform metadata
inside adapter extensions. It does not expose arbitrary memory, shell access,
or unrestricted input injection.

## Platform order

### Windows first

Use Microsoft UI Automation control types, properties, events, and control
patterns. Prefer Invoke, Value, Toggle, Selection, ExpandCollapse, and other
semantic patterns. Mouse/keyboard simulation is an explicit fallback.

References:

- https://learn.microsoft.com/en-us/windows/win32/winauto/entry-uiautocore-overview
- https://learn.microsoft.com/en-us/windows/apps/dev-tools/winapp-cli/ui-automation

### macOS second

Use the macOS Accessibility API and `AXUIElement` after Windows conformance
validates the platform-neutral contract. Permission denial and revoked consent
are normal states and must fail closed.

References:

- https://developer.apple.com/documentation/applicationservices/axuielement_h
- https://developer.apple.com/documentation/accessibility/integrating-accessibility-into-your-app

### Mobile later

Android Accessibility and iOS accessibility/testing APIs require a separate
feasibility and distribution review. Desktop completion does not authorize or
imply mobile implementation.

## Rust decision gate

Rust is selected only if at least one measured requirement cannot be met safely
and maintainably by TypeScript/Node plus platform-native bindings, or by .NET on
Windows and Swift on macOS.

Decision evidence must include:

- benchmark showing material latency, memory, startup, or throughput need;
- need for a single hardened cross-platform daemon;
- sandbox/process-isolation advantage;
- binding maturity for required platform APIs;
- packaging, signing, update, and contributor costs;
- security review of unsafe/native boundaries.

If selected, Rust owns the native daemon and normalization engine only. Public
web APIs and framework adapters remain TypeScript. A language-neutral protocol
prevents Rust types from leaking into the public contract.

## C and assembly policy

C is permitted only for a narrowly scoped platform binding unavailable through
maintained safer libraries, documented behind a safe interface and reviewed for
memory safety. Assembly requires a separate ADR with a demonstrated requirement;
no current roadmap item needs it.

## Native security requirements

- OS-granted accessibility permission is mandatory and revocable.
- Client-to-daemon authentication and per-session authorization are mandatory.
- Bind locally by default; remote exposure is forbidden without a new threat
  model and explicit configuration.
- Process, window, user/session, and surface identity are bound to actions.
- Secure desktop, password controls, permission dialogs, and unsupported apps
  fail closed.
- Native events and snapshots use the same secret-redaction rules as web.
- Every input-injection fallback is labeled and audited.

## Native proof required

Unit tests on a non-native platform are not native proof. Completion requires a
real fixture application, real OS accessibility tree, permission lifecycle,
semantic action execution, authoritative state verification, and recorded OS
and API versions on each supported platform.
