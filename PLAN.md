# Dual Surface UI — Master Plan

Status: **Gate 0 accepted; Phase 1 in progress**

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
the deterministic policy and trusted-confirmation boundary; P1.5 adds
execution-time preconditions and authoritative effect verification.
Later-phase deliverables remain out of scope until the Phase 1 exit gate passes.
