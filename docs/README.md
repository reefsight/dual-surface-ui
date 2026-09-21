# Documentation Index

This directory is the source of truth for product and engineering decisions.
When code and documentation disagree, work stops until the discrepancy is
resolved. A behavior change requires an acceptance criterion and test update;
an architectural change requires an ADR.

## Reading order

1. `01-vision-goals.md` — why the project exists and how success is measured.
2. `02-product-scope.md` — target users, positioning, scope, and non-goals.
3. `03-architecture.md` — contracts, components, data flow, and package layout.
4. `04-roadmap.md` — mandatory Phase 1–4 delivery sequence and exit gates.
5. `SECURITY.md` — trust boundaries, risks, authorization, and redaction.
6. `TESTING_AND_EVALS.md` — deterministic tests and probabilistic agent evals.
7. `AI_SDLC.md` — how humans and AI change the system safely.
8. `NATIVE_STRATEGY.md` — Windows/macOS plan and language decision gates.
9. `WORKFLOW.md` — issue, commit, review, release, and compatibility workflow.

Active work-item records live under `work-items/` and carry the traceability and
evidence required by `AI_SDLC.md`.

Phase 3 has started. P3.1 is implemented and verified under the accepted
design in
[P3.1 MCP exporter](work-items/P3.1-mcp-exporter.md) and
[ADR 0007](adr/0007-mcp-exporter-boundary.md). The maintainer authorized all
remaining Phase 3 work through Exit Gate preparation in the
[Phase 3 Execution Authorization](reviews/phase3-execution-authorization.md).
P3.2 implementation is governed by the accepted
[Playwright fallback work item](work-items/P3.2-playwright-fallback.md) and
[ADR 0008](adr/0008-playwright-fallback-boundary.md).
P3.3 implementation is governed by the accepted
[incremental snapshot work item](work-items/P3.3-incremental-delta-snapshots.md)
and [ADR 0009](adr/0009-incremental-delta-contract.md).
P3.1 through P3.6 are implemented and verified. P3.6's private conformance
harness is governed by [ADR 0012](adr/0012-cross-exporter-conformance-boundary.md)
and its release evidence is recorded in
[the dated aggregate report](evidence/p3.6-conformance-report-2026-09-21.json).
The remaining authorized work is tracked in dependency order:

1. [P3.6 cross-exporter conformance](work-items/P3.6-cross-exporter-conformance.md)
2. [P3.7 adversarial suite](work-items/P3.7-adversarial-suite.md)
3. [P3.8 multi-model evaluation](work-items/P3.8-multi-model-evaluation.md)
4. [P3.9 benchmarks and native feasibility](work-items/P3.9-benchmarks-native-feasibility.md)
5. [P3.10 Phase 3 Exit Audit](work-items/P3.10-phase3-exit-audit.md)

P3.6 is verified; later records define acceptance and evidence gates and do not
claim completion until their own gates pass.
P3.7 implementation is governed by the accepted
[adversarial-suite ADR](adr/0013-adversarial-injection-and-confused-deputy-boundary.md).
Execution evidence is tracked in
[the P3.7 report](evidence/p3.7-adversarial-report-2026-09-21.json); an
independent security review and maintainer approval remain required before the
Phase 3 exit gate can close.
P3.8's deterministic golden-task suite is frozen in
[the P3.8 evidence record](evidence/p3.8-golden-task-suite-2026-09-21.json);
actual provider model runs remain unauthorized.
P3.9's comparable benchmark method is frozen in
[ADR 0014](adr/0014-benchmark-and-native-feasibility-method.md), with
source-bound structural samples in
[the P3.9 report](evidence/p3.9-structural-benchmark-2026-09-21.json) and a
bounded [native-feasibility review](reviews/p3.9-native-feasibility.md).
Actual model/token thresholds remain pending.
Phase 4 remains gated.

Phase exit decisions and their combined evidence live under `reviews/`. Phase
1 and Phase 2 are accepted; the Phase 2 decision is the
[Phase 2 Exit Review](reviews/phase2-exit-review.md), supported by the
[dated native WebMCP evidence](evidence/phase2-native-webmcp-2026-09-19.md).

Experimental architecture decisions remain non-binding until accepted. The
current TOON evaluation is recorded in
[ADR 0006](adr/0006-toon-optional-projection.md).

## Document ownership

| Document | Must approve changes |
|---|---|
| Vision, scope, roadmap | Product maintainer |
| Architecture and ADRs | Technical maintainer |
| Security model | Security owner plus technical maintainer |
| Schemas and compatibility | Technical maintainer |
| Release process | Release owner |

## Status vocabulary

- Planned: authorized scope has a work-item contract but implementation and
  evidence are not yet claimed.
- Draft: incomplete and not binding.
- Proposed: complete enough for review.
- Accepted: binding for implementation.
- Superseded: replaced by a linked newer decision.
- Experimental: may be deleted and carries no compatibility promise.

The Gate 0 baseline was accepted on 2026-09-18. Later semantic changes follow
the ownership and ADR rules above.
