# Phase 4 Execution Authorization

Status: Accepted by repository maintainer on 2026-09-22

Decision owner: Repository maintainer

## Decision

The repository maintainer authorized Phase 4 execution through preparation of
the Phase 4 Exit Gate under the original roadmap and native-language decision
gate. Rust is the maintainer's preferred outcome, but it is not selected before
the required comparative evidence exists.

The first authorized work item is P4.1: freeze a language-neutral native
protocol before implementing any Windows UI Automation or macOS Accessibility
adapter. No implementation language, ABI, enum layout, pointer, platform
handle, or serializer default may become the public protocol contract.

## Required sequence

1. P4.1 freezes the language-neutral protocol, schemas, compatibility rules,
   golden fixtures, threat boundary, and implementation-independent verifier.
2. A controlled native fixture application and reviewed golden accessibility
   trees are created before platform claims.
3. A Windows UI Automation adapter is implemented and verified on a real
   supported Windows host.
4. The Rust decision gate compares viable approaches using latency, memory,
   startup, isolation, binding maturity, packaging, signing, update, security,
   and contributor-maintenance evidence. Maintainer preference for Rust is
   recorded, but measurement remains authoritative.
5. The macOS Accessibility adapter begins only after Windows conformance
   validates the platform-neutral contract and a real macOS host is available.
6. Cross-platform conformance, performance, package, and independent security
   gates pass before the Phase 4 Exit Review is proposed.

## Boundaries

- Phase 4 Gate approval remains a separate maintainer decision.
- The TypeScript web SDK, frozen Phase 1 root contract, framework adapters,
  MCP, WebMCP, and Playwright boundaries remain unchanged; no whole-project
  Rust migration is authorized.
- A Rust experiment may be built under `experiments/` but cannot satisfy a
  deliverable until the decision gate accepts it and all required evidence is
  rerun against the selected implementation.
- C is permitted only for a narrowly reviewed binding unavailable through a
  maintained safer interface. Assembly requires a separate ADR.
- Remote daemon exposure, mobile adapters, package publication, release tags,
  production deployment, signing credentials, and production/user data are
  not authorized.
- Unit or mock tests are not native proof. Windows and macOS claims require
  real OS accessibility APIs, permission behavior, authoritative fixture state,
  and recorded OS/API versions.

