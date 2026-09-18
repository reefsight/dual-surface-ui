# ADR 0003: Redacted Lifecycle Event Boundary

Status: Accepted

Date: 2026-09-18

## Context

The runtime enforces policy, confirmation, preconditions, idempotency, and
effect verification, but hosts cannot observe that lifecycle without wrapping
trusted callbacks or logging unsafe request data. The architecture requires a
small redacted event contract before transport adapters are introduced.

An event API can itself become an exfiltration channel. Action inputs, outputs,
element names, target IDs, principals, origins, policy reasons, exception
messages, and page content may contain personal, credential, or secret data.
Audit delivery must also not create a new way to block or change an action.

## Decision

- Add an opt-in `onAudit` observer and a versioned `AgentAuditEvent` contract.
- Emit `surface_observed`, `action_requested`, `policy_decided`,
  `confirmation_requested`, `action_started`, `action_verified`, and
  `action_failed` at their actual lifecycle boundaries.
- Events contain only schema version, event name, opaque correlation ID,
  surface ID, semantic revision, sequence, timestamp, elapsed duration, a fixed
  outcome, and a catalog-verified action name when available.
- Omit target, input, output, element metadata, principal, origin, policy
  reason, idempotency key/fingerprint, exception details, and stack.
- Public `snapshot()` emits one observation event. Internal snapshots used by
  action execution do not emit observation events.
- One action request uses one correlation ID and monotonically increasing
  sequence. Idempotent replay emits `action_verified` with outcome `replayed`;
  it does not claim that policy or execution ran again.
- Observer failures and rejected observer promises are isolated from action
  behavior. Invocation order is deterministic, but asynchronous sink completion
  is outside the core guarantee.
- Default correlation IDs use `crypto.randomUUID()` with a surface-local opaque
  fallback. A trusted factory may be supplied for host correlation and tests;
  invalid or throwing factories fall back safely.
- Audited surfaces require an opaque URL-safe surface ID rather than the default
  page URL, preventing query strings or fragments from entering event storage.

## Consequences

Positive:

- transports and applications can persist a useful action trace without raw
  request or application data;
- event order mirrors the actual security and execution boundaries;
- observability cannot grant authority or alter action outcomes;
- replay and failure paths are distinguishable without leaking details.

Negative:

- this best-effort observer is not a durable compliance log;
- failures before action resolution omit the action name;
- asynchronous sinks need their own buffering, backpressure, persistence, and
  delivery monitoring;
- fixed outcomes intentionally contain less diagnostic detail.

## Alternatives rejected

1. Log complete requests/results: violates data minimization and secret rules.
2. Let hosts construct events around callbacks: misses internal ordering and
   produces inconsistent semantics.
3. Await audit sinks inline: adds latency and lets an observability outage alter
   the action lifecycle.
4. Emit observation events for internal snapshots: creates noisy unrelated
   correlations and reveals implementation details.
5. Treat replay as a new verified execution: misrepresents what occurred.

## Revisit conditions

Revisit when a transport or regulated integration requires durable delivery,
signed records, actor pseudonyms, or fail-closed audit persistence. Those
features require a separate trust, availability, and retention design.
