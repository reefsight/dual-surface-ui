# ADR 0012: Cross-Exporter Conformance Uses a Private Authoritative-State Harness

Status: Accepted for P3.6 implementation on 2026-09-20

Date: 2026-09-20

## Context

DOM, WebMCP, MCP, and Playwright can expose the same core action through
different transport shapes. A successful callback, tool call, protocol
response, browser command, or screenshot does not prove that those paths
preserved the same authorization, lifecycle, failure, replay, redaction, and
application-state semantics.

P3.6 needs one deterministic corpus and oracle without changing the frozen
Phase 1 root contract or turning test drivers into a second implementation of
business rules. Exporter projections, protocol metadata, page content, browser
state, and driver output remain untrusted. Reviewed scenario definitions and a
harness-owned authoritative fixture-state reader are trusted test assets.

## Decision

### Private boundary and targets

1. P3.6 is private test and evidence infrastructure. It adds no root export,
   package subpath, CLI command, runtime dependency, or packed conformance
   schema. The Phase 1 freeze remains 32 root runtime exports, six reachable
   declaration files, and five schemas. Publishing a reusable conformance API
   requires a separate package/API review.
2. The private harness compares these exact target identities:

   | Target | Family | Evidence tier |
   |---|---|---|
   | `dom-jsdom` | DOM | `in-process` |
   | `webmcp-compat` | WebMCP | `compatibility` |
   | `webmcp-native` | WebMCP | `native-webmcp` |
   | `mcp-sdk` | MCP | `protocol` |
   | `playwright-managed` | Playwright | `managed-engine` |

   Compatibility evidence never claims native WebMCP coverage. Native WebMCP
   unavailability is run-level environment evidence, not a semantic skip or a
   compatibility pass. Managed Playwright evidence names the browser and
   browser version used by the run.
3. TypeScript contracts and implementations live under `test/conformance/`.
   Versioned scenario, capability-matrix, and report schemas live under
   `fixtures/conformance/contracts/`. Neither directory is emitted to `dist`
   or included in the npm tarball.

The private TypeScript boundary has exactly five target identifiers and three
roles. The harness alone retains `ConformanceFixtureExecution`, including its
`readAuthoritativeState()` and `dispose()` capabilities. A
`ConformanceDriver` owns immutable `targetId`, `family`, and `tier`, but its
`run()` method receives only a separately captured, detached, recursively
frozen `{ scenarioId, driverInput }` value plus an `AbortSignal`; its result is
always `unknown`. No execution object, oracle function, cleanup function, host
object, closure, symbol, getter, prototype capability, or mutable alias crosses
the driver boundary. `NormalizedConformanceObservation` contains only
normalized discovery, ordered outcomes, ordered lifecycle, and
`finalStateDigest`. The harness owns capture, validation, cancellation,
cleanup, normalization, comparison, and report construction.

### Canonical scenarios and fixed capability matrix

4. An `agent-conformance-scenario` version `0.1` is strict declarative JSON. It
   contains a stable scenario ID, one capability ID, explicit permitted and
   forbidden action inventory, bounded initial authoritative state, ordered
   requests, expected normalized discovery, outcomes and lifecycle, expected
   final authoritative state, and a scenario digest. It contains no function,
   import, selector, locator, screenshot, model output, policy callback, or
   executable code.
   Its exact top-level fields are `schemaVersion`, `kind`, `scenarioId`,
   `capability`, `actions`, `initialState`, `requests`,
   `sentinelInjections`, `expected`, and `scenarioDigest`. Each action contains
   only `ref`, `elementId`, `action`, and `disposition`. `expected` contains
   only `discovery`, `outcomes`, `lifecycle`, `finalState`, and the
   conditionally permitted `perTargetOverrides`. `sentinelInjections` is an
   ordered list of reviewed injection declarations; each contains only the
   exact trusted channel (`fixture_host_input` or `authoritative_state`),
   opaque `sentinelId`, sentinel digest, and positive expected count. The
   scenario digest binds the complete declarations but never stores secret
   sentinel bytes outside their reviewed injection location.
5. Expected discovery, outcomes, lifecycle, and final state are comparison-only
   data. Drivers and fixture business logic must not read expected fields to
   choose execution behavior or manufacture a result. A shared fixture host
   owns the business transition and gives the harness a separate
   `readAuthoritativeState()` boundary after execution.
   Before calling the fixture host, the harness separately captures and deeply
   freezes an execution plan containing exactly `scenarioId`, `actions`,
   `initialState`, and `requests`. The plan is newly allocated and shares no
   object, array, buffer, view, closure, or mutable alias with the captured
   scenario. The fixture host receives only that execution plan: never
   `expected`, `perTargetOverrides`, expected digests, comparison objects, or
   the original scenario.
