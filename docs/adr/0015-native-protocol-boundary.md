# ADR 0015: Language-Neutral Native Protocol Boundary

Status: Accepted for P4.1 implementation on 2026-09-22

Date: 2026-09-22

## Context

Phase 3 proved the web contract, exporter conformance, replay behavior,
adversarial controls, model quality, and efficiency sufficiently to enter
native protocol work. Phase 4 must map Windows UI Automation and macOS
Accessibility into equivalent semantics without embedding either platform or
an implementation language in the public contract.

The maintainer prefers Rust for a possible native bridge, but requested that
the original evidence-based language decision remain in force. P4.1 therefore
freezes protocol semantics and cross-language fixtures before choosing the
native runtime language.

## Decision

1. Define a versioned JSON protocol whose normative contracts are JSON Schema
   2020-12 documents and reviewed prose. JSON values, UTF-8, identifier
   patterns, size limits, and message semantics are authoritative; language
   types are generated or checked projections.
2. Place native protocol schemas in a separate additive namespace. Do not
   modify the frozen Phase 1 root schemas or exports.
3. Use strict tagged message envelopes for handshake, surface discovery,
   snapshot, delta, action execution, cancellation, event, success, and error
   messages. Unknown message kinds, fields, versions, capabilities, and enum
   values fail closed unless an accepted compatibility rule explicitly permits
   them.
4. Require protocol negotiation before any surface discovery. The server
   chooses one mutually supported protocol version and an explicit capability
   set; no overlap closes the session without exposing a catalog.
5. Treat transport authentication as a prerequisite supplied by the native
   host. Protocol messages carry only opaque server-minted session and surface
   references; client claims, process IDs, window handles, usernames, or model
   metadata never establish authority.
6. Bind every mutable request to the authenticated OS user/session, native
   process/window identity, surface reference, current revision, action, risk,
   and policy scope inside trusted host state. Callers cannot override those
   bindings in action arguments.
7. Reuse the existing snapshot, delta, action outcome, stable error,
   idempotency, confirmation, precondition, effect-verification, redaction, and
   audit semantics. Platform metadata is an explicitly bounded extension and
   cannot weaken core behavior.
8. Use canonical JSON only for fixture digests, catalog identities, signing
   inputs, and reproducibility. Ordinary wire parsing does not depend on source
   key order, whitespace, or any serializer's formatting.
9. Maintain an independent TypeScript schema validator and golden-fixture
   verifier during P4.1. A later Rust, .NET, Swift, or other implementation
   must receive the same disposition for every frozen fixture.
10. Keep transports outside P4.1. Named pipes, Unix-domain sockets, launch
    agents/services, credential acquisition, remote access, and daemon
    lifecycle belong to later threat-modeled work items.
11. Retain the original Rust decision gate. Rust is preferred, but selection
    requires measured latency, memory, startup, isolation, binding maturity,
    packaging, signing, update, security, and contributor-cost evidence.

## Initial protocol budgets

- protocol version, request ID, session reference, surface reference, element
  ID, action name, capability, and idempotency key: at most 128 characters;
- one frame and a full snapshot response: at most 1 MiB UTF-8 JSON;
- delta response: at most 512 KiB;
- action result: at most 256 KiB;
- error message: stable package-owned text, at most 500 characters;
- catalog entries: at most 128 surfaces and 128 actions per surface;
- nesting and JSON-node limits: no weaker than the existing portable-schema
  limits.

These are upper safety bounds, not performance targets. Tighter measured
budgets may be accepted later without changing semantic meaning.

## Compatibility rules

- protocol `0.x` versions require exact negotiated minor compatibility;
- a client never sends a request before successful negotiation;
- capabilities are server-selected from the intersection and immutable for a
  session;
- unknown required capability, message kind, or schema version fails closed;
- additive optional fields require a new accepted schema and fixture before
  use; `additionalProperties` remains `false` in frozen messages;
- reconnect creates a new session reference and invalidates prior session-bound
  surfaces, revisions, confirmations, and replay scope;
- protocol upgrade and downgrade fixtures are mandatory before a second
  version can be supported.

## Security consequences

- A valid message is not authorization. Authentication, OS consent, current
  process/window identity, policy, and confirmation are rechecked at execution.
- Password, credential, secure-desktop, permission-dialog, hidden, and
  unsupported controls never expose values and fail closed for mutation.
- Cancellation is best effort before mutation; an observed cancellation cannot
  turn an already committed mutation into a false failure. Final outcome and
  authoritative state remain explicit.
- Raw OS handles, selectors, accessibility object addresses, stack traces,
  prompts, application text, and signing credentials do not cross error or
  audit boundaries.
- Local-only transport is the default. Remote exposure requires a new threat
  model and explicit maintainer approval.

## Rejected alternatives

- Migrating the existing TypeScript web SDK to Rust: rejected because it adds
  compatibility and integration cost without addressing a measured web gap.
- Rust ABI, `bincode`, .NET types, or Swift types as the public protocol:
  rejected because clients and long-term compatibility would be coupled to an
  implementation.
- Protobuf before message semantics are proven: deferred; it adds a second
  schema/migration system without evidence that JSON budgets fail.
- Platform-specific Windows messages first: rejected because macOS parity
  would become a retrofit rather than a conformance target.
- C or assembly implementation: rejected absent a separately demonstrated and
  reviewed binding requirement.

## References

- [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12)
- [RFC 8259 — The JavaScript Object Notation Data Interchange Format](https://www.rfc-editor.org/rfc/rfc8259)
- [RFC 8785 — JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785)
