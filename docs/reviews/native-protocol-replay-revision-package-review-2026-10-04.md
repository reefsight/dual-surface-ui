# Native protocol replay revision remediation - independent package review

Reviewer: `/root/p42_package_gate_review`, independent protocol/package reviewer.
Source/test/plan author: coordinating agent `/root`; this reviewer authored none.
Actual source-review cutoff: 2026-10-04 11:42:34 UTC / 2026-10-04 18:42:34 UTC+07:00.
Disposition: **source-approved within the narrow pure transcript-verifier correction**.
Unresolved findings: Critical 0, High 0, Medium 0, Low 0.
Fresh comprehensive gate completion and a separate scoped checkpoint decision
are required; this is not an execution authorization, native result, S3 entry,
P4.3 acceptance or inherited personal human approval.

## Exact independent source and plan bindings

Base HEAD: `b7d32f1a6269c39f559f2761b2d8fdd4a524bf99`.

| Completely read target | Git whole-blob | Normalized-LF UTF-8 bytes and SHA-256 |
| --- | --- | --- |
| [session.ts](../../src/native-protocol/session.ts) | `4bb9d10c61b48cfe7d65a3451ab8da43e67d9d04` | 12,982; `sha256:84a645951c789ea7b5308e72a66982f36a837ac64857603aba68e8804499915b` |
| [session tests](../../test/native-protocol-session.test.ts) | `1b49cf465c90afc726e055e8e277df64e04b1c1d` | 16,490; `sha256:7516c7f079df24c4ae2e9b9a924053b4459644f9385b8d7746f1c044ed01dbad` |
| [remediation plan](../work-items/native-protocol-replay-revision-remediation.md) | `5ba836b0b9b9ca37ffd8514db9cdb7e35a852316` | 3,864; `sha256:8745c1b5204dab1fcc336ed24cd3baef7a5f9ded10954a974f5acc694ef65965` |

The two-file source/test aggregate is
`sha256:451b073fb3b465531ed7e3999ac083230d689683dc771a51f95255907b419b7c`.
Method: strict BOM-free UTF-8, normalize CRLF to LF, SHA-256 each file, then hash
compact JSON of ordinal path-ordered objects containing path and digest
with the literal sha256: prefix. The table's plan is separately bound, not a
third file silently included in that source/test aggregate.

Actual complete source/test reads were 4e8667 and d9aede exit0; full diff 401c8e
exit0; whole-blobs 6d9d7f/e114de exit0; normalized byte/aggregate computation
c00b36 exit0; protected comparison e18e93 exit0 with no paths; scoped diff check
df7f6d exit0. Ordinary LF/CRLF warnings were not test/native failures.
Numstat confirms five inserted source lines and 117 inserted test lines.
No source/test/dependency edits were made by this reviewer.

## Defect and independent reasoning about the correction

The initial S3 review identified that historical response replay could defeat
the intended no-rollback rule: A completes r1 -> r2, an event/another completed
action/catalog refresh advances to r3, then exact completed A request and its
cached r2 response are repeated. The old verifier exempts completed requests
from ordinary stale-request checking and records r3 as the replay's pending
surface revision; the ordinary race comparison therefore accepts the r2
response and assigns r2 to current state. This static reasoning is preserved
in [the initial design report](p4.3-semantic-action-design-package-review-2026-10-04.md).

The five-line correction in session.ts:305-310 requires
currentRevision === message.outcome.revision when a pending replay response
fingerprint exists. It runs after existing request/response fingerprint and
surface correlation checks but before any surface-map mutation. A historical
action outcome is not a new transition. The fence correctly applies to both
succeeded and failed action outcomes; no status-specific exclusion bypasses it.

The ordinary pending-action rule is unchanged: for a first response, current
may equal request-time revision or already equal outcome revision, while any
third revision fails closed. Successful previousRevision must still equal the
original request revision. Snapshot/delta race rules, catalog refresh rules,
event continuity, schema admission, capability negotiation and exact canonical
fingerprints are unchanged.

