# Phase 1 Exit Review

Status: Accepted by repository maintainer on 2026-09-18

Verified implementation commit: `6adc8ce79c478a0b4e1dc4172fd6463d1e63c6e4`

Audit date: 2026-09-18

Decision owner: Repository maintainer

## Decision

The repository maintainer accepted the Phase 1 exit gate and authorized
planning and implementation of P2.1 on 2026-09-18. Package publication and
version tagging remain separate release decisions. The approval changes phase
status only; it does not alter runtime, schema, dependency, or package content.

## Deliverable audit

| Roadmap deliverable | PBI evidence | Implementation | Verification | Result |
|---|---|---|---|---|
| Versioned TypeScript and JSON schemas | P1.1, P1.12 | `src/schema.ts`, `schemas/`, contract manifest | schema tests and contract checker | Pass |
| Snapshot, action, result, error, risk, and policy contracts | P1.1–P1.4, P1.8 | `src/schema.ts`, `src/types.ts`, `src/errors.ts`, `src/policy.ts` | schema, errors, policy, failure tests | Pass |
| DOM/ARIA compiler, visibility, and redaction | P1.2, P1.9–P1.10 | `src/dom.ts`, `src/audit.ts` | DOM conformance and audit tests | Pass |
| Stable identity and stale revision handling | P1.2, P1.5 | `src/dom.ts`, `src/surface.ts` | surface and verification tests | Pass |
| Native click, toggle, set value, select, and submit | P1.5, P1.10 | `src/dom.ts`, `src/surface.ts` | DOM conformance and surface tests | Pass |
| Deny-by-default authorization | P1.4, P1.5 | `src/policy.ts`, `src/surface.ts` | policy, verification, exit adversarial tests | Pass |
| Conformance and hostile fixtures | P1.3, P1.6–P1.10, P1.12 | `test/` | fail-closed gate: 13 files, 134 tests | Pass |
| Example workflow and baseline | P1.11 | `examples/document-approval/`, baseline report | runnable example and 25-run measurement | Pass with limitation |

P1.1 through P1.11 are implemented and represented in the combined gate.
P1.12 supplies the freeze, additional adversarial checks, clean-install proof,
and this decision record.

## Exit-gate evidence

| Exit condition | Evidence at verified commit | Result |
|---|---|---|
| Public contract frozen as `0.1` | 32 runtime exports, 6 reachable declaration files, 5 JSON Schemas | Pass |
| Zero known secret leakage and unauthorized writes | adversarial output, audit, policy, confirmation, replay, and verification tests | Pass |
| Deterministic fixtures | repeated DOM compilation matched after normalizing `generatedAt`; baseline fixture hash is canonical across line endings | Pass |
| Supported actions verify effects | surface and verification suites plus document-approval example | Pass |
| Install, typecheck, build, tests, audit, and package | clean clone, `npm ci`, typecheck, contract build, 134 tests, 0 vulnerabilities, 48-entry tarball | Pass |
| Baseline recorded | completion, steps, wrong actions, safety, context, and latency recorded below | Pass with limitation |

## Security disposition

| Threat | Phase 1 control and evidence | Disposition |
|---|---|---|
| Indirect prompt injection | prompt-like page text remains data; deterministic deny policy cannot be overridden | Pass |
| Confused deputy / unauthorized write | action, surface, revision, policy, precondition, and effect checks fail closed | Pass |
| Secret and audit leakage | DOM redaction, structured events, hostile-output omission, secret sentinels | Pass |
| Consequential-action bypass | trusted confirmation token and document-approval confirmation path | Pass |
| Stale state / TOCTOU | revision and execution-time precondition checks | Pass |
| Replay / duplicate execution | bounded idempotency-key fingerprint and conflict/replay tests | Pass |
| Invalid handler output / internal failure | validated output and redacted structured failure results | Pass |
| Dependency/package exposure | clean `npm audit` reports 0 vulnerabilities; tarball contains only 48 intended entries | Pass |
| Cross-origin transport, signed catalogs, and native privilege | explicitly excluded from Phase 1; no transport/native implementation exists | Deferred to the owning later phase |

There are no known unresolved critical or high security findings inside the
Phase 1 scope. Deferred threats are not represented as implemented controls.

## Clean-clone and consumer proof

The final implementation candidate was cloned into a new directory and verified
without reused dependencies:

- `npm ci`: 83 packages installed, 84 audited, 0 vulnerabilities;
- `npm run typecheck`: passed;
- `npm run contract:check`: passed with 32 exports, 6 declarations, 5 schemas;
- `npm run test:gate`: 13 files and 134 tests passed with no unhandled errors;
- document-approval example: `Approved`, revision `3`, four workflow steps,
  one trusted confirmation;
- `npm pack`: 48 entries, 35,594 bytes packed, 192,784 bytes unpacked;
- isolated consumer: tarball installed with scripts disabled, version `0.1.0`,
  32 imports, and `createAgentSurface` callable;
- build and schema generation left the clean clone unchanged.

## Baseline

The deterministic, scripted, no-model baseline completed 25/25 runs with a
median of four interaction steps, zero wrong actions, zero secret leaks, and
zero unauthorized consequential actions. Median measured interaction latency
was 1,798.436 ms and p95 was 2,739.638 ms on the audit host.

The context result is an honest negative: the semantic snapshot estimate was
608 tokens versus 569 for the small full-DOM fixture, or 6.8% larger. This does
not block the contract/safety proof, but Phase 2 must not claim token reduction
from this fixture. Browser and model baselines are needed before making an
efficiency claim.

## Audit findings closed

1. Baseline fixture hashes differed across LF/CRLF checkouts; hashing now uses
   canonical text and has regression coverage.
2. Endpoint-security contention exposed five-second test timeouts; the harness
   uses a 30-second per-test limit without changing assertions.
3. Vitest could return success after an unhandled worker-start error; the gate
   now validates every one-file summary and fails on partial or unhandled runs.
4. Thread/fork startup was unreliable on the Windows host; one VM worker per
   outer one-file process preserves cross-file isolation and completed twice in
   clean clones.
5. Generated schemas dirtied Windows clones through line-ending conversion;
   generated JSON is now pinned to LF and a clean build leaves no diff.

## Known limitations and non-claims

- Evidence is Node/jsdom based; no real-browser, device, model, WebMCP,
  extension, MCP, native, deployment, or production proof exists yet.
- Latency is host-sensitive and is not a product performance benchmark.
- The baseline uses one synthetic document-approval fixture.
- The package is not published or tagged, and the `0.1` manifest is a source
  compatibility freeze for review, not a registry release.
- Browser/model/production evidence remains required by the later phase gates.

## Maintainer decision

- [x] Approve the Phase 1 exit gate — accepted 2026-09-18.
- [x] Authorize P2.1 planning and implementation under the existing roadmap.
- [x] Keep package publication and version tagging as a separate release
  decision.
