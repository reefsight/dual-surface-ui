# Native protocol historical replay revision security review

Actual reviewer: `/root/p42_security_review`, public ID `p42_security_review`.
Review cutoff: **2026-10-04 11:40:26 UTC** (18:40:26 Asia/Bangkok).
Disposition: **source-approved for this narrow pure verifier correction**.
Unresolved findings: Critical 0, High 0, Medium 0.

This is an independent source/spec/regression-boundary review, separate from
the S3 semantic-action design. Root authored the correction and tests; I
authored neither, did not delegate, and did not execute a test or reproducer.
Fresh mandatory gates and a separate scoped disposition remain root-owned.
This report grants no native execution, S2/S3 entry or runtime acceptance.

## Exact reviewed bytes

I read the complete current source, test and remediation brief, the frozen
protocol specification, and the source diff against the committed baseline.
Read-only Node hashing of LF-normalized UTF-8 bytes reproduced:

| File | Git blob | SHA-256 | Bytes |
| --- | --- | --- | --- |
| `src/native-protocol/session.ts` | `4bb9d10c61b48cfe7d65a3451ab8da43e67d9d04` | `84a645951c789ea7b5308e72a66982f36a837ac64857603aba68e8804499915b` | 12,982 |
| `test/native-protocol-session.test.ts` | `1b49cf465c90afc726e055e8e277df64e04b1c1d` | `7516c7f079df24c4ae2e9b9a924053b4459644f9385b8d7746f1c044ed01dbad` | 16,490 |
| `docs/work-items/native-protocol-replay-revision-remediation.md` | `5ba836b0b9b9ca37ffd8514db9cdb7e35a852316` | `8745c1b5204dab1fcc336ed24cd3baef7a5f9ded10954a974f5acc694ef65965` | 3,864 |
| Frozen protocol 0.1 specification | `b51cde2478d083277eb4aeb1a5fe68ddafbd11ca` | `430a0c46fc0512aa30346f474fe86afff7125a49a4a6e34579eedae20f4a5b6a` | 14,881 |

Baseline source was `6b555e1a062fc4bf667199d4222cda0959397d3d`;
baseline tests were `aefef875c41eb0483f39a100eebb518618d83696`, over the
reported committed base `b7d32f1a6269c39f559f2761b2d8fdd4a524bf99`.
The diff contains one five-line source fence plus its fixed explanatory
comment and seven new test instances. No existing test assertion is removed.
The catalog-refresh test's final description is accurately named; it does not
claim to test a full-snapshot refresh.

Additional unchanged references were independently hashed:

- Session corpus generator: `4a650b3e37914ee812d8b3a459bf44753f363500`.
- Fixed session corpus: `07721d8d8c84e0c85dbd29d4e25b9d53dbdf6719`,
  SHA-256 `9be355e4276a9d0249927693144f084b0fb52316cb92f3ba5f08440762e72692`.
- Execution schema: `f46ceade90d79b153d2990a118e97f1d60290054`.
- Message validation: `9788429b5597480afb9d0cb41d543a2ce6ab0b0d`.

I re-read the complete execution schema and message-validation entry point.
This limited comparison is not a claim that I independently ran every
protected-file or package gate.

## Defect and actual correction

The initial S3 design investigation identified a pre-existing exported
transcript-verifier rollback path, not a native effect. An original keyed
action ending at R2 could be replayed after an accepted event/action/catalog
advanced the current surface to R3. Request admission retained R3 as the new
pending revision; the exact historical R2 response then passed the ordinary
in-flight race check and overwrote the current map with R2.

The frozen specification makes this an actual verifier obligation, not merely
an authenticated-host policy question: its exported-verifier paragraph requires
revision violations to close the session; action outcomes must agree with
trusted state; and the event-race rules expressly prevent newer-state rollback
or closed-surface resurrection. Exact request/response fingerprints alone
cannot satisfy that obligation for a historical transition.

The correction at `src/native-protocol/session.ts:305` distinguishes historical
completed replay from a new action transition. If the replay-response marker
is present, current revision must equal the exact stored response's terminal
`outcome.revision`, or the existing fixed `resync_required` failure path closes
and clears the verifier. This occurs before the surface map is written.

Independent static checks:

- The marker originates only from an existing completed keyed action with an
  identical canonical request (`session.ts:183`). A caller cannot provide it
  as a schema field or bypass completed-content checks.
- Response request-ID/kind correlation and canonical response-fingerprint
  equality run first (`session.ts:235`). A changed cached outcome cannot be
  retagged to R3 to satisfy the new equality; it conflicts instead.
- Both succeeded and failed `action-response` outcomes pass through the fence.
  It is not conditional on success or a previous-revision field.
- A surface closed while replay is pending has no current revision; it cannot
  equal the bounded string terminal revision and therefore cannot be revived.
  A surface missing before replay is refused at request admission.
- Immediate exact replay at the currently admitted terminal revision remains
  admissible. Ordinary original-response request-time/response-time race rules
  and succeeded-outcome previous-revision correlation remain unchanged.
