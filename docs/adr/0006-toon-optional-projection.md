# ADR 0006: TOON Is an Optional Projection Codec, Not a Core Contract

Status: Proposed

Date: 2026-09-18

## Context

Phase 1 froze the `0.1` TypeScript/JSON/JSON-Schema contract. Its first example
also showed that a small semantic snapshot was 6.8% larger than the fixture DOM
under the original provider-neutral byte estimate. TOON is designed to reduce
LLM context for uniform JSON-shaped records, so it was evaluated as a possible
serialization layer without changing the canonical contract.

The reproducible experiment compared compact JSON, comma-delimited TOON, and
tab-delimited TOON with the `o200k_base` tokenizer. It used the real
document-approval snapshot, the same current snapshot shape scaled 20 times,
and a deliberately uniform action-catalog projection.

## Decision

1. JSON objects and the generated JSON Schemas remain canonical.
2. `@toon-format/toon` is not added to the core package dependency graph.
3. The current nested `AgentSnapshot` is not exported directly as TOON.
4. A future adapter may expose TOON only as an opt-in encoding of a uniform,
   read-only projection derived from an already redacted canonical snapshot.
5. Action input, policy, validation, authorization, confirmation, execution,
   verification, and audit contracts remain strict JSON-domain structures.
6. Redaction happens before serialization. A codec replacer is not a security
   boundary.

## Evidence

| Dataset | Compact JSON tokens | Best TOON tokens | Result |
|---|---:|---:|---:|
| Real document-approval snapshot | 576 | 661 | TOON 14.8% worse |
| Current snapshot shape scaled 20× | 10,423 | 12,047 | TOON 15.6% worse |
| Uniform action-catalog projection | 7,803 | 3,858 | TOON tab 50.6% better |

Strict comma/tab round trips and truncated-array rejection passed. The isolated
dependency audit reported zero known vulnerabilities. Tests also demonstrate
that the encoder preserves a supplied secret sentinel, confirming that TOON
does not replace Dual Surface UI's redaction controls.

## Consequences

- The Phase 1 compatibility surface and published-package contents stay
  unchanged.
- Consumers do not pay a dependency or parsing cost unless a later optional
  adapter is approved.
- Uniform catalogs may gain substantial context savings, but they add a second
  representation that requires parity, drift, model-accuracy, and security
  tests.
- The experiment remains under `experiments/toon-codec/` and does not count as
  a Phase 2 deliverable.

## Adoption gate for a future adapter

A production adapter requires maintainer approval plus representative evidence
of at least 15% median token reduction versus compact JSON, lossless strict
round trips, no secret or authority expansion, no material task-accuracy loss,
acceptable latency, and parity with the canonical snapshot. The current
uniform projection meets only the token and round-trip portions of that gate.

## Rejected alternatives

- Replace the canonical JSON contract with TOON: rejected because it would
  break the frozen contract and reduce standards/tool interoperability.
- Add TOON as a core runtime dependency immediately: rejected because the
  current snapshot is larger in TOON and no consumer requires it yet.
- Treat TOON's replacer as redaction: rejected because unknown sensitive fields
  would still serialize unless independently classified.
