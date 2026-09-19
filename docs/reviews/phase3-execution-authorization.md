# Phase 3 Execution Authorization

Status: Accepted

Decision date: 2026-09-19

Decision owner: Repository maintainer

## Decision

The repository maintainer authorized continued execution of every remaining
Phase 3 work item through preparation of the Phase 3 Exit Gate. Work must still
follow the accepted AI-SDLC: design and acceptance criteria precede runtime
changes, each work item is reviewed and committed in scoped increments, and no
security, compatibility, package, browser, evaluation, or evidence gate may be
silently skipped.

This authorization covers:

1. P3.2 Playwright fallback adapter;
2. P3.3 incremental/delta snapshots;
3. P3.4 redacted traces and deterministic replay;
4. P3.5 CLI orchestration;
5. P3.6 cross-exporter conformance;
6. P3.7 prompt-injection and confused-deputy adversarial coverage;
7. P3.8 multi-model evaluation and `cli evaluate`;
8. P3.9 performance/token benchmarks; and
9. P3.10 Phase 3 Exit Audit and review preparation.

The dependency order may be refined by an accepted work-item or ADR, but scope
cannot be dropped or renamed experimental to pass the exit gate.

## Boundaries

- Phase 4 implementation is not authorized by this decision.
- Preparing the Phase 3 Exit Review is authorized; recording Phase 3 approval
  and starting P4.1 still requires an explicit maintainer decision.
- Publication, release tags, production deployment, provider spending, and
  access to production credentials or user data are not authorized.
- Browser/model/provider work must use isolated synthetic fixtures and the
  documented safety and cost limits.

## Required completion evidence

- every P3.1–P3.9 acceptance criterion is traceable to implementation and
  evidence;
- deterministic, browser, replay, conformance, adversarial, evaluation, and
  benchmark gates meet their accepted thresholds;
- the frozen Phase 1 root contract remains unchanged unless an explicit
  migration is separately approved;
- clean install, typecheck, build, audit, package inspection, and isolated
  consumer checks pass;
- independent security and compatibility review has no unresolved
  critical/high finding; and
- P3.10 presents limitations and non-claims honestly for maintainer approval.