6. The `0.1` matrix freezes these 26 cases:

   | Case | Required semantic assertion |
   |---|---|
   | `DISC-01` | required action is discoverable |
   | `DISC-02` | risk, confirmation, idempotency, and schema projection match |
   | `SUCCESS-01` | permitted mutation succeeds and reaches authoritative state |
   | `SUCCESS-02` | declared output is normalized without becoming the state oracle |
   | `INVALID-01` | invalid input is rejected before execution |
   | `STALE-01` | a stale revision is rejected |
   | `REPLACED-01` | a replaced target cannot authorize the old target |
   | `DENY-01` | policy denial prevents execution |
   | `CONFIRM-01` | trusted confirmation permits the action |
   | `CONFIRM-02` | absent or declined confirmation prevents execution |
   | `PRE-01` | satisfied preconditions permit execution |
   | `PRE-02` | failed preconditions prevent execution |
   | `VERIFY-01` | verified effects commit the success result |
   | `VERIFY-02` | failed effect verification returns the normalized failure |
   | `REPLAY-01` | an identical keyed retry replays without a second mutation |
   | `CONFLICT-01` | a conflicting keyed retry is rejected |
   | `ORIGIN-01` | origin isolation prevents cross-origin authority reuse |
   | `PRINCIPAL-01` | principal isolation prevents cross-principal authority reuse |
   | `SURFACE-01` | surface isolation prevents cross-surface authority reuse |
   | `CANCEL-01` | cancellation before start prevents execution |
   | `CANCEL-02` | cancellation after start follows the target's commit boundary |
   | `DISP-01` | disposal before start prevents execution |
   | `DISP-02` | disposal after start follows the target's commit boundary |
   | `REDACT-01` | normalized failure channels contain no secret sentinel |
   | `REDACT-02` | discovery and lifecycle channels contain no secret sentinel |
   | `REDACT-03` | report, mismatch, and captured driver channels contain no secret sentinel |

7. Every target/case pair is `supported` except that `dom-jsdom` may mark only
   `CANCEL-01` and `CANCEL-02` unsupported with reason
   `dom_no_abort_signal`, and only `DISP-01` and `DISP-02` unsupported with
   reason `dom_no_disposal_boundary`. These are the only unsupported reason
   codes. They are closed identifiers, not free text. No other target, case,
   reason, waiver, optional label, or runtime-generated skip is valid.
8. Cancellation or disposal before execution starts prevents new work where
   the target exposes that boundary. For WebMCP and MCP, post-start
   cancellation is commit-wins where the current runtime supports that
   behavior: it cannot interrupt or roll back the mutation, and the oracle
   asserts the committed state and completed lifecycle. The matrix must not
   infer commit-wins for a target whose runtime returns a different safe
   result.

   `DISP-02` therefore permits target-specific expected outcomes while keeping
   one exact authoritative final state. The current Playwright surface may
   commit the browser mutation and then return the fixed normalized
   `stale_revision` failure when disposal invalidates its post-execution
   observation. The Playwright expectation must retain that failure and the
   possibly committed authoritative state; normalization must not rewrite it
   to success. WebMCP and MCP retain commit-wins success only where their
   runtime actually completes successfully. No target may claim interrupt or
   rollback semantics that its runtime does not provide.

   `perTargetOverrides` is absent from every scenario except `DISP-02`. For
   `DISP-02` it contains exactly one key, `playwright-managed`, whose value
   contains exactly `outcomes` and `lifecycle`; it cannot override discovery,
   final state, capability, request, action inventory, digest, or another
   target. The Playwright override requires the normalized
   `stale_revision` failure and its exact failure lifecycle after the possible
   commit. `webmcp-compat`, `webmcp-native`, and `mcp-sdk` use the shared
   declared outcome and lifecycle, while `dom-jsdom` remains the
   matrix-authorized unsupported case. Matrix, scenario, and suite validation
   jointly reject any other override key, field, target, case, or shape.
   `expected.finalState` remains one exact shared authoritative value for every
   target.

### Validation, normalization, and oracle

9. Descriptor-safe capture precedes schema validation, secret scanning,
   hashing, execution, and comparison. Accessors, setters, symbols, sparse
   arrays, cycles, functions, `undefined`, bigint, non-finite numbers, exotic
   prototypes, excessive depth, properties, strings, bytes, actions, requests,
   events, cases, or differences are rejected with fixed reasons. Captured
   data is detached and recursively frozen.
