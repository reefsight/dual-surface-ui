# Rust native first release handoff

Date: 2026-10-14, Asia/Bangkok.
Status: Documentation handoff; Rust implementation and release remain gated.
Authority: existing [maintainer delegation](../reviews/phase4-agent-review-authorization-2026-10-03.md).

## Outcome and current machine boundary

The first release must contain real Rust native functionality. The maintainer
accepts waiting for native gates and requested handoff instead of installing
Rust here. Keep web/framework APIs TypeScript; Rust targets the native host and
normalization boundary. [ADR 0020](../adr/0020-rust-native-first-release-requirement.md)
records the constraint without accepting a runtime or changing qualification.

No cargo/rustc was found on the current PATH. This handoff installs nothing,
runs no native fixture, and authorizes no publication or release tag.

## Checkout and evidence snapshot

Source commit: `5b06a38418ed619ff6a9076865b0419155effcf2`.
Branch: `codex/p4.3-windows-uia`.
Initial October 14 status: two commits ahead of the locally recorded origin
branch and eleven untracked R1 records; these handoff/navigation docs add local
changes. Remote state was not refreshed. A remote clone alone cannot be assumed
to contain the complete packet. Use an explicitly authorized scoped Git sync
or approved workspace transfer; do not include `.env`, credentials, caches or
private native evidence as ordinary repository files.

Phases 1–3, P4.1/P4.2 and limited P4.3 S1 are accepted. S2 runtime, S3/S4,
full P4.3, P4.4 selection, P4.5 host, P4.6 macOS and P4.7 exit remain open.
October 9 R1 has pure build/admission qualification, not native acceptance.

| R1 record | Exact reviewed pin |
| --- | --- |
| Suite20 source | `sha256:0011376b411742d76078d0b67a65cc213236a38678d83869b6fc79f8578d3416` |
| Suite DLL, 256000 bytes | `sha256:1ec86ebb15d99fa0b6a0385f5dfaae3224de02d102846767fe3a4a56583200c3` |
| Accepted fixture DLL, 28160 bytes | `sha256:05491f5a44d01e9a25f5098d86a4919abb9bb8d6f4d44a4050dcf2560107161d` |
| Fixed freeze | `c165cfcf4ff802eeb7f22d692c51066d0cf31b0f` |
| Conditional entry | `b0cf72bcba1d175d160e7c4a69cc8aea209d214f` |
| Build provenance | `c0caf9d3b498f22095e4dfd02c5256310b7b4e67` |
| First/repeat build qualification | `c622b04b0f2f8363577d6d9bb977dee80ea519f9` |
| Pure packet preflight | `7875c686b21fc4781486e843e222834caa0cb4f6` |

Final packet reports:
[security](../reviews/p4.3-native-suite-r1-final-packet-security-agent-review-2026-10-09.md),
[interoperability](../reviews/p4.3-native-suite-r1-final-packet-accessibility-agent-review-2026-10-09.md),
[package](../reviews/p4.3-native-suite-r1-final-packet-package-agent-review-2026-10-09.md).
They establish readiness only. A separate root go/no-go and immediate exact
bindings remain required. October 9 host attestation/gates are historical,
not current destination proof.

## Resume sequence

1. Read PLAN, AI_SDLC, WORKFLOW, NATIVE_STRATEGY, ADR 0020 and original P4.3/R1
   entries/reports. Reconcile actual checkout/local changes and preserve history.
2. Establish an approved current Windows host/Desktop, toolchains and artifact
   provenance. Different host/path source equivalence does not guarantee whole
   DLL/PDB equality. Missing/different artifacts require separately reviewed
   reconstruction/qualification: do not rewrite R1 to bless new bytes, copy an
   arbitrary DLL or build from an unrelated documentation HEAD.
3. Recheck the full packet, four companions, fifteen inputs, two fixed dev-config
   absences and fixture/oracle. Refresh prerequisite gates through a scoped
   method that cannot implicitly rebuild frozen native bytes. Record actual
   three-role readbacks and separate root go/no-go before native invocation.
4. Run only the admitted single planned S2 first/repeat pair. Retain 22 scenarios,
   32 captures, four probes and 132 original checks per lane; original shared
   10-second/pure 30-second/native 240-second budgets; output bounds and OS/
   ownership/security guards. First failure stops the pair. Retain originals;
   use only the admitted failure reader. No unchanged retry or bypass.
5. Obtain original-artifact reviews and separate S2 acceptance. Then implement/
   verify/review S3 actions and S4 lifecycle under separate entries and complete
   P4.3 with its accepted measurement workload.
6. Accept ADR 0018/P4.4 method and review ADR 0020. Freeze actual destination
   Rust toolchain/target, bindings, lockfiles, licenses, unsafe boundaries and
   candidate/source/runner entry before Rust code/measurement. If installation
   or elevation is needed there, ask for specific permission first.
7. Build the bounded Rust candidate and run identical protocol/golden/action/
   failure/lifecycle/resource/security workloads with retained raw samples.
   Obtain the actual P4.4 decision. Unqualified or nonselected Rust defers the
   requested release; return findings to the maintainer.
8. Complete Rust host/security/operations under P4.5, real macOS parity and
   permission lifecycle under P4.6, and P4.7 independent audit/exit acceptance.
9. Prepare clean source and reproducible release artifacts, version/changelog/
   support/migration/SBOM/provenance, npm pack inspection and separate native
   signing/update/rollback/consumer evidence. Keep native binaries, Cargo files
   and private evidence out of npm. Obtain explicit distribution/tag/publication
   authority, publish verified artifacts without rebuilding, then verify registry
   and native consumer installation/smoke tests.

## Initial read-only commands

From the actual repository root; these install/build/launch nothing:

```powershell
git status --short --branch
git rev-parse HEAD
Get-Command cargo,rustc -ErrorAction SilentlyContinue
node scripts/p4.3-native-suite-source.mjs
```

Do not begin with cargo build, fixture setup, a native launcher, npm publish,
git push or a release tag. A source digest is not artifact/launch authority.

## Handoff acceptance and verification

| ID | Requirement | Verification |
| --- | --- | --- |
| HANDOFF-01 | Real Rust first release, no substitute | Human requirement, ADR 0020 review and actual P4.4/P4.7 decisions |
| HANDOFF-02 | No web rewrite/schema drift/native npm contents | API/schema/package regressions and inspected tarball |
| HANDOFF-03 | No installation/native action in this handoff | Documentation-only scoped diff and command evidence |
| HANDOFF-04 | No stale authority transfer | Current host, original bindings and separately recorded go/no-go |
| HANDOFF-05 | Original gates/history intact | Link/format/source-binding/protected-diff checks and independent review |
| HANDOFF-06 | Missing prerequisites identified before code | Checkout/toolchain/artifact reconciliation and frozen candidate plan |

Agent evaluation is N/A for this documentation change. Verify links/format,
protected diff and source binding; independently review instruction safety.
Rollback only these new docs/navigation changes; retain original evidence and
keep distribution disabled.

## Resume prompt

```text
Resume from docs/work-items/Rust-native-first-release-handoff-2026-10-14.md.
The first release requires real Rust native; the maintainer will wait for gates.
Do not install on the previous host or rewrite the web SDK. Reconcile checkout
and missing local records, inspect current host/toolchains, preserve frozen
evidence, and finish P4.3 predecessors before a reviewed Rust candidate.
Do not publish/tag without explicit authorization. Report evidence and blockers.
```
