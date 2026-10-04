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

Exit status on 2026-09-19: accepted by the repository maintainer. P3.1 planning
and implementation are authorized in the
[Phase 2 Exit Review](reviews/phase2-exit-review.md).

## Phase 3 — Ecosystem, reliability, and evaluation

Execution status on 2026-09-21: P3.1 through P3.9 are implemented and verified,
and the clean P3.10 audit passed all 22 commands. The repository maintainer
accepted the [Phase 3 Exit Review](reviews/phase3-exit-review.md) on
2026-09-21. Phase 4 remains blocked because P4.1 authorization was not part of
that decision.

### Objective

Support agents outside the page, measure real task quality, and make failures
reproducible without weakening the web security model.

### Deliverables

1. P3.1 — MCP exporter exposing snapshot resources and typed action tools.
2. P3.2 — Playwright adapter for legacy/uncooperative pages and visual
   fallback.
3. P3.3 — Incremental/delta snapshots with explicit revision and
   resynchronization semantics.
4. P3.4 — Redacted action traces and deterministic replay fixtures.
5. P3.5 — CLI for inspect, validate, diff, record, replay, and evaluate.
6. P3.6 — Shared conformance across MCP, WebMCP, DOM, and overlapping
   Playwright capabilities.
7. P3.7 — Prompt-injection and confused-deputy adversarial suite.
8. P3.8 — Multi-model evaluation separating discovery, selection, arguments,
   safety, execution, verification, and efficiency.
9. P3.9 — Performance and token benchmarks against full-DOM, Playwright
   accessibility, and vision baselines, plus web-evidence-based native
   feasibility preparation.
10. P3.10 — Phase 3 Exit Audit and proposed review for a separate maintainer
    decision.

### Execution status

P3.1 through P3.9 are implemented and verified, and P3.10 has completed the
technical exit audit. The P3.6 private conformance design and implementation
are governed by accepted ADR 0012 and the dated aggregate evidence report.
P3.7 implementation, automated evidence, and independent review are complete;
the Phase 3 exit gate was accepted on 2026-09-21.
P3.8 has passing supported Luna medium/high evidence on the frozen 12-case
suite. P3.9 has passing exact-provider token and quality evidence across four
baselines, with a conditional recommendation limited to P4.1 language-neutral
protocol design. Real-OS native proof remains open for Phase 4.
Work-item records define the acceptance and evidence gates; design records do
not claim implementation or completion.

### Exit gate

- Golden tasks meet the accepted success, token, and wrong-action thresholds.
- Replays reproduce all supported deterministic failures.
- MCP and WebMCP exports pass the same core conformance suite.
- Fallback never bypasses policy or confirmation.
- Threat-model review has no unresolved critical/high finding.
- Maintainers approve native feasibility based on actual web evidence.

## Phase 4 — Native surfaces

Execution status on 2026-09-22: Phase 4 execution through Exit Gate
preparation is authorized under the original language decision gate. P4.1
language-neutral protocol implementation and automated evidence are complete;
its independent protocol/security/interoperability/package review was approved
by `Pitchayut586` on 2026-09-22 with no unresolved critical/high finding.
Rust is preferred by the maintainer but remains evidence-gated. See
the [Phase 4 Execution Authorization](reviews/phase4-execution-authorization.md).

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