Current terminal equality still admits immediate exact action replay; a later
surface revision, absent surface or closing event fails with existing
resync_required. Existing #fail closes and clears the session, references,
pending/completed maps, capability set and event state before throwing. The
guard adds no extra collection or unbounded work and cannot allocate an
attacker-declared structure.

A changed request remains request_conflict at admission. A changed cached
response remains request_conflict before the new revision guard; the correction
does not refresh a response to a new revision or weaken exact fingerprint
matching. Different requestId is not the completed-request exemption and still
uses ordinary stale-revision admission. Key-wide deduplication, current OS
authority and historical disclosure policy remain host responsibilities, not
new properties claimed for this exported transcript verifier.

### Request-error replay compatibility

Request-error is still correlated to an admitted pending requestId/session and
validated against its exact package-owned constant message. Exact replay
fingerprint checks occur in #acceptResponse before #applyResponse. The latter's
existing request-error branch returns immediately, never reads or writes a
surface revision. Consequently identical historical request-error replay does
not roll back or resurrect surface state; a changed error response remains
request_conflict. Loss of the surface before request admission still follows
surface_unavailable; cross-session/closed-session attempts fail as before.

The new fence intentionally does not invent an outcome revision for a
request-error, change its wire grammar, or convert a closed verifier exception
into an admitted wire response. This is independently inspected static
compatibility reasoning; no new request-error replay test was executed or
claimed by this reviewer. Future native hosts still require their own
permission/policy/disclosure fences before replaying even a fixed error.

## Regression source and producer-run evidence

Completely read all final test cases. The additions cover:

- revision advance before replay through an event, another completed action and
  an actual catalog refresh, not a mislabeled snapshot refresh;
- failed-action-outcome immediate replay and advanced-revision refusal;
- a third revision while exact replay is pending;
- surface closure before replayed response.

Negative assertions require the expected NativeProtocolSessionError category
and terminal closure, with full cleared-state checks in the event case.
The original immediate exact-success replay and changed request/response
fingerprint cases remain. The existing ordinary in-flight matching-event
acceptance and third-revision refusal tests remain unchanged. The failed
immediate replay case also admits a subsequent current-revision request;
it does not claim the verifier performs host idempotency enforcement or any
business/native effect.

Root supplied the following actual pure evidence, not independently executed
here: compiled repro command106864 exit0 unexpectedly admitted old revision;
red command5f7e0d/session42997/completiona50b8a exit1 with two new negatives
failing and 15 existing cases passing; fixed focused command4cfd23 exit0
22/22. Root subsequently changed only the catalog-refresh test description;
this reviewer inspected final test bytes, not a claimed rerun of that prose
rename. These are TypeScript synthetic transcript cases, not Windows UIA,
fixture capture/action or S2 runtime evidence.

At this report's cutoff the parent reported the full fresh pipeline running,
not terminal. No full/type/build/browser/conformance/package/audit success is
predicted or borrowed from the prior D2 checkpoint. Actual later root results
must be separately dated/source-attributed; they cannot retroactively become
this reviewer's own executed checks.

## Contract, package, authority and history boundaries

The [frozen native protocol](../protocol/native-protocol-0.1.md) requires
outcome revision to agree with trusted state and late responses not to roll back
newer state. The source correction enforces that existing rule rather than
adding a schema field/error/version. It does change observable behavior of the
exported verifier for the formerly accepted invalid historical transcript; it
is not a claim that public implementation behavior is wholly unchanged.

Protected read-only comparison against b7d32f1 showed no changes in package/
lock, native types/index/schema/execution/parser/data contracts, core types/
errors/schemas, fixtures/corpora, generator/scripts, experiments/native fixture,
Git ignore or protocol specification. No public export or dependency was added,
no accepted fixture/golden/corpus or fixed old review/entry/freeze was rebound,
and active/completed limits remain 128/4096. The current npm allowlist remains
dist/schemas/fixtures-native-protocol/README/LICENSE; this is a source/config
boundary check, not independent npm packing or rebuilt-dist proof.

