# Dual Surface UI — Master Plan

Status: **Phase 1 accepted; Phase 2 in progress**

Implementation status: the current code is an exploratory prototype only. It
must not be treated as a stable API or a completed phase.

Dual Surface UI is a standards-first compatibility and safety framework that
turns existing applications into reliable agent interfaces without replacing
the human interface. The project compiles application semantics into compact
snapshots and typed actions, then exports them through WebMCP, MCP, browser
automation, and eventually native accessibility APIs.

## Goal

Enable an AI agent to understand and operate an application through explicit,
testable business actions instead of guessing from pixels or implementation
details, while keeping the visible human UI and its state authoritative.

## Non-negotiable principles

1. One application state, two representations. There is no hidden second UI.
2. Standards first. Extend WebMCP, MCP, ARIA, and native accessibility APIs;
   do not invent a competing transport without an approved ADR.
3. Fail closed. Unknown, stale, unauthorized, or invalid actions do not run.
4. Secrets never enter snapshots, logs, traces, fixtures, or model context.
5. Business actions are preferred over raw clicks; vision is a fallback.
6. Every action is discoverable, authorized, executed, verified, and audited.
7. Web product validation comes before native or low-level optimization.

## Required execution order

| Phase | Name | Outcome | Start gate |
|---|---|---|---|
| 1 | Core contract | Stable schema, policy model, DOM reference adapter | Gate 0 accepted |
| 2 | Web standards | WebMCP export and framework integrations | Phase 1 exit passed |
| 3 | Ecosystem and reliability | MCP, Playwright fallback, CLI, evals, replay | Phase 2 exit passed |
| 4 | Native surfaces | Windows first, then macOS; Rust only after decision gate | Phase 3 exit passed |

No phase may silently absorb unfinished work from a later phase. Experimental
spikes are allowed only under `experiments/` and do not count as deliverables.

## Documentation map

- [Documentation index](docs/README.md)
- [Vision, users, goals, and success metrics](docs/01-vision-goals.md)
- [Product scope and positioning](docs/02-product-scope.md)
- [Target architecture and contracts](docs/03-architecture.md)
- [Four-phase execution roadmap](docs/04-roadmap.md)
- [AI-assisted SDLC](docs/AI_SDLC.md)
- [Security and trust model](docs/SECURITY.md)
- [Testing and agent evaluations](docs/TESTING_AND_EVALS.md)
- [Native and low-level language strategy](docs/NATIVE_STRATEGY.md)
- [Contribution and release workflow](docs/WORKFLOW.md)
- [ADR 0001: standards-first architecture](docs/adr/0001-standards-first.md)

## Gate 0 completion checklist

- [x] Product goal and non-goals are written.
- [x] Competitive position and standards relationship are explicit.
- [x] Target architecture and package boundaries are defined.
- [x] Security model is defined before new action execution code.
- [x] Test and evaluation strategy is defined.
- [x] Web-to-native sequence and Rust decision criteria are defined.
- [x] Phase 1–4 deliverables and exit criteria are defined.
- [x] AI-SDLC artifacts and approval gates are defined.
- [x] Maintainer approved Gate 0 and authorized Phase 1 implementation on
  2026-09-18.

## Current decision

Do not publish the exploratory package during Phase 1. P1.1 froze the core
schema and fixtures; P1.2 added stable identity, revision safety, and action
results; P1.3 added runtime input validation and stable error codes; P1.4 adds
the deterministic policy and trusted-confirmation boundary; P1.5 added
execution-time preconditions and authoritative effect verification; P1.6 added
the validated JSON handler-output contract; P1.7 added bounded keyed replay
protection without retaining raw action input; P1.8–P1.11 completed structured
failures, redacted lifecycle events, DOM conformance, and the example baseline.
P1.12 verified the frozen contract, security evidence, clean installation,
package consumer, and all 134 tests. The maintainer accepted the Phase 1 exit
gate on 2026-09-18 and authorized Phase 2. P2.1 starts with the imperative
WebMCP exporter. Its allowlisted adapter, lifecycle, tests, and package subpath
are implemented and pass automated gates; the current Chrome installation does
not expose the experimental API, so supported-browser Inspector/manual proof
remains open. P2.2 added reversible declarative form annotations, conservative
capability diagnostics, and an explicit no-synthetic-polyfill decision; its
automated gates pass while supported-browser proof remains open for the same
environment reason. P2.3 is implemented and verified as a thin React
provider/ref lifecycle boundary across React 18.2 consumer and React 19.3
StrictMode/SSR tests. P2.4 is implemented and verified as a thin Angular
provider/directive lifecycle boundary with zoneless and SSR tests, partial-Ivy
output, isolated root installation, and Angular 20/22 packed-consumer AOT
builds. Browser hydration proof remains explicitly pending and no hydration
compatibility is claimed. P2.5 is implemented and verified as an additive Vue
3.3–3.5 plugin/composable boundary with lifecycle and `KeepAlive` cleanup,
real Node SSR, SSR-to-client hydration, isolated root installation, and packed
Vue 3.3.13/3.5.43 SFC production builds. P2.6 added the strict additive
`dual-surface-ui/domain` compiler, one-pass trusted metadata capture, explicit
WebMCP allowlists, shared portable-schema hardening, strict compile-time schema
preflight, adversarial tests, and packed-consumer proof. Its full gate passes
20 files and 224 tests while preserving the frozen 32/6/5 root contract.
P2.7 is implemented and verified as the additive `dual-surface-ui/drift`
checker: it authenticates a separately reviewed/pinned manifest, compares
bounded same-epoch DOM, snapshot, permission, application-state, declared-tool,
and exporter registration evidence, and fails closed for missing, stale,
rebound, mixed-generation, nested-surface, or unrepresentable evidence. Its
full gate passes 21 files and 252 tests, the frozen 32/6/5 root contract remains
unchanged, audit reports zero vulnerabilities, and a packed consumer imports
the root and drift entry points with optional framework peers omitted.
Independent security and API/package review found no actionable blocker.
P2.8 adds runnable checkout, document-approval, and migrated legacy-form
workflows whose human and agent paths share authoritative business commands.
The examples invoke actual exported WebMCP tools and cover trusted policy,
confirmation, preconditions, effect verification, stale revisions, keyed
replay, aggregate secret exclusion, pinned semantic-drift evidence, and legacy
submit-bypass prevention. Its full gate passes 23 files and 288 tests while
preserving the frozen 32/6/5 root contract; package audit, inspection, and a
fresh optional-peer-free root/domain/WebMCP/drift consumer also pass. P2.9 is
next: browser support, Inspector/manual invocation, navigation/iframe and
graceful-fallback evidence required by the Phase 2 exit gate.
