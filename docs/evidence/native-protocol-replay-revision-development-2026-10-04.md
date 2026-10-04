# Native protocol historical replay revision development evidence

Date/cutoff: 2026-10-04 12:05 UTC, Asia/Bangkok 19:05.
Producer and implementation author: `/root`.
Status: fresh narrow corrective proof recorded; checkpoint decision separate.
This is neither native execution evidence nor full Phase 4 acceptance.

## Source and review binding

Base HEAD: `b7d32f1a6269c39f559f2761b2d8fdd4a524bf99`, branch
`codex/p4.3-windows-uia`. Only one five-line source insertion and 117 test lines
change runtime/test code. The seven new test instances retain all 15 original
cases and their assertions; no existing assertion or fixed corpus is removed.

| Actual target | Whole Git blob |
| --- | --- |
| `src/native-protocol/session.ts` | `4bb9d10c61b48cfe7d65a3451ab8da43e67d9d04` |
| `test/native-protocol-session.test.ts` | `1b49cf465c90afc726e055e8e277df64e04b1c1d` |
| [Maintenance brief](../work-items/native-protocol-replay-revision-remediation.md) | `0acaadaf4a29012340506ddc125ee1119a3c4d41` |
| [Actual independent security source review](../reviews/native-protocol-replay-revision-security-review-2026-10-04.md) | `dbeca651dc80381bd08800f1b5ad45779ccfbf70` |
| [Actual independent protocol/package source review](../reviews/native-protocol-replay-revision-package-review-2026-10-04.md) | `bad7dba660196a7c3c0e1042e08887fb6ec9cb3e` |

Both source reviewers are separate actual agents, not the author or personal
human sign-off. Their original cutoffs had fresh gates pending; their source
approvals cannot be described as independently executed later gates. Root
rehashed unchanged source/test/report targets in `5da2ae`, completion `5583e9`,
exit 0. The plan's RP-01..RP-06 mapping was formally completed after reproduction
and correction. That explicit SDLC ordering limitation remains recorded and
reviewed, not backdated as advance approval.

Later pre-commit formatting check `f538f6` / session 32560 / `e46532`
returned exit 1: the package report had one extra empty terminal line. Earlier
unstaged `git diff --check` did not cover that untracked report. No commit
followed the failed staged check. The actual report owner removed only that
one LF, rebinding `15caaa82a5a11264f4dd64033a66e724c67dc550` to the table's
`bad7dba660196a7c3c0e1042e08887fb6ec9cb3e`, 17,751 LF bytes,
`sha256:9ae6335a6862ef74c4d9757ed888a5c60f972f76b66f8af4029b3132c6341978`.
Its `121bf4` exit 0 reproduced the old hash by restoring exactly one LF;
`a7965c` exit 0 checked formatting. Source/test bytes, substantive report
content and all executable results below are unchanged. This packet updates
only the report pin and records that failure/correction; actual read-only
binding revalidation and successful staged checks remain required before delivery.

Runtime versions actually read: Node `v24.16.0`, npm `11.13.0`, Vitest `5.0.1`.
No dependency/lock change, installation of an SDK, model call/API-key/.env read,
new native launch or user-application access occurs in this proof.

## Reproducer and red/green history

1. Root compiled old-path synthetic transcript, command `106864`, exit 0:
   R1 action ends R2, accepted event advances to R3, exact old keyed replay
   overwrites the surface to R2 and a new old-R2 request is unexpectedly accepted.
   This is compiled synthetic transcript evidence, not a native effect.
2. Two new expectations against actual unmodified TypeScript source,
   `5f7e0d`, session 42997, completion `a50b8a`, exit 1: both event-before-replay
   and completed-action-before-replay cases fail to throw; all 15 existing tests
   pass. The failure is retained, not asserted to have always passed.
3. After the replay-only response fence, `4cfd23`, exit 0: 22/22 focused cases
   pass. The catalog-refresh case description was subsequently accurately
   renamed; canonical gate below executes those exact final source/test bytes.
4. After fresh builds, `3d6c69`, exit 0: the same bounded compiled event/replay
   counterexample is refused with existing `resync_required`. The verifier is
   terminally closed with null session and empty pending/completed/surface maps.
   This proves the built path, not an installed native executor or host policy.

The added vectors cover event, completed action and catalog advance before
replay, current versus advanced failed-outcome replay, advance while replay is
pending, and surface closure. Existing immediate exact success replay and
changed-request/response fingerprint refusal remain. No dedicated full-snapshot
advance or request-error replay vector is newly claimed; reviewers statically
checked the latter's non-writing compatibility boundary.

## Fresh mandatory checks