P4.2 fixture planning is complete in
[the controlled Windows fixture work item](work-items/P4.2-native-fixture-application.md)
and accepted [ADR 0016](adr/0016-native-fixture-application-boundary.md).
P4.1 and the P4.2 entry gate are accepted; P4.2 runtime implementation is
authorized as of 2026-09-22.
Continuation on 2026-10-03 resolved the SDK prerequisite without elevation.
P4.2 is now accepted after review/remediation, two source-bound serial real UIA
runs of 22 cases, 676 full-gate tests, 111 browser tests and all remaining gates.
Actual separate agents approved all four roles; acceptance was recorded on the
maintainer's behalf under the explicit dated delegation. Failed startup runs and
the scoped serial-run limitation remain retained. See
[P4.2 acceptance](reviews/p4.2-acceptance-2026-10-03.md).
The closed 0.1 [review record](reviews/p4.2-independent-review.json) and
source/evidence-bound validator now return canonical `gate_ready`. Earlier
[review-contract evidence](evidence/p4.2-review-contract-2026-10-03.md) is
historical pending-record evidence, not the current disposition.
P4.3 Windows adapter planning is complete in
[the Windows UIA adapter work item](work-items/P4.3-windows-uia-adapter.md) and
accepted [ADR 0017](adr/0017-windows-uia-adapter-trust-boundary.md).
The [separate P4.3 entry decision](reviews/p4.3-entry-2026-10-03.md) authorizes
the independently reviewed bounded implementation slices after P4.2 acceptance;
P4.3 runtime completion and Phase 4 Exit Gate remain open.
The [2026-10-03 identity development checkpoint](evidence/p4.3-identity-development-2026-10-03.md)
records the independently reviewed decision-only reference and retained native
admission failures. The [October 4 continuation](evidence/p4.3-identity-continuation-2026-10-04.md)
adds actual 15-case first-run success on the normal input desktop, followed by
a failed planned repeat at fixture startup; that checkpoint remains incomplete.
The later [October 4 serial evidence](evidence/p4.3-startup-diagnostics-serial-2026-10-04.md)
has actual 15/15 first and repeat reports plus fresh 679 full/114 browser/12
conformance tests, zero audit vulnerabilities and other current gates.
Three actual independent final reviews support the separate
[limited S1 identity-decision acceptance](reviews/p4.3-s1-acceptance-2026-10-04.md).
The independently revised [read-only S2 design](work-items/P4.3-read-only-capture-projection.md)
has a separate [implementation entry](reviews/p4.3-s2-entry-2026-10-04.md);
S2 runtime, full P4.3 and Phase 4 completion remain open. Earlier failed runs,
startup cause/reliability, real OS negatives and all later criteria are retained.
The later [S2 deterministic foundation decision](reviews/p4.3-capture-foundation-decision-2026-10-04.md)
accepts only reviewed pure projection/identity/comparison prerequisites and the
bounded Window-family clarification. [Current development evidence](evidence/p4.3-capture-foundation-2026-10-04.md)
is108 C# units,52 focused/731 full JS tests plus serialized11-subject admission,
not any of the required22 real native capture scenarios or S2 runtime closure.
The later [fixed capture-suite development](evidence/p4.3-native-suite-development-2026-10-04.md)
adds source-reviewed owned setup/collection integration and an independent
original-byte verifier. Its three authentic source reviews close all reported
Medium findings at a precise13-path source/binary binding; pure158 C# and157 JS
suite tests do not establish native acceptance. Real first/repeat artifacts,
independent artifact reviews and a separate S2 runtime decision remain required.
Its first source/binary-frozen native attempt then stopped before publication,
with only two fixture recorder files retained and no repeat. Zero S2 native
scenario passes are claimed; reviewed secret-safe diagnostics are the next step,
not retries or relaxed fixture/guard/budget rules.
The later [D1 bounded diagnostics checkpoint](evidence/p4.3-native-suite-d1-development-2026-10-04.md)
has three actual final source approvals,238 managed pure units,1137 full JS,
114 managed-browser and12 deterministic-conformance cases plus all remaining
prerequisites. Its one changed-source native attempt failed at bootstrap before
any scenario completed; a separately admitted original-byte negative record
asserts startup/setup-admission/guard-refused/Unavailable, not an exact internal
OS cause or successful cleanup. No repeat or unchanged retry followed. New
negative artifact reviews independently admit the same failed original bytes
without accepting native/S2; complete22/32 native first/repeat proof,
independent artifact approval and a separate S2 runtime decision stay mandatory.
The later [D2 constructor-guard checkpoint](evidence/p4.3-native-suite-d2-development-2026-10-04.md)
adds an independently source-reviewed passive observer,397 suite/447 component
pure cases,1816 full JS tests,114 managed-browser cases and all remaining
prerequisites. Its sole exact source/binary-admitted native first lane failed
at bootstrap; the separately admitted original14-key record identifies only
worker-desktop/desktop-input, not which query/size/flag operand or OS condition
failed. No repeat or unchanged retry followed and no successful native scenario
is claimed. Actual negative-artifact reviews remain distinct from native/S2
acceptance. Human host-context coordination is required before a separately
authorized controlled continuation; no desktop/security bypass is permitted.
The separate [historical replay revision maintenance evidence](evidence/native-protocol-replay-revision-development-2026-10-04.md)
and [scoped P4.1 corrective decision](reviews/native-protocol-replay-revision-decision-2026-10-04.md)
record an independently reviewed five-line verifier correction,22 focused/1823
canonical JS tests,114 managed-browser cases and remaining fresh gates. The
supplemental batch's12 failures/unknown cause and criteria-after-correction SDLC
ordering limitation remain explicit; no native or whole-goal acceptance follows.
The [proposed S3 semantic-action design](work-items/P4.3-semantic-action-design.md)
has three actual independent final design approvals and a separate
[design-preparation decision](reviews/p4.3-s3-design-decision-2026-10-04.md).
It supplies no S3 implementation entry: original positive S2 first/repeat proof,
independent artifact reviews and S2 runtime acceptance still come first.
P4.4's frozen language-decision method is planned in
[the native language decision work item](work-items/P4.4-native-language-decision.md)
and proposed [ADR 0018](adr/0018-native-runtime-language-decision-method.md).
P4.5's authenticated local host is planned in
[the native host work item](work-items/P4.5-authenticated-native-host.md) and
proposed [ADR 0019](adr/0019-authenticated-local-native-host.md). P4.6 macOS
parity is planned in
[the macOS Accessibility work item](work-items/P4.6-macos-accessibility-adapter.md).
P4.7 consolidates real-host parity, security, performance, packaging, operations,
and independent reviews in the
[Phase 4 Exit Audit work item](work-items/P4.7-phase4-exit-audit.md); exit approval
and any `0.4` release remain explicit later maintainer decisions.

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
