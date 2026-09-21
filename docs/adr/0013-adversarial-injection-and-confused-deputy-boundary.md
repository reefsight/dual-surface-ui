# ADR 0013: P3.7 Uses a Frozen Adversarial Corpus and Deterministic Controls

Status: Accepted for P3.7 implementation on 2026-09-21

Date: 2026-09-21

## Context

P3.6 proves semantic parity for reviewed inputs, but normal conformance cases
do not model hostile content that attempts to become policy, authority, or
execution configuration. P3.7 must test the trust boundaries already accepted
in `docs/SECURITY.md` without using a live hostile site, a real credential, or
a model as the oracle.

## Decision

P3.7 is private additive security-test infrastructure. It adds no runtime
export, package subpath, schema, CLI command, or policy fallback. A reviewed
corpus under `fixtures/adversarial/` is frozen and digest-bound before any
case executes. Each case has a stable ID, threat class, attacker-controlled
field, deterministic seed, expected control, expected outcome, authoritative
state assertion, severity, and disposition. Fixture text is data only; no
fixture field is evaluated as JavaScript or policy.

The initial corpus contains these exact threat families:

| Family | Cases | Control under test |
|---|---|---|
| page injection | `PAGE-001` through `PAGE-003` | names, descriptions, and page text never declare or authorize actions |
| confirmation/policy forgery | `AUTH-001` through `AUTH-003` | only trusted callbacks decide policy and confirmation |
| tool and protocol injection | `TOOL-001` through `TOOL-003` | output and MCP metadata remain data and cannot alter bindings |
| scope confusion | `SCOPE-001` through `SCOPE-005` | principal, origin, surface, revision, and action are bound |
| target/replay confusion | `TARGET-001`, `REPLAY-001` | replacement/ABA is stale and idempotency is scoped |
| visual fallback | `VISUAL-001`, `VISUAL-002` | only current allowlisted semantic IDs are selectable; coordinates/sensitive nodes are rejected |
| artifact injection | `ARTIFACT-001` through `ARTIFACT-003` | trace, CLI, model-context, stdout, and stderr are redacted data channels |

Generated variants are deterministic (`seed` is recorded in each case), and
each critical case repeats at least three times. A result preserves case ID,
severity, control, outcome, and first-failure disposition. There is no retry
that can replace a failed first observation.

The harness reuses P3.6's canonical capture, detached inputs, authoritative
state boundary, and 13-channel secret scanner. Adversarial results are a
separate report with only redacted bounded fields: no raw attacker text,
selector, prompt, exception, secret sentinel, absolute path, hostname,
timestamp, or random ID is emitted. A release gate fails on any unauthorized
mutation, missing control, critical/high finding, unexpected secret egress,
corpus/digest mismatch, or environment failure.

## Rejected alternatives

- Prompt-only filtering: rejected because authorization and scope controls must
  remain deterministic when content is hostile.
- Live third-party pages or accounts: rejected because the suite must be
  reproducible and cannot expand user authority.
- Model-generated expected results: rejected because expected controls remain
  reviewed trusted test data.
- Severity downgrades or automatic retries: rejected because they hide the
  first safety failure.

## Evidence and exit conditions

The implementation must add strict corpus/report schemas, a corpus digest and
threat-to-control matrix, deterministic variant generation, executable cases,
artifact-wide leak scanning, and a redacted machine-readable report. P3.7 is
complete only after an independent security review records zero unresolved
critical/high findings and the existing Phase 1, Phase 2, Phase 3 package,
contract, audit, and diff gates pass.
