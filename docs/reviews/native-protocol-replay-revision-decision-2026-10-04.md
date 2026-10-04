# Native protocol historical replay revision checkpoint decision

Date: 2026-10-04, Asia/Bangkok.
Decision owner: `/root`, under the actual
[maintainer delegation](phase4-agent-review-authorization-2026-10-03.md).
Disposition: accept only this narrow P4.1 corrective-maintenance checkpoint
for the delegated scoped commit/push. This is not a personal human source
review, whole-project acceptance, native execution permission or S3 entry.

## Exact target and independent evidence

Base: `b7d32f1a6269c39f559f2761b2d8fdd4a524bf99`, on
`codex/p4.3-windows-uia`. The runtime correction is five inserted lines in the
public transcript verifier; seven regression instances add 117 test lines
without removing the 15 existing cases or their assertions.

| Bound target | Whole Git blob |
| --- | --- |
| [Session verifier](../../src/native-protocol/session.ts) | `4bb9d10c61b48cfe7d65a3451ab8da43e67d9d04` |
| [Session regression tests](../../test/native-protocol-session.test.ts) | `1b49cf465c90afc726e055e8e277df64e04b1c1d` |
| [Maintenance brief](../work-items/native-protocol-replay-revision-remediation.md) | `0acaadaf4a29012340506ddc125ee1119a3c4d41` |
| [Development evidence packet](../evidence/native-protocol-replay-revision-development-2026-10-04.md) | `df94797f0ed7a7409ef781bcbc473da994685d4f` |
| [Independent security source review](native-protocol-replay-revision-security-review-2026-10-04.md), `/root/p42_security_review` | `dbeca651dc80381bd08800f1b5ad45779ccfbf70` |
| [Independent protocol/package source review](native-protocol-replay-revision-package-review-2026-10-04.md), `/root/p42_package_gate_review` | `bad7dba660196a7c3c0e1042e08887fb6ec9cb3e` |

The packet is 9,205 LF-normalized UTF-8 bytes,
`sha256:7734d4b837d5735b92f873070d1734e49a714c0336de30e6016a82c03a01029e`.
Root completely read the source diff, brief, packet and actual reports and
independently verified their bindings. Neither reviewer authored this correction.
There are no unresolved Critical/High/Medium source findings in their scope.

The immutable source-review reports preserve their real earlier cutoffs with
comprehensive gates still pending. Later checkpoint recommendations came in
actual separate read-only agent messages, not retroactive report replacement:

- Security's final packet audit at 2026-10-04 12:08:29 UTC completely read the
  packet and package report, independently matched all target/report pins, and
  recommended only this narrow corrective checkpoint with the limitations below.
- The package reviewer's final packet audit, received by root at 12:12 UTC,
  independently matched the same packet/source/test/plan/report pins. Read-only
  commands `acba0c` and `b333fa` found no protected-path drift, diff errors or
  missing local links. It found no integrity blocker and recommended only this
  narrow checkpoint, not whole-goal acceptance.

Both final audits retained the failed supplemental batch and the SDLC ordering
limitation. Reviewers did not execute the root-produced gates, write new reports
at that final audit, or inspect native/OS/Temp/environment data. This record
captures their actual messages; it does not invent another reviewer or gate run.

Those messages addressed original packet
`94e7aa7bf65d93387c1c354d7889f14e596d734e` and package report
`15caaa82a5a11264f4dd64033a66e724c67dc550`. The pre-commit staged diff check
then failed solely on an extra terminal blank in that report; no commit followed.
The actual report owner removed exactly one LF and reproduced the old hash by
restoring it. The bound packet/report are updated for that formatting-only
correction with source, tests, judgments and executable results unchanged.
Delivery remains conditional on actual independent read-only revalidation of
these updated document bindings and successful staged diff checks. Earlier
audits are not retroactively claimed to have inspected these later bytes.

## Acceptance reasoning and criteria

