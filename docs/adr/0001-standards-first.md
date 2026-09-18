# ADR 0001: Standards-First Agent Interface Architecture

Status: Accepted

Date: 2026-09-18

## Context

The exploratory prototype can derive a semantic DOM snapshot and execute typed
actions. The market already includes accessibility snapshots, Playwright MCP,
WebMCP, MCP, and AI browser automation. A proprietary competing protocol would
increase adoption cost and drift as standards evolve.

## Decision

Build a compatibility, safety, conformance, and migration layer above existing
standards:

- WAI-ARIA and platform accessibility APIs supply base semantics.
- WebMCP is the primary browser-native structured action export.
- MCP is the cross-platform transport export.
- Playwright/vision are policy-governed fallbacks.
- A small versioned core contract represents semantics shared across exports.
- The application remains the authority for state and business rules.

The project will not create a separate AI-only page or duplicate backend
business logic in action handlers.

## Consequences

Positive:

- lower adoption friction and better ecosystem compatibility;
- one annotation can serve several transports;
- security and tests can be shared across adapters;
- the project differentiates on migration, policy, drift, and evaluation.

Negative:

- experimental standards may change and require compatibility layers;
- common-denominator contracts can hide platform-specific capability;
- exporter conformance creates ongoing maintenance work.

## Alternatives rejected

1. Screenshot-only agent UI: too ambiguous and expensive as the primary path.
2. Separate hidden AI page: creates state, permission, and behavior drift.
3. Proprietary transport: duplicates WebMCP/MCP and raises integration cost.
4. Rust-first rewrite: optimizes before product and performance evidence exists.

## Revisit conditions

Revisit if WebMCP or MCP cannot express a required, proven production workflow;
if standard evolution makes a compatibility layer impossible; or if measured
native constraints justify a different core representation. Revisions require
a superseding ADR and migration plan.
