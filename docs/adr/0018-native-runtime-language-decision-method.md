# ADR 0018: Native Runtime Language Decision Method

Status: Proposed; measurements blocked on P4.3 acceptance

Date: 2026-09-22

## Context

The project needs a native host after proving Windows semantics. Rust is the
maintainer's preferred direction, but the accepted native strategy requires
measured need, safe bindings, packaging/signing/update feasibility, process
isolation, and contributor-maintenance evidence. Premature selection would turn
protocol work into a rewrite and could hide platform-specific costs.

## Proposed decision

1. Freeze candidates, versions, workload, repetitions, budgets, environment,
   retry/outlier policy, and raw evidence format before comparative runs.
2. Require identical protocol, fixture, semantic action, failure, concurrency,
   cancellation, event-loss, resource, and security cases for every candidate.
3. Apply correctness/security/package qualification before comparing speed.
4. Compare Rust, .NET/platform-native, and Node/native-binding approaches when
   each is viable; retain explicit exclusion evidence otherwise.
5. Select Rust only if an accepted requirement cannot be met safely and
   maintainably by viable alternatives, or required hardened cross-platform
   isolation cannot otherwise be achieved.
6. Use maintainer preference only as a late tie-break consideration after all
   mandatory evidence; never use it to waive a failed qualification gate.
7. Limit any selection to the native host and normalization engine. Preserve
   TypeScript web/framework packages and language-neutral protocol schemas.
8. Permit `defer` when no candidate qualifies or evidence is not comparable.
9. Require independent benchmark, security, package/update, and maintenance
   review plus explicit maintainer acceptance of the final disposition.

## Consequences

- Rust can be selected confidently if the evidence supports it, without
  migrating the web SDK.
- Comparative spikes may duplicate small amounts of internal code, but only the
  accepted strategy proceeds toward production hardening.
- Faster output cannot hide an authorization, redaction, replay, permission,
  packaging, signing, update, or contributor-support failure.
- The decision remains reproducible and reversible because raw samples and
  unsuccessful candidates are retained.

## Rejected alternatives

- Rewrite everything in Rust: rejected because browser/framework integrations
  are JavaScript-native and no measured web limitation exists.
- Choose Rust now because it is preferred: rejected by the existing evidence gate.
- Choose .NET solely because UIA bindings are mature: rejected without macOS,
  isolation, packaging, update, and maintenance comparison.
- Choose the fastest microbenchmark: rejected because native correctness,
  security, lifecycle, and delivery dominate isolated throughput.
- Hide failed candidates or tune thresholds after results: prohibited.