The existing frozen P4.1 specification already forbids revision rollback.
Completed keyed replay is historical disclosure, not a new state transition.
The correction requires current surface revision to equal the cached terminal
outcome revision before a completed replay can write state. Otherwise the
existing `resync_required` failure closes and clears the verifier. Ordinary
in-flight race checking, exact request/response fingerprints, constants, wire
grammar and host responsibilities remain unchanged.

| Brief criterion | Accepted evidence |
| --- | --- |
| RP-01 | Old source reproduces rollback; new event-before-replay case fails red then passes with terminal cleared-state proof |
| RP-02 | Separate completed-action and catalog-refresh regressions refuse historical rollback |
| RP-03 | Existing immediate exact success replay remains; current failed-outcome replay and subsequent current-revision request pass |
| RP-04 | Advance while replay is pending and closed surface are refused; unchanged request/response conflict cases remain |
| RP-05 | Independent source reviews plus protected comparison, frozen exports/schemas/corpora and package checks show no contract/native-source drift |
| RP-06 | Exact final source/test bytes pass the pre-existing canonical commands; both failure history and scope limits are retained |

The packet records actual red failures on unmodified source, focused 22/22 green,
and the fresh built counterexample refusing replay with a terminally cleared
session. Fresh canonical checks are 66 top-level files/1,823 tests, typecheck,
core/Angular build and frozen contract, both native-protocol package/corpus
checks, package-exclusion check, 12 deterministic conformance cases, 24 nested
adversarial cases, 114 managed-browser cases and audit with zero vulnerabilities.
Their actual commands, terminal exits and producer identities are in the packet.
The P4.2 review validator also passes its existing accepted historical record;
that is not a fresh acceptance of this changed source.

## Explicit limitations and maintenance judgment

Root's supplemental shared-process Vitest batch remains **exit 1**, with 12
failures in three CLI files out of 1,862 tests. Those unchanged files all pass
in the existing canonical fresh-process runner. That runner and required
commands predate this fix; no assertion, selector or runner was weakened after
the failure. The observed batch/per-file difference does not establish its
underlying cause or prove the failures harmless. No all-recursive-test pass or
complete Phase 3 re-audit is claimed. This decision accepts the narrow correction
against the existing mandatory command contract while retaining that unresolved
supplemental limitation, not converting the failed batch into success.

The standalone RP-01..RP-06 criteria were formalized after initial reproduction,
tests and correction. This is a real SDLC ordering limitation, not advance
approval or a retroactive ready/design-gate waiver. Both independent reviewers
considered it explicitly. The accepted no-rollback specification predates the
change, the new brief introduces no runtime contract, and the remaining exact
source/evidence/checkpoint reviews are now complete. The maintenance acceptance
is bounded to enforcing that existing rule; later work still requires its
normal ready/design/entry sequence before implementation.

Request-error compatibility is static review, not a newly executed vector.
No dedicated full-snapshot-advance regression is claimed. Fixed corpora remain
unchanged and do not contain the new sequence. Managed browsers are not native
Chrome WebMCP, Windows UIA or macOS proof. A pure transcript verifier is not an
executor, OS authenticator or key-wide durable idempotency store.

## Scoped delivery and withheld authority

Commit exactly the two source/test paths and the maintenance brief, development
packet, two actual source-review reports and this decision. Keep the separately
reviewed S3 design/decision/reports and roadmap in their own documentation commit.
Push only the existing P4.3 branch; do not merge main, publish, release or deploy.
No dependency/lock/schema/corpus/native harness/golden/historical freeze is edited.

The [D2 negative checkpoint](../evidence/p4.3-native-suite-d2-development-2026-10-04.md)
and unanswered human host-context question remain intact. This correction and
the [separate S3 design decision](p4.3-s3-design-decision-2026-10-04.md) cannot
replace S2's original positive 22-scenario/32-capture first/repeat evidence,
independent original-artifact review and separate runtime acceptance. No native
retry, guard/desktop/security change, S3 implementation entry, S4 acceptance,
P4.3/P4.4/Phase 4 closure or premature Rust selection is authorized. The whole
completion goal remains active and incomplete.
