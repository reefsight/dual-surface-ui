# Phase 3 Exit-Audit Readiness Gaps

Status: Ready — P3.10 clean-checkout audit authorized by prerequisite gate

Date: 2026-09-21

P3.10 requires reviewed completion evidence for P3.1 through P3.9. The current
repository is eligible for the clean-checkout exit audit because all local and
authority-bound preflight checks are ready.

The source-bound machine-readable preflight is
[`docs/evidence/phase3-readiness-preflight-2026-09-21.json`](../evidence/phase3-readiness-preflight-2026-09-21.json).
At commit `76be5e27ed13b7b900a7a89a783cd64960329429` it records seven ready
checks, zero missing checks, and zero failed checks.

| Gate | Current evidence | Missing authority/evidence | Effect |
|---|---|---|---|
| P3.7 AC-10 | 23 adversarial cases pass and the independent review records no unresolved critical/high finding | None | Ready |
| P3.8 AC-05–AC-07 | Two supported Luna configurations pass all completion, wrong-action, safety, leak, and environment thresholds | None | Ready |
| P3.9 AC-05–AC-07 | Comparable four-surface Luna benchmark passes quality, safety, exact-token, step, and vision gates | None | Ready |
| P3.9 AC-12 | Canonical benchmark evidence validates as gate-ready | None | Ready |
| P3.10 prerequisites | All seven preflight checks are ready and the 22-command fail-closed audit runner is prepared | None | Exit audit may start |

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

The canonical record identifies `Pitchayut586` as independent from the P3.7
implementation and binds the reviewed source commit, corpus/matrix/report
digests, findings, and zero-unresolved-critical/high disposition. The strict
security evidence validator reports `gate_ready`.

## Authorized next work

The deterministic, browser, contract, package, dependency, and diff checks may
now run through `npm run phase3:audit`. A passing P3.10 audit may prepare only a
proposed Phase 3 Exit Review; Phase 3 approval and P4.1 authorization still
require a separate explicit maintainer decision.