The source author is root under existing unchanged-goal delegation; actual
independent review comes from this named reviewer, not a synthetic human owner
or the implementer's assertion. Prior approvals remain historical and exact-
source-bound. Source review here is separate from the final S3 design-only
disposition at deb5561e1ceaa94e217645f5f6f07f0b429ec6df. Neither permits S3
implementation before positive S2 serial artifacts, genuine original-artifact
reviews, separate accepted S2 runtime and independently accepted S3 entry.

No build/test/native/SDK/user-app/OS/session/Temp/environment/model execution,
network/API lookup, Git mutation or other-file write was performed. Only this
new report and the allowed addendum to this reviewer's S3 design report were
written. Source-approved means no unresolved Critical/High/Medium/Low was found
within this narrow source/test/package/protocol review, not a fresh gate,
release, artifact or native/runtime acceptance.

## Dated gate-boundary and later maintenance-brief assessment

Actual assessment cutoff: 2026-10-04 11:50:23 UTC / 18:50:23 UTC+07:00.
This addendum changes neither the reviewed session/test bytes nor their earlier
source-only disposition. It records new real failure evidence and a later
documentation supplement, not a fresh executed gate or predicted acceptance.

### Existing canonical gate, not a newly narrowed replacement

Completely read [AI_SDLC](../AI_SDLC.md) (whole-blob
`77e5e4bd9e9ec602a2f6c3eec0c696b9eb1daff4`), the current
[file-per-process runner](../../scripts/run-phase1-gate-tests.mjs) (whole-blob
`980d6b8c59ccf67ebe3f25e9c1cf0b56569209dc`), the accepted P3.10 audit work item
and [frozen Phase3 command runner](../../scripts/run-phase3-exit-audit.mjs)
(whole-blob `fc093371ccd5be93bd99869828fe0758fb1b803d`).
The audit plan explicitly invokes npm run test:gate, npm run test:conformance,
and managed browser workers=1. The accepted S1 final-source record also
identifies those exact distinct commands; this is pre-existing practice.

A read-only comparison against b7d32f1 returned no differences in the two runners
or package.json. The gate enumerates all current top-level .test.ts files
(66), sorts them, and executes each in a new Node/Vitest process using
vmThreads/maxWorkers1/no-file-parallelism/isolate=false. It refuses nonzero
exit, signal, unhandled errors, missing one-file success summary or missing
passed-test count. It does not exclude the affected three CLI files or rewrite
their assertions. Current repo inventory independently confirms all three are
top-level included files:
cli-driver-host.test.ts, cli-node-io.test.ts and cli-node-io-recheck.test.ts.
Their source comparison against the base was empty.

This canonical gate, together with separate required deterministic conformance,
managed browser and the remaining focused/type/build/contract/corpus/package/
audit/diff prerequisites, is the existing required narrow maintenance
checkpoint. Running it is not creation of a narrower passing selector in
response to failure. That statement does not mean the supplemental batch
passed or that this runner covers every recursively discovered test file.

The runner excludes nested files by construction. Actual repo inventory has
four nested files: adversarial/adversarial-suite.test.ts,
conformance/aggregate.test.ts, conformance/foundation.test.ts and
conformance/source-evidence.test.ts. The required deterministic conformance
command separately covers foundation and cross-exporter; the complete Phase3
audit additionally has explicit adversarial/evaluation/golden/benchmark gates.
Those distinct scopes must stay labeled. This maintenance assessment is not
a rerun or acceptance of that complete Phase3 audit, a native-Chrome aggregate
pass, or a waiver of additional affected mandatory checks. Do not call the
66-file canonical result every recursively discovered file or promote it to
whole-goal success.

AI_SDLC:51-57 requires checks appropriate to the change and commands/results/
known gaps; a failure is evidence, not permission to weaken assertions. Nothing
in that document specifies the supplemental shared-process Vitest invocation
as the sole required gate. Using the unmodified canonical commands preserves
the established requirement while the following failure remains visible.

### Supplemental batch failure and unknown cause retained

Root reports supplemental
npm test -- --pool=vmThreads --maxWorkers=1 --no-file-parallelism,
command c16b49/session93465/completiond03e39, terminal exit1:
68 files/1862 tests, three failed files/12 failures and65 passed files/1850 passes.

