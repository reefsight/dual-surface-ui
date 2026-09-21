# Phase 3 Exit-Audit Readiness Gaps

Status: Preflight only — P3.10 has not started

Date: 2026-09-21

P3.10 requires reviewed completion evidence for P3.1 through P3.9. The current
repository is not yet eligible for the clean-checkout exit audit because the
following authority-bound evidence is missing.

The source-bound machine-readable preflight is
[`docs/evidence/phase3-readiness-preflight-2026-09-21.json`](../evidence/phase3-readiness-preflight-2026-09-21.json).
At commit `191c29887060ceb1187ab6bc2d1934b4dedcb7ac` it records six ready
checks, one missing authority-bound check, and zero failed checks.

| Gate | Current evidence | Missing authority/evidence | Effect |
|---|---|---|---|
| P3.7 AC-10 | 23 adversarial cases pass; zero unauthorized mutations, unresolved critical/high automated findings, or sentinel matches | Independent security reviewer identity, reviewed commit, findings, and disposition | P3.7 cannot complete |
| P3.8 AC-05–AC-07 | Two supported Luna configurations pass all completion, wrong-action, safety, leak, and environment thresholds | None | Ready |
| P3.9 AC-05–AC-07 | Comparable four-surface Luna benchmark passes quality, safety, exact-token, step, and vision gates | None | Ready |
| P3.9 AC-12 | Canonical benchmark evidence validates as gate-ready | None | Ready |
| P3.10 prerequisites | Six of seven preflight checks are ready and the 22-command fail-closed audit runner is prepared | Completed P3.7 independent review | Exit audit must not start |

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

Drafts can be checked without placing them at the canonical evidence path:

```text
npm run phase3:evidence:validate -- security <repo-relative-json-path>
npm run phase3:evidence:validate -- models <repo-relative-json-path>
npm run phase3:evidence:validate -- benchmark <repo-relative-json-path>
```

Exit `0` means contract-valid and gate-ready, `2` means contract-invalid, and
`3` means the contract is valid but its frozen gate is not satisfied. The
validator emits only bounded status metadata and never echoes evidence content.

## Independent security review record

The security reviewer must be independent of the P3.7 implementation and
record the reviewed source commit, corpus/matrix/report digests, scope,
findings with severity, disposition, and whether any critical/high finding
remains unresolved. Automated self-review cannot satisfy this gate.

## Safe work that remains possible without new authority

Deterministic tests, package checks, documentation corrections, and the P3.10
command orchestration are prepared. The actual provider evidence is now
gate-ready, but none of these artifacts can substitute for the missing
independent review. No Phase 3 approval or P4.1 authorization may be recorded
from this preflight.
