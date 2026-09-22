# ADR 0016: Controlled Windows Fixture Application Boundary

Status: Proposed; P4.1 accepted, awaiting explicit maintainer acceptance before
P4.2 source implementation or SDK installation

Date: 2026-09-22

## Context

Phase 4 requires real operating-system accessibility evidence before a Windows
adapter can claim conformance. A mock tree cannot prove Microsoft UI Automation
provider behavior, control patterns, events, process/window replacement, or
sensitive-control handling. The fixture must also avoid deciding the language
of the future native bridge before the roadmap's Rust decision gate.

P4.1 was accepted on 2026-09-22 with a passing canonical independent-review
record. The current evidence host is Windows 11 Pro build 26200 x64 and has UI
Automation Core plus Windows Desktop runtimes 8.0.28, 9.0.17, and 10.0.9. It
does not currently have a .NET SDK, `rustc`, or `cargo`. This is environment
preflight only and does not authorize toolchain installation.

## Proposed decision

1. Build the controlled Windows test subject as a minimal WPF application after
   P4.1 approval and explicit acceptance of this ADR.
2. WPF is selected only as the fixture's accessibility provider because it
   exposes mature Windows UI Automation peers and control patterns. This does
   not select .NET for the adapter, daemon, protocol client, or product runtime.
3. Keep fixture source, manifests, capture tooling, and golden evidence outside
   the npm package boundary. Never commit compiled binaries or SDK caches.
4. Assign stable fixture IDs in source. Runtime PID, HWND, pointer, object
   address, localized label, or tree position never becomes semantic identity.
5. Write authoritative synthetic state to a host-created per-run evidence
   directory using a bounded versioned JSON record. Do not open a listener or
   production control channel.
6. Capture the raw tree through real Microsoft UI Automation APIs independently
   from the future adapter. Normalize a separate expected core snapshot for
   review; do not treat the expected snapshot as captured truth.
7. Include deterministic control-pattern, sensitive, unsupported, replacement,
   modal, event, injection-text, and resource-boundary scenarios.
8. Require repeatable real-host evidence and independent accessibility/security/
   interoperability/package review before accepting P4.2.

## Why this does not weaken the Rust preference

The fixture application is the external system under test, not the native
bridge. Choosing a framework with a stable built-in UI Automation provider
reduces fixture ambiguity and lets Rust, .NET, or another future adapter read
the same OS tree. Rust remains the maintainer's preferred bridge outcome and is
evaluated later using measured adapter performance, isolation, binding,
packaging, signing, and maintenance evidence.

## Alternatives

- Rust GUI fixture: deferred because framework accessibility-provider behavior
  would become part of the variable being tested and the Rust toolchain is not
  present on the evidence host.
- Win32 custom controls: rejected for the initial fixture because hand-authored
  providers add COM/native complexity before basic pattern evidence exists.
- Electron/browser fixture: rejected because it would mostly retest browser
  accessibility rather than representative desktop provider behavior.
- Mock accessibility tree only: rejected because it is not native proof.
- Production application capture: prohibited because it is nondeterministic and
  risks user/private data.

## Consequences

- P4.2 needs a reviewed .NET SDK installation or an isolated build environment
  after its entry gate passes.
- Windows adapter implementation remains free to use Rust if the later decision
  gate accepts it.
- Golden evidence distinguishes raw provider output, expected normalized
  semantics, and fixture-owned authoritative state.
- macOS requires a separate fixture/host decision after Windows conformance.