10. Discovery projections normalize to action reference, risk,
    `requiresConfirmation`, idempotency, and optional input/output schema
    digests. Descriptions, transport tool names, selectors, locators, and
    protocol wrappers are excluded. Missing actions, weaker risk, altered
    confirmation or idempotency, and schema drift remain mismatches.
11. Outcomes normalize to operation, success plus revision reference, or
    failure plus the existing fixed failure code. Lifecycle retains operation,
    event, outcome, sequence, revision reference, and action reference. Raw
    revision, action, correlation, timestamp, duration, transport, and browser
    identifiers are replaced or excluded only where explicitly declared.
    First-seen references are deterministic within each fresh case.
12. Pass/fail is determined by normalized discovery, ordered normalized
    outcomes and lifecycle, and a canonical value read through the trusted
    fixture host's `readAuthoritativeState()` boundary. Screenshot pixels,
    callback returns, HTTP status, tool-call completion, browser-command
    success, and semantic snapshots alone are never the authoritative state
    oracle.
13. Driver output is untrusted, strictly captured, budgeted, schema-validated,
    and secret-scanned before comparison. Mismatches use only the closed paths
    `discovery`, `outcome`, `lifecycle`, `final_state`, and `secret_channel`,
    with bounded operation, index, or action references. At most 256
    differences are reported; no raw unexpected value is reflected.

### Schemas, digests, and reports

14. The four private Draft 2020-12 schemas are:

    - `agent-conformance-scenario-0.1.schema.json`: strict scenario shape,
      closed capability IDs, at most 128 actions and 64 requests, and at most
      1 MiB after canonical serialization;
    - `agent-conformance-capability-matrix-0.1.schema.json`: the five exact
      targets, 26 exact cases, supported entries, and the four DOM exceptions
      with their two exact reason codes;
    - `agent-conformance-suite-0.1.schema.json`: the strict suite manifest,
      exact case-to-scenario bindings, component digests, sentinel-set digest,
      and suite digest;
    - `agent-conformance-report-0.1.schema.json`: strict source, package,
      target-tier, case, summary, mismatch, and digest fields.

    Runtime validation must additionally enforce exact set membership,
    cross-field matrix rules, ordering, budgets, digests, and secret scanning
    that JSON Schema alone cannot prove.
    The matrix top level is exactly `schemaVersion`, `kind`, `matrixId`,
    `targets`, `cases`, and `matrixDigest`. A target contains `targetId`,
    `family`, and `tier`. A case contains `caseId`, `capability`, and exactly
    one entry per target; an entry is either supported or one of the four
    specifically permitted DOM unsupported forms.
15. The suite manifest top level is exactly `schemaVersion`, `kind`, `suiteId`,
    `matrixDigest`, `scenarios`, `fixtureHostDigest`, `driverDigests`,
    `sentinelSetDigest`, `scanChannels`, and `suiteDigest`. `scanChannels` is
    exactly `scenario_artifacts`, `capability_matrix`, `suite_manifest`,
    `fixture_host_input`, `authoritative_state`, `driver_result`,
    `normalized_observation`, `mismatches`, `report_payload`, `stdout`,
    `stderr`, `packed_tarball_files`, and `installed_package_files` in that
    order. The manifest must contain exactly 26 unique scenario entries, and
    runtime validation proves a bijection among matrix case IDs, manifest case
    IDs, and scenario files. For every entry, `caseId` must equal `scenarioId`
    and the manifest's `scenarioDigest` must equal the validated scenario
    artifact digest. Each manifest binding also contains the exact
    `injectionDigest` of the scenario's ordered sentinel declarations,
    including the canonical empty declaration for cases without injection.
    Missing, duplicate, extra, renamed, substituted, or unbound scenarios or
    injection declarations reject the suite before a driver runs.

    The suite-digest payload includes the matrix digest, the 26 ordered
    `{ caseId, scenarioDigest, injectionDigest }` bindings, the shared
    fixture-host source digest, every exact target driver source digest, and
    the sentinel-set digest plus the exact ordered scan-channel list. It cannot
    bind only a directory name, glob, count, or aggregate source-tree digest.
16. Canonical JSON uses descriptor-safe capture, finite numbers with negative
    zero normalized to zero, code-unit-sorted object keys, UTF-8 JSON without
    insignificant whitespace, preserved request/outcome/lifecycle ordering,
    and explicit sorting only for set-like action inventories, capability
    lists, target lists, and report target/case lists.