All commands below were executed by root on the exact source/test binding, not
by the reviewers. No historical D2 count is substituted for a fresh result.

| Actual command | Actual terminal result | Command/session/completion |
| --- | --- | --- |
| `npm run test:gate` | Exit 0; 66 top-level files, 1,823 tests | `cde316` / 12248 / `29b3ac` |
| `npm run typecheck` | Exit 0; TypeScript, generated core build and Angular no-emit check | `e00f12` / 92803 / `199f0f` |
| `npm run contract:check` | Exit 0; full core/Angular build; frozen 32 root exports, 6 declaration files, 5 core schemas | `4db471` / 60168 / `e74785` |
| `npm run package:check:native-protocol` | Exit 0; packed consumer runtime/declarations/schemas/frozen-root/no-native-artifact checks; corpus 47 accepted/20 rejected, session corpus 8 accepted/14 rejected | `7cf914` / 96993 / `2983a3` |
| `npm run package:check:p4.3-identity` | Exit 0; 325 package entries, 0 experiment/native leaks | `8ea3ad` / 90950 / `2c3867` |
| `npm run test:conformance` | Exit 0; 2 files, 12 deterministic foundation/cross-exporter cases | `1fb272` / 45428 / `4ba34f` |
| `npm run test:adversarial` | Exit 0; 1 nested file, 24 cases | `a89d0d` |
| `npm run test:browser -- --workers=1` | Exit 0; 114 managed cases across Chromium/Firefox/WebKit, 4.7 minutes | `29f8dd` / 44357 / `8b9764` |
| `npm audit --audit-level=high` | Exit 0; 0 vulnerabilities | `a89b2f` / 50263 / `f4eb67` |
| `npm run phase4:p4.2-review:validate` | Exit 0; existing canonical P4.2 record returns `gate_ready` with valid contract/evidence | `e4d608` / 68510 / `fd4727` |

The protocol corpus digest remains
`sha256:1e783a3be9098efc776ce8771e1ce9d44bf5c89eff9913e472fc686c5fa7b241`;
session corpus digest remains
`sha256:9be355e4276a9d0249927693144f084b0fb52316cb92f3ba5f08440762e72692`.
These unchanged fixed corpora do not contain the new regression sequence.

After generation/build, protected comparison `016c19`, exit 0, has no diff
against base in schemas, fixtures, experiments, scripts, protocol specification,
package.json or package-lock.json. Full tracked-name read-back `5da2ae` lists
only the intentional session source and tests. Ordinary LF/CRLF warnings are
not semantic drift or test failures. Scoped diff check passed before any stage.

The P4.2 validator checks that historical accepted record. It does not accept
this new maintenance source or transfer native authority. Managed browser proof
is not Chrome-native WebMCP, Windows UIA, macOS or release proof. These counts
overlap; they are separate scopes, not an additive grand total.

## Supplemental batch failure retained

Root additionally ran
`npm test -- --pool=vmThreads --maxWorkers=1 --no-file-parallelism`:
`c16b49` / session 93465 / `d03e39`, **exit 1**. Result: 68 files, 1,862 tests;
3 failed files/12 failures, 65 passed files/1,850 passed tests. Failures were
`cli-driver-host` (5/16), `cli-node-io` (6/14) and `cli-node-io-recheck` (1/1).
They are unchanged source/test paths, but their failure is not declared harmless
or caused by Vitest merely because this diff does not edit them.

The unchanged canonical runner predates this fix and runs every top-level test
in a fresh process with fail-closed status/signal/unhandled-error/count checks.
It includes all three failed files, which actually pass 16/16, 14/14 and 1/1 in
the completed canonical run. The driver file also passes separately with both
default isolation (`816ed7` / 59532 / `fa2195`) and isolate=false
(`27798e` / 72939 / `ec78da`). No assertion, selector or runner was weakened.
The batch-versus-per-file difference is observed; its underlying interaction
cause is unresolved. The failed batch remains failed.

The canonical runner covers 66 top-level files, not every recursive file.
Separate conformance and adversarial commands above cover their stated nested
scopes; no complete Phase 3 audit, native-browser aggregate, model evaluation
or all-recursive-test success is inferred. The package reviewer independently
confirmed the pre-existing canonical command contract and retained these limits.

## Remaining authority

Source reviews, executable evidence and the later scoped decision remain distinct.
This packet cannot accept S2's missing original positive 22-scenario/32-capture
first/repeat artifacts, implement or authorize S3, satisfy S4 or close P4.3,
P4.4 or Phase 4. D2's negative record and human host-context/controlled-
continuation requirements are untouched. No retry, host/security change,
publication, release, deployment, main merge or Rust selection follows here.
