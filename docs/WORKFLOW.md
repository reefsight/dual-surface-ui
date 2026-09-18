# Contribution, Commit, and Release Workflow

Status: Accepted at Gate 0 on 2026-09-18

## Planning

One issue represents one observable behavior or contract change. It links its
phase, acceptance criteria, security impact, test/eval plan, and affected paths.
Later-phase work is rejected unless the current phase gate has passed.

## Branch and commit discipline

- Use a short-lived branch per approved work item.
- Preserve unrelated worktree changes.
- Stage an explicit path allowlist.
- Keep behavior, refactor, generated output, and release metadata separable
  unless atomicity requires them together.
- Commit messages use `type(scope): outcome`.
- Do not push, publish, deploy, or tag without explicit authorization.

## Required review bundle

- goal and acceptance criteria;
- traceability matrix;
- architecture/ADR links;
- scoped diff and package API diff;
- deterministic test evidence;
- agent eval evidence or reason it is not applicable;
- security/adversarial evidence;
- compatibility and migration notes;
- package dry-run contents;
- known limitations and rollback.

## Public API review

Public exports, serialized fields, action semantics, error codes, and default
policy are compatibility surface. Reviewers must check naming, provider/model
neutrality, extensibility, privacy, versioning, and migration cost.

## Dependency policy

Core remains dependency-light. Adding a runtime dependency requires evidence
that platform APIs or a small internal implementation are insufficient, plus
license, maintenance, security, size, and browser compatibility review.

## Release flow

1. Clean checkout of approved commit.
2. Install from lockfile.
3. Build and run full deterministic suite.
4. Run required frozen agent/security evals.
5. Generate schemas/docs/artifacts reproducibly.
6. Inspect `npm pack --dry-run` or equivalent.
7. Verify version, changelog, migration, license, and provenance.
8. Tag immutable source commit.
9. Publish once; do not rebuild between verification and publish.
10. Verify registry artifact and run consumer smoke test.

## Documentation change rules

- Correcting wording without semantic impact needs ordinary review.
- Changing goals, phase gates, risk behavior, contract semantics, or native
  language strategy requires an ADR or a superseding plan decision.
- Completed evidence is append-only; corrections preserve the original record.

## Stop conditions

Work stops when there is a scope conflict, undocumented public break, secret in
an artifact, authorization ambiguity, flaky safety test, unreviewed generated
diff, missing native/browser evidence, or a phase-gate violation.