17. Digests are lowercase `sha256:` values using these exact domain prefixes:

    - `dual-surface-ui:agent-conformance-scenario:0.1\0`;
    - `dual-surface-ui:agent-conformance-capability-matrix:0.1\0`;
    - `dual-surface-ui:agent-conformance-suite:0.1\0`;
    - `dual-surface-ui:agent-conformance-source-tree:0.1\0`;
    - `dual-surface-ui:agent-conformance-report:0.1\0`.

    Each artifact omits only its own top-level digest field when hashing. A
    digest is exempt from secret scanning only at its exact declared path and
    only when it matches the complete digest grammar.
18. The source-tree digest covers a canonical ordered manifest of reviewed
    harness, schema, scenario, capability-matrix, fixture-host, and driver
    paths with each file's SHA-256. Source commit is recorded separately. A
    release report requires `dirty: false`; relevant dirty or untracked source
    fails the gate rather than producing acceptable evidence.
19. A report records suite and matrix digests, source commit and source-tree
    digest, package name/version, exact target/family/tier, bounded protocol or
    browser name/version where applicable, ordered case status, exact scenario
    digest, bounded differences, summary counts, and report digest. It contains
    no time, duration, absolute path, hostname, random identifier, raw request,
    raw output, page text, selector, screenshot, prompt, exception, credential,
    or secret. Repeating a run and reversing adapter order must produce
    byte-identical canonical reports for the same source and environment.
    Its exact top-level fields are `schemaVersion`, `kind`, `suiteId`,
    `suiteDigest`, `matrixDigest`, `sentinelSetDigest`, `source`, `package`,
    `scan`, `runs`, `summary`, and `reportDigest`. `source` contains exactly
    `commit`, `treeDigest`, and `dirty: false`. `package` contains package name,
    version, packed tarball SHA-256, and installed-manifest digest. A run is
    identified by target, family, tier, `runStatus`, bounded environment
    metadata, ordered cases, and summary. A case contains `caseId`,
    `scenarioDigest`, `status`, and only the fields permitted for that status.
    The status enum is exactly `passed`, `failed`, or `unsupported`.

    - `passed` contains no reason, failure class, or differences;
    - `failed` contains only one closed failure class from
      `discovery_mismatch`, `outcome_mismatch`, `lifecycle_mismatch`,
      `final_state_mismatch`, `secret_scan_failed`, or
      `driver_result_invalid`, plus at most 256 bounded non-reflective
      differences where that class permits them;
    - `unsupported` contains only its exact closed reason and is valid only for
      the four `dom-jsdom` cells authorized by the matrix.

    An unknown status, unknown failure class, missing required field,
    forbidden field, missing case, duplicate case, extra case, unsupported
    non-DOM cell, or mismatch with the matrix rejects the report and fails the
    gate.

20. `runStatus` is exactly `completed` or `environment_failed`. A completed
    run contains all supported cases and only the four matrix-authorized DOM
    unsupported cases. An environment-failed run contains zero case results
    and exactly one closed safe reason from `native_api_unavailable`,
    `browser_launch_failed`, or `protocol_environment_failed`; it contains no
    raw exception, path, host, process output, or environment value. Any
    environment-failed target makes the conformance gate fail. It is evidence
    of absence, never a skip or partial pass.

21. The reviewed secret-sentinel corpus is itself a strict, ordered artifact.
    The suite and report both bind its exact `sentinelSetDigest`. The scanner
    covers every byte of scenario, matrix, suite, fixture-host input and
    authoritative state, raw driver result, normalized observation, mismatch,
    report-before-digest, captured stdout, and captured stderr. The report's
    `scan` contains exactly `sentinelSetDigest`, `channels`, and
    `bytesScanned`. `channels` contains exactly the suite's 13 ordered channel
    objects and top-level `bytesScanned` equals their non-negative safe-integer
    byte-count sum.

    `fixture_host_input` and `authoritative_state` are trusted-injection
    channels only for a scenario that declares injection there. Their evidence
    contains exactly `channel`, `kind: "trusted_injection"`, `bytesScanned`,
    and ordered `expected` and `observed` entries. Each entry contains only
    `sentinelId`, `sentinelDigest`, and `count`; it never contains the sentinel
    bytes, matched slice, offset, context, or source value. Expected entries
    must equal the scenario declarations bound by scenario and suite digests,
    and observed IDs, digests, and counts must equal expected exactly.

    The other 11 channels are egress/artifact channels. Their evidence contains
    exactly `channel`, `kind: "egress_artifact"`, `bytesScanned`, and
    `matches: 0`. A trusted channel without a declared injection is treated as
    egress for that scenario and must also have zero matches. Any unexpected,
    missing, duplicate, or count-mismatched trusted injection; any egress
    match; any missing, duplicate, reordered, or extra channel; zero bytes for
    a required non-empty artifact; missing digest; digest mismatch; partial
    scan; overflow; or scanner failure rejects the report and fails the gate
    without reflecting sentinel bytes.

    Report scanning follows one non-recursive construction order. First build
    and canonically serialize the exact report projection with both `scan` and
    `reportDigest` absent. Scan every byte of that projection as the
    `report_payload` channel. Then insert the complete scan evidence. Finally
    compute `reportDigest` over the canonical completed report with only
    `reportDigest` absent, so the digest binds the scan evidence. The scanner
    never attempts to scan its own counters or digest, and no implementation
    may use placeholders, a fixed-point calculation, or omit another report
    field to avoid self-reference.

