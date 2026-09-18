# Vision, Goals, and Success Metrics

Status: Accepted at Gate 0 on 2026-09-18

## Problem

Human interfaces optimize for visual comprehension. General browser agents
must reconstruct meaning from screenshots, noisy DOM trees, or accessibility
trees. This is expensive and ambiguous: a button named “Confirm” does not tell
an agent the business operation, prerequisites, side effects, reversibility,
or required consent.

Applications can expose tools directly, but existing systems need a migration
path, consistent safety policy, test tooling, and compatibility across agent
transports. Maintaining a separate “AI page” is not acceptable because it can
drift from the human-visible state.

## Product vision

Any application can expose a compact, typed, permission-aware agent interface
derived from the same state the user sees. Developers annotate business intent
once and export it to current and future agent standards.

## Primary users

1. Web teams adding agent capability to an existing application.
2. Enterprise teams that require authorization, audit, redaction, and policy.
3. Agent builders who need deterministic actions and compact state.
4. QA teams testing parity between human and agent interaction paths.
5. Later: native application teams using platform accessibility trees.

## Goals

- Compile DOM, accessibility semantics, and domain annotations into a versioned
  agent contract.
- Express business actions with schemas, preconditions, effects, risk, and
  verification rules.
- Export compatible WebMCP and MCP tools without coupling application code to
  a single model provider.
- Support legacy pages progressively; an application can adopt one workflow at
  a time.
- Detect human-view/agent-view drift in CI.
- Minimize model tokens and UI-guessing steps.
- Provide an auditable action lifecycle and safe human confirmation points.
- Reuse the same core contract for browser and native adapters.

## Non-goals

- Building an autonomous general-purpose agent or foundation model.
- Replacing WebMCP, MCP, WAI-ARIA, Playwright, or OS accessibility APIs.
- Bypassing authentication, authorization, CAPTCHAs, or user consent.
- Exposing hidden backend operations unavailable to the current user.
- Promising pixel-perfect understanding of canvas, video, maps, or games.
- Using AI to decide security policy at runtime.
- Maintaining an independent AI-only copy of application state.

## Product success metrics

Measured against the same representative workflows and model configuration:

| Metric | Phase 1 baseline | Target by Phase 3 |
|---|---:|---:|
| Task completion success | Recorded | >= 95% for supported golden tasks |
| Median agent interaction steps | Recorded | >= 40% reduction vs DOM/vision fallback |
| Median context tokens | Recorded | >= 60% reduction vs full-page snapshot |
| Wrong-action rate | Recorded | < 1% in supported golden tasks |
| Unauthorized consequential actions | 0 | 0 |
| Secret values in snapshots/traces | 0 | 0 |
| Human/agent state drift detected in CI | Required | Required |
| Supported package upgrade regressions | Recorded | 0 unapproved breaking regressions |

Targets are release gates only after the benchmark fixtures and measurement
method are frozen. Numbers may not be improved by removing failing scenarios.

## North-star workflow

A user asks an agent to approve a document. The agent discovers
`approve_document`, sees that required widgets must be complete, supplies a
comment conforming to the schema, receives a confirmation request because the
action is consequential, executes under the user's existing authorization,
and verifies the resulting document status. The user sees the same state
change in the normal UI and the audit record explains the complete decision.
