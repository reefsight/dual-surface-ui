# Target Architecture and Contracts

Status: Accepted at Gate 0 on 2026-09-18

## Architectural shape

```text
Application state and visible UI
        |
        +-- DOM / ARIA / framework state
        +-- domain action annotations
        +-- current user/session permissions
        |
        v
Semantic compiler
        |
        +-- versioned snapshot
        +-- typed action catalog
        +-- redaction and policy metadata
        |
        v
Policy and execution runtime
        |
        +-- authorize -> precondition -> execute -> verify -> audit
        |
        +-- WebMCP exporter
        +-- MCP exporter
        +-- Playwright adapter
        +-- test/eval harness
        +-- native bridge (Phase 4)
```

The compiler describes available behavior; it does not duplicate business
logic. Handlers call the same application services used by the human UI.

## Core concepts

### Surface

A bounded application context such as a page, dialog, document, or native
window. A surface has an origin, identity, revision, capabilities, and nodes.

### Node

A user-perceivable semantic element derived from accessibility data or an
explicit annotation. Nodes may expose readable state and low-level fallback
actions. Node IDs are stable within a documented lifetime and are never raw
CSS selectors presented as a durable contract.

### Domain action

A named business operation with:

- concise purpose and user-visible meaning;
- JSON Schema input and output;
- preconditions and expected effects;
- risk and consequence annotations;
- permission and confirmation requirements;
- idempotency/replay policy;
- verification strategy;
- handler reference, not duplicated business logic.

### Snapshot

An immutable observation carrying `schemaVersion`, `surfaceId`, `revision`,
`generatedAt`, context, nodes, actions, and redaction metadata. An action
request includes the observed revision when stale-state safety is required.

### Policy decision

A deterministic allow, deny, or require-confirmation result derived from the
current principal, action metadata, input, origin, and application state.
Model output is untrusted input to policy; it is never the policy engine.

## Action lifecycle

1. Discover the current surface and capabilities.
2. Select a typed action from the catalog.
3. Validate input against its schema.
4. Reject stale revisions where state may have changed.
5. Evaluate authentication, authorization, risk, origin, and consent policy.
6. Check application preconditions immediately before execution.
7. Execute through the existing application service.
8. Verify declared effects from authoritative state.
9. Return a structured result and the new revision.
10. Write a redacted audit record.

No successful result is returned merely because a click or handler call did
not throw. Verification must confirm an expected state transition.

## Proposed monorepo structure

```text
packages/
  core/                 Versioned types, schema, policy interfaces
  dom/                  DOM/ARIA compiler and native HTML actions
  policy/               Default risk, consent, origin, redaction policies
  domain/               Strict trusted action authoring/compiler layer
  drift/                Reviewed-manifest and same-epoch parity checker
  webmcp/               WebMCP exporter and compatibility layer
  mcp/                  MCP tools/resources exporter
  react/                React bindings
  angular/              Angular bindings
  vue/                  Vue bindings
  playwright/           External fallback and conformance adapter
  cli/                  Inspect, validate, record, replay, and eval commands
  evals/                Deterministic and model-based evaluation harness
  native-protocol/      Language-neutral native bridge protocol
native/
  windows/              Phase 4 Windows UIA adapter
  macos/                Phase 4 macOS Accessibility adapter
examples/
  checkout/
  document-approval/
  legacy-form/
fixtures/
  contracts/
  security/
  conformance/
docs/
  adr/
```

Directories are created only when their phase begins. This tree defines
boundaries, not permission to implement later phases early.

## Package dependency rules

- `core` has no DOM, framework, MCP, or native dependency.
- Exporters depend on `core`; `core` never depends on exporters.
- Framework adapters are thin lifecycle/binding layers and contain no policy.
- Policy may inspect core contracts but does not call UI adapters directly.
- Native adapters communicate through `native-protocol` and cannot silently
  extend the stable schema.
- Examples never become runtime dependencies.

## Contract evolution

Every serialized contract includes a schema version. Schema changes require:

1. an ADR if semantics change;
2. updated JSON Schema;
3. old and new golden fixtures;
4. compatibility tests;
5. migration notes;
6. exporter conformance verification.

## Observability

Required events are `surface_observed`, `action_requested`, `policy_decided`,
`confirmation_requested`, `action_started`, `action_verified`, and
`action_failed`. Events carry correlation ID, action name, schema version,
surface revision, duration, and redacted outcome. Raw credentials, model
prompts, page text, and action inputs are not logged by default.
