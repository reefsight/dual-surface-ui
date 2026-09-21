# ADR 0014: P3.9 Uses a Frozen Comparable Benchmark Method

Status: Accepted for P3.9 preparation on 2026-09-21

## Decision

P3.9 will compare the same frozen P3.8 synthetic task IDs across four
observation surfaces: Dual Surface semantic snapshot, full-page DOM, managed
Playwright accessibility snapshot, and vision/screenshot fallback. The task
set, model/configuration, repetitions, warmup, timeout, retry policy, and
outlier rule are frozen before any measured run. A failed or unavailable
provider run is reported separately and cannot be scored as a refusal or
success.

Metrics are recorded per task and baseline: completion, wrong action, safety,
interaction steps, fallback use, serialized bytes, context-token source, and
p50/p95 latency. Exact provider usage or an explicitly versioned tokenizer is
required for token claims; byte estimates are labeled estimates and cannot
satisfy the token gate. Managed browser revisions are recorded separately from
installed browser/OS proof.

Native feasibility is evidence review only. It covers schema portability,
backend-neutral lifecycle, delta/trace suitability, security boundaries,
measured budgets, packaging, and known real-OS gaps. It cannot select Rust,
.NET, Swift, or a native implementation, and it cannot claim Windows/macOS
accessibility, secure-desktop, permissions, daemon, signing, or distribution
support without direct proof.

## Gate state

The method is frozen, but P3.8 actual model authorization and comparable
vision-token accounting are not available. Therefore P3.9 performance targets
and the native recommendation remain open.
