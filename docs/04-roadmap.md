# Four-Phase Execution Roadmap

Status: Accepted at Gate 0 on 2026-09-18

Each phase is a contract. Work is complete only when its exit evidence exists.
Passing unit tests alone is not sufficient.

## Phase 1 — Core contract and DOM reference

### Objective

Prove that one visible web state can produce a stable, secret-safe contract and
execute a small action set through deterministic policy and verification.

### Deliverables

1. Versioned TypeScript core schema plus generated JSON Schema.
2. Snapshot, node, action, result, error, risk, and policy contracts.
3. DOM/ARIA reference compiler with explicit visibility and redaction rules.
4. Stable-ID strategy and stale-revision handling.
5. Native HTML actions for click, toggle, set value, select, and submit.
6. Authorization interface with deny-by-default write behavior.
7. Conformance fixtures including secrets, hidden content, disabled controls,
   duplicate IDs, dynamic state, and invalid actions.
8. One example workflow and measurement baseline.

### Explicit exclusions

No framework adapters, WebMCP, MCP server, extension, model calls, native code,
or hosted service.

### Exit gate

- Public schema reviewed and frozen as `0.1`.
- Security tests show zero secret leakage and zero unauthorized writes.
- Contract fixtures are deterministic across repeated runs.
- Supported actions verify state after execution.
- Package install, typecheck, build, tests, and dry-run packaging pass.
- Baseline token, step, latency, and completion metrics are recorded.

## Phase 2 — Web standards and framework adoption

### Objective

Make existing web applications emit standards-compatible tools with minimal
integration work and prove parity with visible user workflows.

### Deliverables

1. WebMCP imperative exporter.
2. WebMCP declarative form compatibility and feature detection/polyfill path.
3. React, Angular, and Vue adapters, delivered one at a time.
4. Domain-action annotations with input/output schemas, preconditions, effects,
   confirmation, and verification.
5. Drift checker comparing visible controls, accessibility semantics, declared
   tools, permissions, and application state.
6. Examples for checkout, document approval, and a migrated legacy form.
7. Browser support matrix and graceful fallback behavior.

### Exit gate

- Each example completes the same workflow through human UI and agent action.
- WebMCP Inspector/manual invocation passes for supported browsers.
- Framework unmount/remount does not leak or duplicate tools.
- Cross-origin, iframe, navigation, and stale-tool tests pass.
- Tool descriptions and outputs meet documented character budgets.
- No application business rule exists only in the agent adapter.

Exit status on 2026-09-19: implementation and evidence are ready for the
repository maintainer's decision. Phase 2 is not yet accepted, and Phase 3 must
not begin until that approval is recorded in the
[Phase 2 Exit Review](reviews/phase2-exit-review.md).

## Phase 3 — Ecosystem, reliability, and evaluation

### Objective

Support agents outside the page, measure real task quality, and make failures
reproducible without weakening the web security model.

### Deliverables

1. MCP exporter exposing snapshot resources and typed action tools.
2. Playwright adapter for legacy/uncooperative pages and visual fallback.
3. CLI for inspect, validate, diff, record, replay, and evaluate.
4. Incremental/delta snapshots with explicit revision semantics.
5. Redacted action traces and deterministic replay fixtures.
6. Multi-model evaluation suite separating discovery, selection, arguments,
   policy, execution, and verification.
7. Prompt-injection and confused-deputy adversarial suite.
8. Performance and token benchmarks against Playwright accessibility snapshot
   and vision baselines.

### Exit gate

- Golden tasks meet the accepted success, token, and wrong-action thresholds.
- Replays reproduce all supported deterministic failures.
- MCP and WebMCP exports pass the same core conformance suite.
- Fallback never bypasses policy or confirmation.
- Threat-model review has no unresolved critical/high finding.
- Maintainers approve native feasibility based on actual web evidence.

## Phase 4 — Native surfaces

### Objective

Reuse the proven contract for desktop applications without embedding platform
details in the core schema.

### Delivery sequence

1. Freeze the language-neutral `native-protocol`.
2. Build a fixture desktop application and golden accessibility trees.
3. Implement Windows UI Automation adapter first.
4. Run the Rust decision gate; TypeScript/.NET remains allowed if Rust has no
   measured benefit.
5. Implement macOS Accessibility adapter after Windows conformance passes.
6. Evaluate mobile separately; it is not implied by desktop completion.

### Exit gate

- Windows and macOS map equivalent controls/actions to the same core semantics.
- OS permission prompts and revocation are tested.
- Secure desktop, password, sandbox, and unsupported-control behavior fails
  closed and is documented.
- Native daemon authentication, process isolation, and upgrade compatibility
  pass security review.
- Performance meets measured budgets without requiring C or assembly.

## Release checkpoints

- `0.1`: Phase 1 technical preview.
- `0.2`: Phase 2 WebMCP preview.
- `0.3`: Phase 3 ecosystem/eval preview.
- `0.4`: Phase 4 native preview.
- `1.0`: schema stability, documented migrations, security review, and two
  production-shaped reference integrations.

Versions are targets, not deadlines. A phase cannot be declared complete by
renaming unfinished work as experimental.
