# ADR 0010: Runtime Traces Are Not Replay Fixtures

Status: Accepted for P3.4 implementation on 2026-09-20

Date: 2026-09-20

## Context

Maintainers need deterministic lifecycle diagnostics and reproducible failure
fixtures, but those goals have different data and authority boundaries. A
runtime trace containing action input, page state, prompts, identities, or raw
errors can leak secrets. A replay API that accepts a live surface, driver, or
callback can become a policy bypass. Core keyed action replay is also not the
same as offline fixture replay.

Audit events already contain only lifecycle metadata, but even opaque surface,
revision, action, and correlation identifiers may carry secret-shaped text.
Time, duration, and correlation IDs are nondeterministic and cannot define
semantic replay equality.

## Decision

1. Add two isolated optional subpaths: `dual-surface-ui/trace` for runtime
   recording and `dual-surface-ui/replay` for reviewed synthetic fixtures. Do
   not alter or re-export them from the frozen root contract.
2. Give runtime traces and replay fixtures distinct versioned kinds and strict
   schemas. Neither validator accepts the other kind.
3. A recorder consumes only existing `AgentAuditEvent` values. It constructs
   records from an explicit field allowlist and never spreads or serializes a
   request, snapshot, result, policy object, principal, origin, idempotency
   value, exception, callback, page value, selector, screenshot, cookie,
   storage value, prompt, or provider response.
4. Runtime records retain event, outcome, global index, operation ordinal,
   per-operation sequence, normalized action reference, normalized revision
   reference, and a digest chain. Raw surface, revision, action, correlation,
   timestamp, and duration values are not persisted. First-seen transient maps
   create deterministic opaque references and are discarded at finish.
5. Recorder input is synchronous and non-throwing because the lifecycle does
   not await audit sinks. Invalid order, surface mismatch, secret detection,
   or overflow poisons the recorder; finish returns a fixed rejection and
   never presents a truncated trace as complete.
6. Trace records are contiguous and hash chained. Domain-separated SHA-256
   digests cover source identity, previous record digest, ordinal, and complete
   canonical record. Hashes detect accidental corruption only; they are not
   signatures, authentication, or a tamper-proof ledger.
7. A synthetic fixture is pure declarative JSON. It declares environment,
   initial full snapshot, ordered requests, closed policy/confirmation/
   precondition/execution/verification controls, expected lifecycle outcomes,
   authoritative final full snapshot, and a digest over the complete canonical
   fixture except the digest field.
8. Fixture execution controls are either a complete next-snapshot transition
   with bounded JSON output or a package-owned fixed throw. They contain no
   code, import, selector, locator, partial patch, or callback. Credential-risk
   fixture actions and secret-bearing fixtures are rejected.
9. Offline replay always creates a fresh package-owned synthetic backend and
   one `AgentActionLifecycleCoordinator` for the entire fixture. Every step
   calls `performSafe()` so live lifecycle rules for origin, principal, policy,
   confirmation, revision, preconditions, keyed replay/conflict, execution,
   output validation, and effect verification remain active.
10. Replay APIs accept no `AgentSurface`, DOM node, Playwright `Page`, live
    transport, arbitrary backend, handler, policy function, or persisted replay
    cache. Expected results are comparison-only and never drive execution.
11. Descriptor-safe capture precedes schema validation, hashing, or comparison.
    Reject accessors, setters, symbols, sparse arrays, cycles, functions,
    bigint, undefined, non-finite numbers, exotic prototypes, excessive depth,
    properties, strings, bytes, records, steps, nodes, actions, or differences.
    Returned artifacts and results are detached and deeply frozen.
12. Secret scanning is defense in depth, not redaction. Sensitive keys and
    credential/JWT/PEM/private-key/OTP/payment/provider sentinels cause a fixed
    rejection; values are never truncated or replaced with a marker that could
    make a fixture appear valid.
13. Deterministic comparison removes only explicitly excluded top-level noise:
    time, duration, correlation identity, and named environment fields. It
    preserves event, outcome, operation, sequence, revision/action references,
    ordering, policy/confirmation behavior, final state, and digests.
14. Initial limits are 1,024 trace records, 256 operations, 1 MiB per trace,
    128 fixture steps, 32 KiB per synthetic request input/output, 2 MiB per
    fixture, 256 reported differences, and P3.3 snapshot limits. No input is
    silently truncated, evicted, deduplicated, or partially applied.

## Failure classes

Reviewed fixtures must reproduce invalid input, policy denial, confirmation
decline, stale revision, precondition failure, keyed replay conflict, fixed
execution failure, output-validation failure, and verification failure. Each
fixture asserts exact normalized lifecycle order and authoritative final state.

## Consequences

- Runtime traces are useful for lifecycle diagnosis but deliberately cannot
  reproduce an action because they contain no raw request input.
- Synthetic fixtures may contain safe bounded input/output, but only in
  reviewed files that pass schema, digest, secret, and package gates.
- One coordinator per fixture preserves real keyed replay semantics while a
  fresh coordinator per run prevents cross-fixture authority or cache reuse.
- Corrupt, reordered, truncated, cross-surface, wrong-kind, wrong-version,
  oversized, or secret-bearing artifacts fail before any synthetic execution.

## Rejected alternatives

- One generic trace/replay envelope: rejected because schema confusion could
  turn diagnostics into executable input.
- Recording raw values then redacting: rejected because secrets would cross the
  recorder boundary before the control runs.
- Replaying against caller-owned live surfaces: rejected as a policy and
  confused-deputy risk.
- Reconstructing success from expected fixture output: rejected because
  expected data must never control execution.
- Restoring production idempotency caches: rejected because offline replay is
  not a persistent exactly-once guarantee.