### Gates

22. Every available target runs from a fresh fixture, exporter, cache, browser
    context, and protocol server at least twice. One complete run uses the
    forward five-target order and another uses the reverse five-target order;
    both full sets include managed Playwright and native WebMCP rather than
    comparing only the in-process subset. Canonical reports must be
    byte-identical after applying only the explicitly declared target/case
    ordering. State, replay cache, registrations, pages, handles, and abort
    controllers are never reused between repetitions.
23. `npm run test:conformance` runs DOM, compatibility WebMCP, and MCP SDK.
    `npm run test:conformance:browser` runs managed Playwright under the
    existing browser matrix. `npm run test:conformance:native` runs only native
    WebMCP and cannot fall back to compatibility behavior. The aggregate gate
    joins their authenticated report fragments, enforces the fresh
    forward/reverse full-set requirement, and fails on any
    `environment_failed` target.
24. `npm run package:check:conformance` packs and installs the package, computes
    and verifies the packed tarball SHA-256, then computes an installed-manifest
    digest from the code-unit-sorted relative path and SHA-256 of every
    installed regular file. The package gate passes both digests to the
    drivers through the detached input and requires every report to bind them.
    It also proves the root remains frozen at 32 exports, proves no
    `./conformance` export or private conformance fixture/schema/test is packed,
    and rechecks the existing MCP, WebMCP, and Playwright consumer boundaries.
    Missing, extra, changed, symlinked, or unreadable installed files fail the
    manifest check before conformance execution.
    Every driver and browser fixture server must resolve and import package
    entrypoints from that verified fresh install root. Before execution, the
    gate resolves and realpaths every loaded package module, proves the path is
    inside the install root, proves it is an exact regular-file entry in the
    verified installed manifest, and rejects symlink escape, workspace/source
    resolution, relative source import, loader alias, or fallback to the
    repository build. Driver-reported package identity alone is never accepted
    as resolution evidence. A driver cannot run if its resolved module graph
    or the current installed manifest digest differs from the package evidence
    bound into the suite and report.
25. P3.6 evidence also requires typecheck, build, `test:gate`, contract freeze,
    all existing Phase 3 package gates, dependency audit, and `git diff
    --check`. A missing native or managed-browser environment is recorded only
    as the closed safe environment failure and makes the gate fail; it cannot
    be relabeled as a semantic skip or passing result.

## Consequences

- One reviewed semantic corpus detects cross-exporter weakening without
  requiring transport payloads to be byte-identical.
- The authoritative application outcome stays independent of adapter return
  values and expected-result data.
- Four direct-DOM capability gaps are explicit and cannot grow through free
  text or runtime decisions.
- Cancellation is honest about the commit boundary: post-start signals do not
  imply rollback.
- Conformance artifacts remain private and removable without changing package
  runtime behavior or the Phase 1 public contract.

## Non-claims

- This harness does not prove browser or protocol implementation correctness
  outside the tested versions and fixtures.
- A digest detects accidental change; it is not a signature, attestation, or
  tamper-proof record.
- Compatibility WebMCP evidence is not native WebMCP evidence.
- Managed Playwright evidence is not a native operating-system adapter.
- Deterministic conformance is not model-quality, provider, performance,
  token-cost, or native-feasibility evidence.
- Commit-wins does not provide interruptible transactions or rollback.

## Rejected alternatives

- Comparing raw transport payloads: rejected because legitimate projections
  differ and raw payloads may carry untrusted content.
- Using screenshots, callbacks, or tool completion as the oracle: rejected
  because none proves authoritative application state.
- Letting expected final state drive fixture execution: rejected because it
  would make the oracle self-fulfilling.
- Free-text or runtime-generated skips: rejected because capability gaps would
  be unauditable and could hide security regressions.
- Treating post-start cancellation as interrupt or rollback: rejected because
  it contradicts the core commit boundary.
- Publishing `dual-surface-ui/conformance` now: rejected because P3.6 requires
  test evidence, not a new supported package API.