| Root-reported failed batch file | Actual reported failure count | Inclusion in existing canonical gate |
| --- | --- | --- |
| test/cli-driver-host.test.ts | 5 of16 failed | Included unchanged |
| test/cli-node-io.test.ts | 6 of14 failed | Included unchanged |
| test/cli-node-io-recheck.test.ts | 1 of1 failed | Included unchanged |

The reported boundaries were safe-chain/assertSafeChain and Node I/O rather
than the added session revision guard. The unchanged CLI-driver file separately
passed16/16 with isolate=false (27798e/72939/ec78da exit0) and default isolation
(816ed7/59532/fa2195 exit0). Root reports that the ongoing canonical run12248
passed the three exact included files16/16,1/1,14/14 in its file7/11/12 outputs
e106b0. These are producer-run observations, not executions by this reviewer.

There is observed batch-versus-per-file behavior, but the underlying interaction/
contamination cause is not established. Source immutability and per-file success
do not prove that the batch failure is harmless, caused by Vitest or unrelated
to all other changes. The batch remains failed and is not silently converted
into a pass. The narrowly inspected pure guard still has no new identified
source defect; that does not clear the batch limitation.

Root's full canonical run was still pending at this assessment (last supplied
progress28/66); the remaining comprehensive gates were likewise not furnished
as terminal here. No aggregate or whole checkpoint success is claimed. Any
later terminal results and decision need a separate dated/source-bound record.

### Later plan binding and honest SDLC ordering limitation

Completely read the expanded standalone plan at whole-blob
`0acaadaf4a29012340506ddc125ee1119a3c4d41`, independently measured6,573
normalized-LF UTF-8 bytes,
`sha256:3c5fd5581c7501be0f52e5ccc4c3b699928a707e6378ec1fc69215bd2be0f441`.
The earlier5ba836b0b9b9ca37ffd8514db9cdb7e35a852316 plan binding and source
review cutoff above are preserved, not replaced/backdated.

The supplement correctly states P4.1 corrective-maintenance scope, actual
delegated maintainer/agent identity, bounded synthetic trust/data, model-eval N/A,
stable RP-01..RP-06, rollback/withholding and failure-retention requirements.
Its requirements match the previously inspected behavior and test vectors,
without new native/S3 authority. Source/test whole-blobs d31359 remain exactly
4bb9d10c61b48cfe7d65a3451ab8da43e67d9d04 and
1b49cf465c90afc726e055e8e277df64e04b1c1d; the source/test aggregate above is unchanged.

The plan explicitly admits that these formal criteria were documented after
root's initial reproducer, regression additions and correction. This is a real
process-ordering limitation relative to AI_SDLC:11-23 (ready work-item contract)
and36-41 (accepted design/final criteria). Adding prose now cannot retrospectively
make the initial work ready or create pre-implementation independent approval.
The existing accepted P4.1 normative no-rollback rule supplied the underlying
correctness requirement, so this is a narrow correction rather than an
unreviewed new contract, but that does not erase the ordering gap.

I accept the current brief as an honest maintenance description for the
remaining review/evidence/checkpoint decision, not as a retroactive gate waiver.
The separately dated scoped decision must acknowledge the ordering limitation,
actual independent source reviews, all mandatory terminal results and the
unresolved supplemental batch cause. There is no new Critical/High/Medium code
finding from this documentation supplement; source-only approval remains
bounded and does not itself authorize delivery, release or native completion.

Actual read-only command evidence: full SDLC/runner reads b4adf5/8086c7,
accepted audit work item acf6a0, frozen audit runner5b5a32; canonical-script
comparison171c25 no diff; current test inventory5c9cbc; whole-blobs97de4c;
full later plan8d66fc/d31359; CLI/runner protected comparison0fb02e no diff;
reference scan e21897; later plan byte binding e8f585. All returned exit0.
Only this owned report addendum was written. No test/build/SDK/native/OS/
session/user-app/Temp/environment/model execution, source change or Git mutation
occurred.
