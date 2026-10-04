# Native protocol historical replay revision remediation

Status: In development, pending independent source review and fresh gates.
Date: 2026-10-04, Asia/Bangkok.
Author: `/root`, under the existing [maintainer delegation](../reviews/phase4-agent-review-authorization-2026-10-03.md).

Phase/package: corrective maintenance of accepted P4.1,
`dual-surface-ui/native-protocol`, not P4.3 S3 implementation.
Required approver: maintainer `Pitchayut586`, with actual separate agent reviews
and evidence-based scoped decisions under that dated delegation; no personal
human source review is claimed.

## Separate scope and cause

The initial [S3 security design review](../reviews/p4.3-semantic-action-design-security-review-2026-10-04.md)
identified an existing exported transcript-verifier defect. This remediation
is separate from the proposed S3 design and its still-withheld implementation
entry. It does not authorize native execution, change a guard, or supply S2
capture evidence.

On base `b7d32f1a6269c39f559f2761b2d8fdd4a524bf99`, an action completes R1 to R2,
then a valid surface event advances to R3 before an identical keyed replay.
Replay admission skips the ordinary stale request revision check and records
the current R3 as its pending revision. The exact cached R2 response consequently
passes the ordinary request-time race check and overwrites the surface map.
A new request at old R2 is then accepted. This violates the existing
[protocol no-rollback requirement](../protocol/native-protocol-0.1.md).

Root reproduced the compiled path with a bounded synthetic Node transcript
(command `106864`, exit 0, old-revision request unexpectedly accepted). Root
then added two negative regression cases against actual unmodified TypeScript
source: event advance before replay and another completed action before replay.
Vitest command `5f7e0d`, session 42997, completion `a50b8a`, exit 1: both new
cases failed because the expected session error was not thrown; all 15 existing
cases passed. These are pure transcript results, not native effects.

## Chosen correction and unchanged contracts

At action-response admission, an exact completed-request replay requires the
current known surface revision to equal its stored terminal outcome revision.
Otherwise fail closed with the existing constant `resync_required` and clear
the session through its existing failure path. Do not update the surface map,
manufacture a newer cached result, change response fingerprints or silently
accept the old revision as a new action transition.

Ordinary in-flight response race rules remain unchanged. Identical immediate
replay at the current terminal revision still passes. The fence applies to
both succeeded and failed action outcomes; a missing/closed surface cannot be
resurrected. No field, public error, export, schema, version, generator, fixed
session corpus, native harness, golden or historical review/freeze is changed.
The verifier is still neither an executor nor an authenticator; native hosts
must independently enforce current authority and disclosure policy.

## Acceptance and traceability

All inputs/evidence are bounded synthetic protocol fixtures. The changed trust
boundary is authoritative transcript state after replay; no provider text,
native identity, classified user data, secret or model is admitted. Error text
remains the existing constant. Model evaluation is N/A because this correction
changes neither discovery, prompts nor action selection.

| Criterion | Required behavior | Source/test and evidence boundary |
| --- | --- | --- |
| RP-01 | A newer event before historical replay cannot be overwritten | Replay-only action-response fence; event-before-replay negative and full cleared-state assertion |
| RP-02 | A newer completed action/catalog before replay cannot be overwritten | Two distinct negative transcripts; no snapshot-refresh coverage claim |
| RP-03 | Current-terminal exact success/failed replay remains compatible | Existing exact-success case plus new immediate failed-outcome case; subsequent current-revision request accepted |
| RP-04 | Advance during replay and closed surface fail terminally; changed fingerprints still conflict | New pending-event/closure cases and unchanged request/response conflict cases |
| RP-05 | Existing schema, exports, constants, bounds, corpora and native source remain unchanged | Protected diff, contract/corpus/package checks and actual independent source review |
| RP-06 | Scoped delivery is supported by fresh canonical gates and honest limitations | Separate development evidence packet; retain red regressions and any supplemental runner failure, never report an unpassed batch as green |

These stable criteria clarify the standalone maintenance brief after the
initial root reproducer, regression additions and correction. Their later
documentation is not backdated as pre-implementation approval. The existing
accepted P4.1 contract supplied the no-rollback requirement; the separate final
source/checkpoint review must explicitly consider this ordering limitation.

Rollback/disable strategy: withhold acceptance or delivery if the correction
introduces an unresolved regression; do not weaken the guard, cached fingerprint
or tests to obtain a pass. Any later scoped revert requires an explicit separate
decision and must retain this known unsafe historical-replay limitation. No
rollback, feature flag, publishing, release or native permission is exercised
by this brief.

## Verification and review gate

Required fresh checks: focused native protocol tests; full existing JavaScript
suite; typecheck/build; contract checks; native protocol/session corpus checks;
package exclusion checks; browser/conformance regression gates; audit and
scoped diff/protected-file comparison. Record actual counts and failure history
in a separate development evidence packet after completion, not as predictions.

Negative vectors include advance before replay by event, another action and
catalog refresh, advance while replay is pending, failed-outcome replay, and
surface closure. Preserve immediate exact replay and changed-fingerprint
refusal coverage. Assert terminal closure, not merely an exception message.

Actual independent security and protocol/package reviewers must inspect final
source/test blobs, the existing frozen spec, red/green evidence and fresh gates.
Resolve and re-review findings before a separate scoped commit/push. Historical
approvals remain bound to their original source; new pure evidence cannot close
S2/S3/S4, P4.3, P4.4 or the full Phase 4 goal.
