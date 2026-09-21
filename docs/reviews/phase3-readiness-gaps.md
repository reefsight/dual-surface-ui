# Phase 3 Exit-Audit Readiness Gaps

Status: Preflight only — P3.10 has not started

Date: 2026-09-21

P3.10 requires reviewed completion evidence for P3.1 through P3.9. The current
repository is not yet eligible for the clean-checkout exit audit because the
following authority-bound evidence is missing.

The source-bound machine-readable preflight is
[`docs/evidence/phase3-readiness-preflight-2026-09-21.json`](../evidence/phase3-readiness-preflight-2026-09-21.json).
At commit `127335bb0caa74c1a9b61576e9520a9cb3e7d222` it records four ready
local checks, three missing authority-bound checks, and zero failed checks.

| Gate | Current evidence | Missing authority/evidence | Effect |
|---|---|---|---|
| P3.7 AC-10 | 23 adversarial cases pass; zero unauthorized mutations, unresolved critical/high automated findings, or sentinel matches | Independent security reviewer identity, reviewed commit, findings, and disposition | P3.7 cannot complete |
| P3.8 AC-05–AC-07 | Frozen 12-case, eight-dimension provider-neutral suite and deterministic harness | Explicit provider/model authorization, maximum calls/tokens/cost, credentials boundary, retention policy, and two actual recorded model snapshots/configurations | Completion, wrong-action, safety, and multi-model claims unavailable |
| P3.9 AC-05–AC-07 | Source-bound structural bytes/serialization report and conditional native review | Actual-model task outcomes, interaction steps, exact provider usage or accepted tokenizer accounting, and comparable vision evidence | Step/token targets cannot pass |
| P3.9 AC-12 | Local deterministic and package gates pass in prior records | P3.8 measured gate and the final combined gate rerun | P3.9 cannot complete |
| P3.10 prerequisites | Work-item records and partial evidence exist | Completed P3.7–P3.9 reviews | Exit audit must not start |

## Required authorization record for model runs

Before any provider request, the maintainer must record all of:

1. provider and exact model snapshots/configurations (at least two);
2. maximum calls, input/output tokens, and total cost;
3. credential source and confirmation that credentials will not enter fixtures,
   traces, stdout/stderr, reports, or commits;
4. provider retention/training settings and allowed synthetic data scope;
5. timeout and zero-retry policy, temperature, seed where supported, and
   concurrency;
6. approval to retain only redacted dimension scores and bounded failure data.

Accepted evidence must use the strict private contracts under
`fixtures/phase3-exit/contracts/` and the exact paths checked by the preflight:

- `docs/reviews/p3.7-independent-security-review.json`;
- `docs/evidence/p3.8-multi-model-report.json`; and
- `docs/evidence/p3.9-model-benchmark-report.json`.

File presence alone is insufficient. `phase3:preflight` validates the contract
and then applies the frozen completion, wrong-action, safety, step, token,
vision-comparability, and independence gates.

## Independent security review record

The security reviewer must be independent of the P3.7 implementation and
record the reviewed source commit, corpus/matrix/report digests, scope,
findings with severity, disposition, and whether any critical/high finding
remains unresolved. Automated self-review cannot satisfy this gate.

## Safe work that remains possible without new authority

Deterministic tests, package checks, documentation corrections, and the
eventual P3.10 command orchestration can be prepared. They cannot substitute
for the missing independent review or actual provider evidence, and no Phase 3
approval or P4.1 authorization may be recorded from this preflight.