- Revisions are opaque equality tokens, not sortable counters. This correction
  does not attempt to infer freshness from spelling, timestamps or arithmetic.
- Failure uses the existing constant exception path; `#close()` clears pending,
  completed, surface, capability and session state. It does not emit an invented
  wire error, manufacture a revision or silently continue the session.

The original static discovery remains recorded as unexecuted by this reviewer.
Root's subsequent reproduced red/green evidence is separately attributed below;
it does not retroactively turn that first review into an executed test.

## Request-error, resources and host-authority boundaries

An exact replay whose recorded response is a `request-error` retains the
existing behavior. The response still requires current session/capability/
surface admission and exact request/response fingerprints. The
`session.ts:257` early return performs no surface-revision write, so accepting
that fixed error cannot create the demonstrated rollback. There is no outcome
revision to compare, and this patch does not invent one. A changed error code,
message or response kind still fails its recorded fingerprint.

The verifier is not an executor, authenticator, action-policy engine or replay
ledger across new request IDs. Fresh OS identity, permission/policy and
historical-disclosure checks belong to the trusted host. A cached protocol
refusal cannot be treated as authority to execute or as evidence that a native
effect did not occur. The separately revised S3 design retains those stronger
host obligations; this source approval is not their implementation evidence.

The 128-active/4,096-completed limits, bounded descriptor-safe message capture,
canonicalization, schema/error constants, handshake/capability gates and
correlation maps are unchanged. The new check uses existing bounded strings
and one marker, adds no caller-proportional collection, SDK/OS access, logging,
secret output or raw exception text. Existing new-request-ID stale-revision
admission remains in place; keyed replay is not a new-ID exemption.

Catalog/snapshot/event producers still must supply authoritative unique
revision identities. This equality fence cannot detect a producer reusing an
old revision token for different semantic state, hostile state lying, or an
otherwise independent catalog-ordering bug. Those are not claims made by this
target, and no unrelated protocol behavior is broadened here.

## Regression boundary and root-owned evidence

I inspected the added tests, without running them. They cover:

- An event advancing R2 to R3 before replay, with complete terminal-state
  clearing asserted.
- Another completed action advancing the same surface before replay.
- An authoritative catalog refresh advancing the surface before replay.
- Both current-terminal and advanced-revision failed-outcome replay.
- A third revision arriving while exact replay is pending.
- Surface closure while replay is pending, without resurrection.

Existing immediate canonical replay, changed request/response content,
original in-flight third-revision, session/capability/correlation, stale action,
catalog-change and active-request-bound assertions remain. The test helper's
`input.confirmed` is only a generic JSON transcript value; it does not implement
or prove consent in a native executor.

There is no new dedicated request-error-replay regression in these seven
instances. Static inspection establishes the non-writing boundary described
above; a future pure vector could explicitly assert that an exact fixed-error
replay after a current event preserves that revision. This is an accepted
coverage limitation, not an unresolved source defect or permission to expand
the current source change. The unchanged fixed corpus is not silently extended
or cited as exercising the newly discovered transcript.

Root supplied and the current remediation brief records:

- Bounded compiled old-source reproduction, command `106864`, exit 0, with an
  old-revision request unexpectedly accepted after rollback.
- Red tests against unchanged TypeScript source, command `5f7e0d`, session
  `42997`, completion `a50b8a`, exit 1: two new regressions failed and all 15
  pre-existing cases passed.
- Correction green, command `4cfd23`, exit 0, 22/22 focused tests. Root later
  renamed the catalog-refresh description without a semantic source change.

These are root-executed pure transcript checks, not my executions, native
effects or fresh full-suite/package/browser/conformance proof. At this review
cutoff the additional mandatory fresh gates were still forthcoming; none is
predicted or substituted by source inspection. Final evidence attribution must
use their actual terminal results and exact reviewed bytes.

## Scoped disposition and limits

The actual reviewed correction is proportionate and fail closed for the
identified historical-action-response rollback. No unresolved Critical, High
or Medium finding remains in these exact source/test bytes. I recommend this
narrow public verifier correction for its separately gated checkpoint after
mandatory fresh checks and the other actual independent review are complete.
Any material source/test change requires a new exact binding and re-review.

I used read-only source/spec/test reads, searches, diff inspection and file
hashing only. I did not execute tests/builds/native/SDK/OS probes, inspect Temp
artifacts/environment/secrets/user applications, mutate Git or author a fix.
The only permitted write for this separate target is this report.

All historical C0/D1/D2 failures, source approvals, freezes and evidence remain
intact and scoped to their original targets. This report cannot satisfy S2
runtime, S3 design/entry/implementation/native acceptance, full S4 lifecycle,
real OS-denial evidence, P4.3, P4.4 or Phase 4 acceptance.

## Dated docs-only plan supplement - 2026-10-04 11:48:35 UTC

I independently read the complete supplemental remediation brief, not only
its newly added paragraphs, and the complete referenced maintainer-delegation
record. This is a separate docs-only review cutoff. The earlier reviewed brief
`5ba836b0b9b9ca37ffd8514db9cdb7e35a852316` and its source-review chronology above
remain history, rather than being silently replaced or backdated.

