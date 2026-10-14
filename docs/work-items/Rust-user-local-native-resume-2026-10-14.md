# Rust user local provisioning and native resume

Date: 2026-10-14, Asia/Bangkok.
Status: Authorized provisioning and prerequisite verification; native acceptance pending.

## Authority and outcome

The maintainer explicitly authorized user-local Rust installation without admin
and continuation toward the native gates. The maintainer separately confirmed
that the current Desktop is normal, unlocked, without UAC or a remote/background
session, and ready for the temporary synthetic fixture windows.

This authorization supersedes only the previous no-installation instruction for
Rust on this host. The [earlier handoff](Rust-native-first-release-handoff-2026-10-14.md)
remains the historical record. Keep the real-Rust first-release requirement,
TypeScript web APIs and unchanged qualification method. Installation is not
runtime selection, P4.3/P4.4 acceptance or distribution permission.

## Scope and trust boundaries

- Download the official x64 Windows MSVC rustup installer over HTTPS and verify
  its SHA-256 against the official checksum before execution.
- Install the minimal stable MSVC toolchain in this user's `.cargo` and `.rustup`
  directories. Use absolute executable paths; do not change persistent PATH.
- Use existing MSVC Build Tools. Do not install Visual Studio, request elevation,
  alter accessibility/security settings or bypass a Desktop/ownership guard.
- Verify compiler/Cargo versions and a synthetic console link smoke test outside
  the repository. This is toolchain readiness, not Rust native implementation.
- Refresh the existing prerequisite gates without rebuilding frozen R1 native
  artifacts. Retain failures and original test budgets.
- Bind the actual three final packet reports and current exact packet in a
  separate root go/no-go before the single original native first/repeat pair.
- On first native failure, stop the pair and read only its retained original
  negative record through the admitted failure reader. No unchanged retry.

No secrets, production apps, arbitrary windows/processes, user-data capture,
signing credentials, macOS emulation, release tag or npm publication are in scope.
Native binaries and Cargo files remain outside npm. Existing delegated agent
review authority does not constitute personal human inspection.

## Acceptance and evidence

| ID | Requirement | Evidence |
| --- | --- | --- |
| RESUME-01 | User-local trusted installation without admin | Installer URL/checksum, invocation, exact installed versions and paths |
| RESUME-02 | Existing MSVC can link Rust | Isolated temporary console source, compiler result and executable output |
| RESUME-03 | Original R1 source and closure remain unchanged | Full fixed admission and source/report/entry/closure pins before native |
| RESUME-04 | Prerequisite failures are not hidden | Actual fresh test/build/browser/package evidence with failures retained |
| RESUME-05 | Native launch has separate authority | Actual final report readbacks, explicit root go/no-go and immediate admission |
| RESUME-06 | Actual runtime results determine acceptance | Original first/repeat artifacts and independent review; stop on first failure |

The current source checkpoint is `5b06a38418ed619ff6a9076865b0419155effcf2`;
the starting documentation HEAD is `8cbc1001f82fdd014f60f9a74f878ccf40ecd6f1`.
Suite20 remains
`sha256:0011376b411742d76078d0b67a65cc213236a38678d83869b6fc79f8578d3416`.
The [fixed execution entry](../reviews/p4.3-native-suite-r1-execution-entry-2026-10-09.md)
still governs counts, budgets, fixture ownership and failure boundaries.

## Continuation and rollback

Complete P4.3 S2/S3/S4 and its measurement workload before the reviewed P4.4
candidate campaign. Actual Rust selection, authenticated host, real macOS
permission lifecycle and P4.7 acceptance remain required before release.
If a prerequisite fails, retain its output and report the concrete blocker;
do not widen scope or weaken the original criteria to force success.

No project runtime code changes are part of provisioning. Roll back any later
implementation only through scoped reviewed changes. Do not delete existing
user toolchains, caches or frozen evidence as cleanup. Toolchain removal requires
a separate exact-target instruction if the maintainer requests it.
