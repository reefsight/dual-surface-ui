# Controlled Windows fixture — P4.2

This development test subject exposes synthetic WPF controls to real Microsoft
UI Automation. Its capture process launches and inspects only its own fixture
child. The frozen protocol 0.1 and npm runtime do not depend on this directory.

## Run

From the repository root with PowerShell 7 and Node dependencies installed:

```powershell
npm run native:fixture:setup
npm run native:fixture:run
npm run native:fixture:verify -- <evidence-directory>
```

The setup caches the Microsoft SDK `10.0.401` ZIP in the ignored `.tools/`
directory and verifies its SHA-512 against pinned official release metadata.
It extracts the SDK into the current user's temporary directory under the
fixed `dual-surface-ui-dotnet-10.0.401` folder, then records a ready marker only
after successful extraction and version verification. This is
Microsoft's manual installation method for a local build environment. It
requires no system installer, PATH change, registry change, or administrator
elevation. See [Microsoft's manual installation documentation](https://learn.microsoft.com/en-us/dotnet/core/install/windows#manual-install).

The runner builds both projects and performs two clean launches under the
current user's temporary `dual-surface-ui-native-evidence` directory. Historical
workspace runs remain in ignored `.native-evidence/`. This separation avoids
writing active state into the repository; no access-control or security setting
is changed. The application has a three-minute
lifetime limit; the capture process owns its launch, teardown, and restart.
Failed output remains available for diagnosis and is never treated as passing
evidence.

## Evidence model

- `manifest-0.1.json` fixes control identity, inert names, expected types,
  required provider patterns, semantic actions, and resource budgets.
- `Fixture` writes its synthetic state independently of the UIA reader with
  bounded atomic publication of immutable versioned records. It generates a sensitive challenge in
  memory and records presence only.
- `Capture` records a bounded projection of provider properties and real
  pattern operations. Password values and event payload values are never read.
  Process/window/runtime IDs are hashed with an unpersisted per-run random salt.
- `verify-p4.2-fixture.mjs` validates the artifact, compares provider state to
  fixture-owned state, maps fixed control definitions to core snapshots, and
  checks repeatability across the two runs.

Normalized snapshot timestamps are fixed to `2000-01-01T00:00:00.000Z` solely
for golden comparison. Process/window/element hashes, focus, display metadata,
asynchronous event timing, old-provider availability, and its diagnostic probe
are retained and verified in raw captures and excluded from
the semantics digest. Provider identity changes must still be verified within
each real run.

A removed WPF button peer may remain callable even though it no longer belongs
to the current window tree. The capture records a synthetic stale-call probe
as `unavailable` or `retained_callable`, then restores the scenario. Neither
outcome authorizes a future adapter to call a retained binding: current tree
membership and revision must invalidate it before mutation. This fixture is
not an implementation of that adapter guard.

Likewise, old window metadata can remain readable after the window closes.
The real run verifies native window destruction with `IsWindow` (without
persisting the handle), records the metadata outcome, and requires a distinct
current window identity. The clipped button uses the framework's documented
`IsOffscreenBehavior.FromClip`, not a hard-coded off-screen flag.

Reset completion uses a separate bounded, atomic `reset-ack-0000.json` sequence;
revision zero alone cannot acknowledge an asynchronous Invoke. Reads allow
delete-sharing. A writer publishes each new `state-0000.json` / reset record
under a new monotonic filename, never replacing an open destination. Readers
choose the latest complete published version. A run holds at most 512 records,
each at most 4096 bytes; acknowledgement reads have a 256-byte limit. The
private file sequence survives window/process restart but is never a public
control ID or protocol revision.
Unexpected dispatcher failures shut down the fixture and retain only a closed
failure category (`io_sharing`, `io_other`, `access`, or `unexpected`), never a
raw exception, stack, or file path.

## Proposed golden freeze

After committing and reviewing fixture source, rerun the real capture against
that exact source before freezing:

```powershell
npm run native:fixture:run
npm run native:fixture:verify -- <evidence-directory>
npm run native:fixture:goldens:freeze -- <evidence-directory>
npm run native:fixture:goldens:check
```

The freeze refuses dirty fixture sources and an existing golden file. Its
proposed artifact retains both bounded raw reports, their normalized cases,
source commit/blob bindings, capture-binary digest, host metadata, and artifact
digests. Verification detects raw/normalized/source drift. `proposed` is not
an independent approval; the tool cannot accept an `approvedBy` field or mark
P4.2 accepted. A new expected format requires versioning and review, not silent
overwriting of an existing golden.

Completion requires the P4.2 work item's real-host, regression, package, and
independent review gates. Unit tests alone do not establish provider evidence.