Exact new brief: `docs/work-items/native-protocol-replay-revision-remediation.md`:

- LF-normalized whole Git blob `0acaadaf4a29012340506ddc125ee1119a3c4d41`.
- SHA-256 `3c5fd5581c7501be0f52e5ccc4c3b699928a707e6378ec1fc69215bd2be0f441`.
- 6,573 normalized UTF-8 bytes.

Read-only hashing reported exit 0 and independently confirmed unchanged source
`4bb9d10c61b48cfe7d65a3451ab8da43e67d9d04`, tests
`1b49cf465c90afc726e055e8e277df64e04b1c1d`, frozen protocol spec
`b51cde2478d083277eb4aeb1a5fe68ddafbd11ca`, and separate S3 design
`deb5561e1ceaa94e217645f5f6f07f0b429ec6df`. Their earlier SHA-256/byte bindings
remain unchanged. The delegation record was independently read and hashed as
`eb9e4e0413654e97a8ce71ced422c0757fcd664a`, SHA-256
`dfcaa34934f8c777fe883cdef98b77938f17b3f8bde2f3cafec5f2760bc0d854`,
3,123 normalized bytes.

Supplemental plan disposition: **acceptable for this narrow corrective
maintenance review, with the ordering limitation explicitly retained**.
No new unresolved Critical, High or Medium security finding is introduced.
The source-only disposition above remains bound to the unchanged actual source
and tests; this plan supplement is not prior implementation approval or a
completed acceptance/commit/release gate.

### Ordering, authority and data assessment

The supplement correctly places the change in accepted P4.1
`dual-surface-ui/native-protocol`, separate from P4.3 S3 implementation. It names
the maintainer and requires actual independent reviews and evidence-based
scoped decisions under the dated delegation, without implying personal human
source checks. That delegation explicitly preserves phase/entry conditions and
requires separate actual evidence; it does not grant native permission, host
security changes, publishing or acceptance of unreviewed work.

The RP-01 through RP-06 identifiers were documented **after** the initial root
reproduction, regression additions and correction. This is a genuine process
ordering limitation: a standalone advance review of those new criterion labels
did not occur. The plan acknowledges that fact instead of claiming a fictitious
pre-implementation approval. The accepted frozen 0.1 contract already supplied
the substantive no-rollback/closed-surface requirement, and the actual narrowed
source/test correction was independently reviewed after authorship. For this
limited maintenance scope, the later stable mapping is adequate traceability
for the pending checkpoint, not evidence that a new runtime design was approved
before implementation. Delivery remains dependent on actual fresh gates and a
separate final evidence-bound decision.

The mappings are consistent with inspected source/tests: event/action/catalog
advance; exact current-terminal success and failed replay; pending-event/closure
and changed-fingerprint refusal; unchanged contracts/bounds/corpora; and honest
gate history. The catalog case does not claim snapshot-refresh coverage. RP-05
and RP-06 still require their actual protected-file/package/contract/corpus and
fresh gate outputs; the table itself cannot satisfy them.

The data classification is appropriately narrow. This workflow uses bounded
synthetic protocol transcripts and changes only admission of authoritative
revision state during completed replay. It introduces no provider-text/native
selector authority, user-data capture, raw diagnostic channel or new secret
read. Existing schema permits descriptive fields elsewhere in protocol messages;
the supplement does not claim those fields disappeared or became trusted action
authority. This correction neither changes prompts/discovery/action selection
nor invokes a model, so model evaluation N/A is appropriate to this target and
not an exemption for a later model-connected workflow.

The rollback/disable wording is conservative: withhold delivery for unresolved
regressions, retain failed evidence, and do not relax replay/guard/test checks.
Any later revert needs a distinct decision that retains the known unsafe old
replay limitation. No revert, feature flag, publishing or release is performed
or authorized by this review.

### Supplemental runner evidence remains non-green

Root reported supplemental batch `c16b49`, session `93465`, completion `d03e39`,
**exit 1**, with 12 failed and 1,850 passed tests across 68 files. This failed
batch is retained; my earlier report's then-running attribution is not rewritten
as a pass. The reported failures were in three unchanged CLI files. Root also
reported per-file CLI-driver checks with both default isolation and
`isolate=false` passing 16 tests, and the existing canonical `test:gate` session
`12248` progressing past CLI groups of 16, 14 and 1 tests. At this cutoff that
whole 66-file canonical gate was still pending.

These are root-supplied results, not reviewer-executed tests or an independently
established contamination cause. Passing a per-file driver or a phase within a
running canonical gate does not make the failed supplemental batch green or
supply a terminal aggregate gate result. No underlying cause is inferred, and
there is no relationship established to any native desktop/admission refusal.
The package review and final fresh checks remain separate obligations.

Only this explicitly permitted report addendum was written. No tests/builds/
native/SDK/OS/Temp/environment/secret/source-edit/Git action or subdelegation was
performed. The S3 design report, historical source/evidence and all native
stop/entry conditions remain unchanged.
