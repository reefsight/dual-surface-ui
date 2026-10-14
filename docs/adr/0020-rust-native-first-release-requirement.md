# ADR 0020 Rust native first release requirement

Status: Proposed technical release contract; maintainer release requirement confirmed.
Date: 2026-10-14, Asia/Bangkok.

## Context

The maintainer chose a first release containing real Rust native functionality
and is willing to wait for native gates. A web-only preview is not the requested
first-release target. The maintainer requested handoff rather than Rust
installation on the current Windows machine.

The accepted [native strategy](../NATIVE_STRATEGY.md) and
[P4.4 decision method](../work-items/P4.4-native-language-decision.md) still
govern qualification. A desired language is not evidence that its implementation
qualifies or outperforms alternatives.

## Proposed release contract

1. The first planned release must include an implemented and qualified Rust
   native host and normalization engine. A folder, dependency, mock, scaffold
   or compile-only result does not satisfy this requirement.
2. Web APIs/framework adapters remain TypeScript behind the language-neutral
   protocol. No whole-project rewrite, Rust/WASM web-core migration or public
   schema change is authorized.
3. Preserve P4.3 completion, accepted ADR 0018, frozen candidate/toolchain/
   bindings/licenses/provenance, comparable measurement and all P4.4 criteria.
   This adds a release constraint, not a replacement for the evidence rule.
4. If P4.4 does not select qualified Rust, defer release and return actual
   findings to the maintainer. Do not silently ship a web-only/non-Rust
   alternative, manipulate comparisons or claim Rust selection. Changing
   the technical decision method requires a separately accepted ADR.
5. P4.5 authenticated host, P4.6 real macOS evidence and P4.7 exit audit remain
   required. Windows-only results do not satisfy the cross-platform release plan.
6. Keep native binaries outside npm. Coordinate the web SDK and separately
   reviewed native distribution after support, signing, provenance,
   install/update/rollback and consumer evidence passes.
7. The existing `0.4` native-preview checkpoint is a target, not a version
   bump or release authorization. Tag/publication/signing/deployment require
   explicit later authority.
8. No Rust installation or environment/security changes on this machine.
   Destination provisioning needs explicit authority if toolchains are absent.

## Acceptance and evidence

| ID | Requirement | Required evidence |
| --- | --- | --- |
| RUST-01 | Real Rust implementation | Qualified source/lockfiles and actual capture/action/event/host execution |
| RUST-02 | Web compatibility | Full/browser/conformance/schema/export/package gates and unchanged protocol |
| RUST-03 | Safety before release | Original guards, zero unauthorized writes/secret leaks and independent reviews |
| RUST-04 | Both platforms qualify | Accepted Windows/macOS semantics, host and real permission lifecycle |
| RUST-05 | Reproducible release | P4.7 acceptance, clean source, SBOM/provenance and approved release record |
| RUST-06 | Provisioning is authorized | Existing destination toolchains or separately approved installation |

## Decision and rollback

The human choice confirms a product requirement, not Rust runtime selection,
ADR 0018 acceptance, native success or distribution approval. Technical/security/
package review of this contract remains separate. Existing accepted phases and
frozen records keep their original dispositions.

Keep distribution disabled until the criteria pass; retain failures. Continue
development/reference use without substituting it for the requested release.
Resume from the [host handoff](../work-items/Rust-native-first-release-handoff-2026-10-14.md).
