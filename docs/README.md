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
[ADR 0007](adr/0007-mcp-exporter-boundary.md). P3.2 remains gated pending
maintainer authorization.

Phase exit decisions and their combined evidence live under `reviews/`. Phase
1 and Phase 2 are accepted; the current decision is the
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

- Draft: incomplete and not binding.
- Proposed: complete enough for review.
- Accepted: binding for implementation.
- Superseded: replaced by a linked newer decision.
- Experimental: may be deleted and carries no compatibility promise.

The Gate 0 baseline was accepted on 2026-09-18. Later semantic changes follow
the ownership and ADR rules above.
