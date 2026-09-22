# ADR 0019: Authenticated Local Native Host Boundary

Status: Proposed; blocked on P4.4 runtime selection

Date: 2026-09-22

## Context

The native adapter owns powerful accessibility capabilities. A process that
accepts unauthenticated local messages, trusts caller identity fields, listens
remotely, or runs elevated would create a confused deputy even when protocol
messages are schema-valid.

## Proposed decision

1. Run one least-privilege host per interactive OS user/session by default.
2. Use only an OS-local IPC mechanism with restrictive endpoint permissions and
   authoritative peer credentials: Windows named-pipe identity/token checks and
   macOS Unix-domain peer/audit identity, subject to implementation review.
3. Bind a fresh challenge to peer identity, endpoint instance, protocol version,
   and session generation before creating a protocol session.
4. Keep authentication outside protocol 0.1 messages while requiring it before
   `client-hello`; unauthenticated peers receive no catalog/session information.
5. Mint all session/surface/element/replay authority inside the host and recheck
   trusted bindings, permission, policy, and confirmation before mutation.
6. Prohibit TCP/HTTP/WebSocket, remote forwarding, static bearer files, caller
   identity claims, elevation-by-default, shell, memory, and generic input injection.
7. Bound connections, frames, queues, work, events, audits, time, and memory;
   overload is a stable fail-closed result, not unbounded buffering.
8. Isolate adapters and inherited capabilities according to the P4.4 selected
   runtime; crashes invalidate the endpoint generation and uncertain state.
9. Require signed development artifacts, SBOM/provenance, compatibility checks,
   atomic replacement, last-known-good rollback, and exact-target uninstall
   before any distribution approval.
10. Keep binaries and signing material outside npm and the repository.

## Consequences

- Schema validity remains separate from authentication and authorization.
- Restart/reconnect is intentionally disruptive to stale references.
- Platform-specific peer-credential code stays behind one reviewed host boundary.
- Public/remote control would need a new threat model, protocol, authentication,
  authorization, privacy, abuse, and operations review.

## Rejected alternatives

- Loopback TCP as “local”: rejected because it expands exposure and peer identity ambiguity.
- Static API key in a file/environment: rejected because distribution, rotation, and leakage risks are unnecessary for same-user IPC.
- System-wide elevated service: rejected absent a demonstrated cross-user requirement.
- Trusting PID/username from the request: rejected as caller-controlled authority.
- Shipping the host inside the npm tarball: rejected by package and platform boundaries.
