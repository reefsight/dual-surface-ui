# Phase 3 Exit Audit Evidence

Status: Passed — 22/22 commands

Audit date: 2026-09-21

Candidate commit: `98302ac44377e29a24a0ad03e47c4a98d015e8ce`

Command: `npm run phase3:audit`

Environment: Windows 11 build 26200, Node 24.16.0, npm lockfile install,
Playwright 1.63.0 managed engines

## Result

The fail-closed runner began from a clean checkout, required the Phase 3
readiness preflight, and completed all 22 frozen commands. It finished with
`{"status":"passed","commands":22}`. No provider call or credential was
required by this audit; canonical model evidence was validated from the
source-bound reports.

| Gate | Result |
|---|---|
| Readiness preflight | Ready: 7, missing: 0, failed: 0 |
| Clean install and dependency audit | 187 packages installed; 0 vulnerabilities |
| Typecheck and build | Passed, including Angular compilation and schema generation |
| Deterministic gate | 53 files / 545 tests passed |
| Mandatory conformance | 2 files / 12 tests passed |
| Managed browser gate | 105/105 passed across Chromium, Firefox, and WebKit; one worker, zero retries |
| Adversarial gate | 24/24 passed |
| Golden and scorer gates | 1/1 golden suite and 6/6 scorer tests passed |
| Structural benchmark | 12 tasks across four baselines; clean source commit |
| Frozen Phase 1 contract | 32 runtime exports, 6 declaration files, 5 schemas |
| Packed consumers | Delta, trace/replay, Playwright, CLI, conformance, adversarial, and golden gates passed |
| Package inspection | 268 files; 230,585 bytes packed; 1,309,853 bytes unpacked |
| Dependency and diff hygiene | `npm audit --audit-level=high` and `git diff --check` passed |

The package gates reported tarball digest
`sha256:14efd476bd5e89ddffa2d04f6935f7201ce3a26b6eeb9abc8c6d07649affbd52`
and installed-manifest digest
`sha256:70326171afd3db65267d1f497f0869b95268785bebcffa091be70807761a2678`.

## P3.1–P3.9 deliverable traceability

| Work item | Implementation and contract | Executable/source-bound evidence | Disposition |
|---|---|---|---|
| P3.1 MCP exporter | `d20458d`; `src/mcp/` | core integration, modern protocol, isolated package and P3.6 conformance gates | Pass |
| P3.2 Playwright fallback | `1c67307`, `26d502b`, `31677b0`; `src/playwright/` | semantic/visual unit suites and 105-case three-engine browser gate | Pass |
| P3.3 delta snapshots | `ccc20c0`; `src/delta/` and phase3 delta schema | delta, stale-base, round-trip, frozen-root packed consumer | Pass |
| P3.4 traces and replay | `a38f3f6`; `src/trace/`, `src/replay/` | trace/replay, redaction, schema, and packed-consumer gates | Pass |
| P3.5 CLI orchestration | `6cdb54f`, contract `9743e8a`; `src/cli/` | CLI suites plus executable, schema, fixture, allowlist, and leak package checks | Pass |
| P3.6 cross-exporter conformance | clean evidence commit `3191120` | aggregate report: 126 passed, 4 capability-scoped unsupported, 0 failed; native Chrome 153: 26/26 | Pass |
| P3.7 adversarial security | `e0c5410`, hardened by `f272418` | 23/23 corpus cases prevented; package suite 24/24; independent review approved | Pass |
| P3.8 multi-model evaluation | runner/scorer plus prompt correction `1b62198` | Luna medium/high: 72/72, 100% completion and critical safety, zero wrong action/leak/environment error | Pass |
| P3.9 benchmark and feasibility | cancellation boundary `d63b439` | 144/144 scored; 97.92% completion, 0% wrong action, 50% step and 88.12% token improvement | Pass |

## Security and compatibility disposition

- Independent reviewer `Pitchayut586` approved P3.7 against reviewed commit
  `f27241880d97384bd48ad748e8b31ef5e446e50e`, with no findings and zero
  unresolved critical/high findings.
- P3.7 recorded zero unauthorized mutations and zero sentinel matches. P3.8
  and P3.9 recorded zero unauthorized consequential actions and zero secret
  leaks in their passing canonical reports.
- MCP, WebMCP compatibility, native WebMCP, and managed Playwright retain their
  evidence tiers. The accepted P3.6 native record is Chrome 153, 26/26; the
  current audit host did not relabel managed-engine evidence as native proof.
- Playwright fallback uses the same policy, confirmation, revision,
  verification, and authoritative-state boundaries as the other exporters.

## Retained failed-attempt history

The final pass does not erase earlier evidence:

1. The first trial correctly failed because a readiness test still expected
   missing authority artifacts; the test now proves both the canonical ready
   state and an isolated fail-closed missing-authority fixture.
2. The next trial incorrectly required a native WebMCP profile on every host;
   the runner was aligned to the accepted evidence-tier boundary without
   changing the native report.
3. A three-worker browser trial passed 101/105 but hit constrained-host Firefox
   and WebKit setup/lifecycle timeouts. The final gate serializes engines while
   retaining all tests, assertions, projects, and zero retries.
4. Two long WebKit lifecycle/race cases reached the global 30-second cutoff.
   Each now has a 60-second test-local budget; every other case retains the
   global 30-second limit. The final browser run passed 105/105.

## Limitations and non-claims

- This is package, managed-browser, protocol, and synthetic-model evidence; it
  is not production deployment, uptime, identity, payment, or real-user proof.
- Native WebMCP evidence is version-bound to its accepted Chrome 153 report.
- Managed WebKit is not branded Safari evidence.
- Windows UI Automation, macOS Accessibility, OS permissions, secure desktop,
  daemon authentication/isolation, signing, installers, and upgrades remain
  Phase 4 gaps.
- No Rust, .NET, Swift, C, or assembly choice is authorized or implied.
- Package publication, versioning, tagging, and deployment remain separate.
- This audit supplies technical evidence only. It does not approve Phase 3 or
  authorize P4.1.
