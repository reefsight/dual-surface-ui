# ADR 0011: CLI Orchestration Is Deterministic and Local by Default

Status: Accepted for P3.5 implementation on 2026-09-20

Date: 2026-09-20

## Context

Phase 3 artifacts currently require package-specific scripts. Developers and CI
need one executable for inspection, validation, comparison, trace recording,
synthetic replay, and deterministic evaluation. A CLI also creates new trust
boundaries: unbounded stdin, ambiguous artifact detection, unsafe output paths,
secret-bearing diagnostics, shell invocation, and executable local drivers.

The CLI must not turn reviewed offline replay into live automation or make the
frozen root package load Node, browser, transport, framework, or model-provider
dependencies. Its machine output must remain stable enough for CI consumers.

## Decision

### Package and grammar

1. Add the optional Node-only `dual-surface-ui/cli` subpath and a
   `dual-surface-ui` executable. Do not re-export CLI values from the frozen
   root contract.
2. The executable accepts exactly one of these commands. Unknown, positional,
   duplicate, or conflicting arguments are rejected.

   ```text
   dual-surface-ui inspect --input <path|-> [--type <type>] [--format json|ndjson]
   dual-surface-ui validate --input <path|-> [--type <type>] [--format json|ndjson]
   dual-surface-ui diff --base <path|-> --target <path|-> [--format json|ndjson]
   dual-surface-ui record --driver <absolute-path|file-url> --trust-driver --source-id <id> --output <path> [--force] [--timeout-ms <ms>] [--format json|ndjson]
   dual-surface-ui replay --input <path|-> [--format json|ndjson]
   dual-surface-ui evaluate --definition <path|-> --driver <absolute-path|file-url> --trust-driver [--timeout-ms <ms>] [--format json|ndjson]
   ```

   `--help` is valid at the top level or after a command. `--version` is
   standalone. JSON is the default format. `--type` is one of `auto`,
   `snapshot`, `delta`, `trace`, `replay-fixture`, `evaluation-definition`, or
   `evaluation-result`. `-` means stdin and may appear only once in one
   invocation. Timeouts are integral milliseconds from 1 through 600,000.
3. Arguments, environment variables, artifact content, and driver results do
   not add commands, configuration, paths, imports, or shell fragments. There
   is no implicit config file, environment-based driver, network call, browser
   launch, live surface, daemon, provider, or shell execution.

### Results and exits

4. Normal JSON output is one canonical compact UTF-8 object plus LF:
   `{schemaVersion:"0.1",kind:"agent-cli-result",command,status,data}`.
   NDJSON uses
   `{schemaVersion:"0.1",kind:"agent-cli-event",command,sequence,type,data}`.
   Non-evaluation commands emit one `result` event. A rejected evaluation
   definition also emits one `result` event. A valid evaluation emits ordered
   `case` events followed by exactly one `summary` event; the complete NDJSON
   sequence is buffered and passed to the stdout sink in one write.
5. Canonical output sorts object keys by UTF-16 code-unit order and adds no
   CLI-generated timestamp, duration, absolute path, terminal styling, progress,
   locale data, stack, or raw error. Validated artifact timestamps may appear
   only inside the explicitly untrusted delta payload returned by diff.
   Diagnostics and inspect/validate metadata never include
   untrusted artifact text. A successful diff deliberately returns the bounded,
   validated delta as untrusted machine data. Every result/event has a strict
   per-command data schema and artifact-specific budget. Operational
   failures leave stdout empty and write one canonical, bounded error envelope
   to stderr: `{schemaVersion:"0.1",kind:"agent-cli-error",command?,code,message}`.
   `code` is one of `usage`, `input_io`, `output_io`, `driver_error`,
   `cancelled`, or `internal_error`; `message` comes from a fixed allowlist.
   The shared secret detector runs immediately before every stdout or stderr
   write, including internal-error paths.
6. Exit classes are stable:

   | Exit | Meaning |
   |---:|---|
   | 0 | command completed, including no-change and zero evaluation scores |
   | 1 | semantic negative: invalid artifact, resync required, or replay mismatch |
   | 2 | usage or argument error |
   | 3 | input missing, unreadable, malformed, oversized, or unsafe |
   | 4 | output conflict, unsafe output, write, or atomic commit failure |
   | 5 | trusted-driver load, contract, execution, or evaluation environment failure |
   | 6 | cancellation or timeout |
   | 70 | normalized internal invariant failure |

   Help and version exit zero. UTF-8, framing, JSON syntax, byte-limit, missing,
   and unreadable failures exit three. A successfully parsed artifact rejected
   by schema, semantics, digest, budget, or secret controls is a machine result
   with exit one. A per-case `environment_unavailable` evaluation is an
   incomplete machine result on stdout and exits five; driver load, contract,
   thrown, malformed-result, or uncaptured execution failures are operational,
   leave stdout empty, and emit the fixed stderr envelope. Timeout and SIGINT
   exit six.

### Artifact handling

7. Files and stdin are read with an 8 MiB global byte ceiling, strict UTF-8,
   exactly one JSON value, duplicate-key rejection, bounded nesting and
   property/string counts, descriptor-safe capture, artifact-specific budgets,
   and the shared secret detector. YAML, compression, globbing, directories,
   recursive imports, URL inputs, and best-effort parsing are not supported.
8. Automatic detection recognizes only a strict snapshot, snapshot delta,
   runtime trace, replay fixture, evaluation definition, or evaluation result.
   Explicit types must match. Inspection validates before returning only safe
   metadata, digests, and counts; it never returns titles, URLs, node names,
   raw revisions, request inputs, outputs, or expected observations.
9. Diff delegates to the P3.3 delta implementation and preserves its exact
   surface/revision and resynchronization rules. Replay delegates only to the
   P3.4 package-owned synthetic harness. Replay has no driver, target, surface,
   browser, transport, callback, or live option.

### Deterministic evaluation

10. An evaluation definition is a strict versioned artifact containing a
    suite identifier, sorted unique dimension identifiers, at most 256 sorted
    unique cases, bounded safe JSON input, exact expected values for every
    dimension, and a domain-separated SHA-256 digest. It has at most 32
    dimensions, 32 KiB of input plus expected data per case, and 8 MiB total.
11. A driver returns observed values for each dimension or the fixed
    `environment_unavailable` result. The CLI scores each dimension by exact
    canonical equality as zero or one. Results include per-case and
    per-dimension totals and unscored environment errors, but never raw observed
    or expected values, a model judgment, or aggregate pass/fail verdict. Zero
    scores still exit zero; environment errors produce an incomplete result and
    exit five. P3.8 may add frozen model evidence without changing this exact
    P3.5 scoring substrate.

### Trusted local drivers and output files

12. `record` and `evaluate` require both an explicit absolute filesystem path
    or canonical `file:` URL and `--trust-driver`. Bare packages, relative and
    UNC syntax, query/fragment components, and non-file URL schemes are
    rejected. Capture the current working directory once. The driver must
    resolve to a local regular file and each parent component to a local
    directory; none may be a symlink, junction, or reparse point. Open and pin
    the real path, file identity, SHA-256 content digest, and bytes. Recheck the
    identity and digest immediately before execution, then import the already
    pinned bytes as one self-contained ESM module instead of reopening the
    pathname; drift fails closed. Relative module imports are therefore not a
    driver feature. Mounted or mapped storage locality is outside portable Node
    enforcement. A driver is arbitrary trusted code, not a security sandbox.
13. A driver module exposes only
    `createDualSurfaceCliDriver()`. The returned versioned driver has a stable
    identifier and optional `record` and `evaluateCase` methods. Record receives
    a frozen abort signal and synchronous audit-event emitter. Evaluate receives
    detached frozen case ID/input and an abort signal, never the expected values.
    The driver never receives the output path or stdout/stderr handles.
14. Driver code runs in a dedicated terminable child process launched directly
    with `shell:false`, stdin ignored, and stdout/stderr captured with byte
    limits. Driver output is scanned and discarded, never forwarded. Results
    travel only through bounded validated IPC. The child receives a fixed
    working directory and a minimal explicit environment that excludes ambient
    credentials, `NODE_OPTIONS`, and `NODE_PATH`. Exact-key driver results are
    descriptor-captured, limited by bytes/depth/properties/string length, and
    secret-scanned both before IPC and after receipt; observed values are never
    reflected in output. The default timeout is 30,000 ms and includes module
    load, factory creation, and the record invocation or one evaluation case.
    A fresh evaluation process per case prevents cross-case state from defining
    results. Process isolation supports timeout and cancellation but does not
    reduce the authority of trusted code.
15. `record` alone writes an artifact. Its source ID and output path come only
    from arguments. The completed trace is validated before publication. The
    target is resolved from the one captured working directory. It must have an
    existing local parent and must not be a device, directory, symlink,
    junction, reparse point, FIFO, socket, or the same file as an input or
    driver. Every existing parent component is resolved and rejected if it is a
    symlink, junction, or reparse point, then rechecked immediately before
    commit.
16. Writes use a same-directory package-owned temporary file opened exclusively
    with mode 0600, then write, fsync, close, validate, and atomically commit.
    Without `--force`, an atomic hard-link commit provides no-clobber behavior;
    unsupported platforms fail rather than copy. `--force` uses an atomic
    replacement only where the platform supports it. Existing targets are
    preserved on failure. Cancellation terminates the direct child process and
    removes only the invocation-owned temporary file. Abort observed before
    the commit point
    leaves no final artifact. Once the atomic link or replacement completes,
    commit wins the race: the final digest and size are verified and the
    command reports completion even if cancellation then arrives. A final path
    is never removed during cleanup without proving it is the exact
    invocation-owned file identity. A concurrently hostile writable parent
    directory is outside the portable Node threat model and is documented as
    such.

### Optional library contract

17. `dual-surface-ui/cli` is side-effect free on import: it does not inspect
    argv or environment variables, read files, register process handlers, load
    a driver, or load optional peers. It exports the CLI/evaluation schemas and
    types, trusted-driver interfaces, canonical result serialization, and
    `runAgentCli(argv, host)`. The explicit host supplies bounded input,
    atomic-output, trusted-child, cancellation, and result sinks. The packaged
    executable alone adapts Node process and filesystem facilities to that host
    contract.

### Frozen public shapes

18. The evaluation and trusted-driver compatibility surface is exactly:

   ```ts
   type AgentCliJson = null | boolean | number | string |
     readonly AgentCliJson[] | { readonly [key: string]: AgentCliJson };
   type AgentCliDigest = `sha256:${string}`;
   type AgentCliExitCode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 70;

   interface AgentEvaluationDefinition {
     readonly schemaVersion: "0.1";
     readonly kind: "agent-evaluation-definition";
     readonly suiteId: string;
     readonly dimensions: readonly string[];
     readonly cases: readonly {
       readonly caseId: string;
       readonly input: AgentCliJson;
       readonly expected: Readonly<Record<string, AgentCliJson>>;
     }[];
     readonly definitionDigest: AgentCliDigest;
   }

   interface AgentEvaluationResult {
     readonly schemaVersion: "0.1";
     readonly kind: "agent-evaluation-result";
     readonly suiteId: string;
     readonly definitionDigest: AgentCliDigest;
     readonly driverId: string;
     readonly status: "complete" | "incomplete";
     readonly caseCount: number;
     readonly dimensionCount: number;
     readonly cases: readonly (
       | { readonly caseId: string; readonly status: "scored";
           readonly scores: readonly { readonly dimension: string;
             readonly earned: 0 | 1; readonly possible: 1 }[] }
       | { readonly caseId: string; readonly status: "environment_error";
           readonly code: "environment_unavailable" }
     )[];
     readonly dimensions: readonly { readonly dimension: string;
       readonly earned: number; readonly possible: number;
       readonly unscored: number }[];
     readonly environmentErrors: number;
   }

   interface AgentCliTrustedDriver {
     readonly schemaVersion: "0.1";
     readonly kind: "agent-cli-driver";
     readonly driverId: string;
     readonly record?: (context: Readonly<{
       signal: AbortSignal;
       emitAudit: (event: AgentAuditEvent) => void;
     }>) => void | Promise<void>;
     readonly evaluateCase?: (
       request: Readonly<{ caseId: string; input: AgentCliJson }>,
       context: Readonly<{ signal: AbortSignal }>,
     ) => Promise<
       | { readonly status: "observed";
           readonly observations: Readonly<Record<string, AgentCliJson>> }
       | { readonly status: "environment_unavailable" }
     >;
   }

   // Required named export shape of each trusted driver module.
   export function createDualSurfaceCliDriver():
     AgentCliTrustedDriver | Promise<AgentCliTrustedDriver>;

   interface AgentCliHost {
     readonly cwd: string;
     readonly signal: AbortSignal;
     readonly readInput: (request: Readonly<{
       source: { readonly kind: "stdin" } |
         { readonly kind: "file"; readonly path: string };
       maxBytes: number;
     }>) => Promise<Uint8Array>;
     readonly writeAtomic: (request: Readonly<{
       path: string; bytes: Uint8Array; force: boolean;
       signal: AbortSignal;
     }>) => Promise<void>;
     readonly executeTrustedDriver: (request:
       | Readonly<{ mode: "record"; driver: string; timeoutMs: number }>
       | Readonly<{ mode: "evaluate"; driver: string; timeoutMs: number;
           caseId: string; input: AgentCliJson }>
     ) => Promise<
       | { readonly mode: "record"; readonly driverId: string;
           readonly auditEvents: readonly AgentAuditEvent[] }
       | { readonly mode: "evaluate"; readonly driverId: string;
           readonly result:
             | { readonly status: "observed";
                 readonly observations: Readonly<Record<string, AgentCliJson>> }
             | { readonly status: "environment_unavailable" } }
     >;
     readonly writeStdout: (canonicalLine: string) => Promise<void>;
     readonly writeStderr: (canonicalLine: string) => Promise<void>;
   }

   export function runAgentCli(
     argv: readonly string[], host: AgentCliHost,
   ): Promise<AgentCliExitCode>;
   export function serializeAgentCliOutput(
     value: AgentCliResultEnvelope | AgentCliEvent | AgentCliError,
   ): string;
   ```

   `AgentCliHost` is trusted computing base, not a convenience mock boundary.
   `readInput` must enforce the requested byte ceiling before returning;
   `writeAtomic` must implement decisions 15–16; and
   `executeTrustedDriver` must implement decisions 12–14, including path and
   identity pinning, captured child output, timeout, and delivery of pinned
   driver bytes to the fixed child bootstrap through bounded IPC rather than
   argv, environment, or an unverified reopened path. `runAgentCli` still
   descriptor-captures, budget-checks, validates, and secret-scans every host
   result before use. The packaged Node host is the only reference secure host;
   custom hosts are compliant only when they preserve all these postconditions.
   `writeStdout` and `writeStderr` write the supplied canonical UTF-8 line
   exactly once to only the named channel, with no prefix, suffix, added LF, or
   reflected sink failure content.

   Suite, case, dimension, and driver identifiers match
   `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`. A record source ID retains the P3.4
   `[A-Za-z0-9._~-]{1,128}` contract. Dimensions and cases are unique and
   code-unit sorted; observed and expected keys exactly equal the dimensions.
   The definition digest is SHA-256 over the UTF-8 bytes of
   `dual-surface-ui:evaluation-definition:0.1\0` followed by canonical JSON of
   every definition field except `definitionDigest`.
   `inspect` and `validate` use one artifact-type-independent digest:
   SHA-256 over UTF-8 bytes of `dual-surface-ui:cli-artifact:0.1\0` followed by
   canonical JSON of the complete validated artifact. Embedded trace, replay,
   delta, or evaluation digests are still validated by their owning contract
   but are never substituted for this CLI artifact digest. The `record` success
   digest uses the same full-artifact CLI domain formula over the completed
   validated trace.
19. The strict result union is:

   ```ts
   type AgentCliArtifactType = "snapshot" | "delta" | "trace" |
     "replay-fixture" | "evaluation-definition" | "evaluation-result";
   type AgentCliInvalidReason = "invalid_artifact" | "digest_mismatch" |
     "budget_exceeded" | "secret_detected";
   type AgentCliInspectData =
     | { artifactType: "snapshot"; schemaVersion: "0.1";
         digest: AgentCliDigest; counts: { nodes: number; actions: number;
           capabilities: number } }
     | { artifactType: "delta"; schemaVersion: "0.1";
         digest: AgentCliDigest; counts: { nodeUpserts: number;
           removedNodeIds: number } }
     | { artifactType: "trace"; schemaVersion: "0.1";
         digest: AgentCliDigest; counts: { records: number;
           operations: number } }
     | { artifactType: "replay-fixture"; schemaVersion: "0.1";
         digest: AgentCliDigest; counts: { steps: number } }
     | { artifactType: "evaluation-definition"; schemaVersion: "0.1";
         digest: AgentCliDigest; counts: { cases: number;
           dimensions: number } }
     | { artifactType: "evaluation-result"; schemaVersion: "0.1";
         digest: AgentCliDigest; counts: { cases: number;
           dimensions: number; environmentErrors: number } };

   type AgentCliCommandResult =
     | { command: "inspect"; status: "completed";
         data: AgentCliInspectData }
     | { command: "inspect"; status: "invalid"; data: {
         artifactType?: AgentCliArtifactType; reason: AgentCliInvalidReason } }
     | { command: "validate"; status: "valid"; data: {
         artifactType: AgentCliArtifactType; valid: true;
         digest: AgentCliDigest } }
     | { command: "validate"; status: "invalid"; data: {
         artifactType?: AgentCliArtifactType; valid: false;
         reason: AgentCliInvalidReason } }
     | { command: "diff"; status: "delta"; data: { delta: AgentSnapshotDelta } }
     | { command: "diff"; status: "no_change"; data: Record<string, never> }
     | { command: "diff"; status: "resync_required"; data: {
         reason: AgentSnapshotDeltaResyncReason } }
     | { command: "record"; status: "complete"; data: {
         artifactType: "trace"; digest: AgentCliDigest;
         recordCount: number; operationCount: number; outputWritten: true } }
     | { command: "replay"; status: "matched"; data: AgentReplayResult & {
         status: "matched" } }
     | { command: "replay"; status: "mismatch"; data: AgentReplayResult & {
         status: "mismatch" } }
     | { command: "replay"; status: "rejected"; data: AgentReplayResult & {
         status: "rejected" } }
     | { command: "evaluate"; status: "complete" | "incomplete";
         data: { result: AgentEvaluationResult } }
     | { command: "evaluate"; status: "invalid"; data: {
         artifactType?: AgentCliArtifactType;
         reason: AgentCliInvalidReason } };
   type AgentCliResultEnvelope = AgentCliCommandResult & {
     schemaVersion: "0.1"; kind: "agent-cli-result";
   };
   type AgentCliNonEvaluationResult = Exclude<
     AgentCliCommandResult, { command: "evaluate" }
   >;
   type AgentCliSingleResult = Exclude<AgentCliCommandResult,
     { command: "evaluate"; status: "complete" | "incomplete" }>;
   type AgentCliResultEvent<R> = R extends AgentCliSingleResult ? {
     readonly schemaVersion: "0.1";
     readonly kind: "agent-cli-event";
     readonly command: R["command"];
     readonly sequence: 0;
     readonly type: "result";
     readonly data: { readonly status: R["status"]; readonly data: R["data"] };
   } : never;
   type AgentCliEvent = AgentCliResultEvent<AgentCliSingleResult> |
     { readonly schemaVersion: "0.1"; readonly kind: "agent-cli-event";
       readonly command: "evaluate"; readonly sequence: number;
       readonly type: "case";
       readonly data: AgentEvaluationResult["cases"][number] } |
     { readonly schemaVersion: "0.1"; readonly kind: "agent-cli-event";
       readonly command: "evaluate"; readonly sequence: number;
       readonly type: "summary";
       readonly data: Omit<AgentEvaluationResult, "cases"> };
   interface AgentCliError {
     readonly schemaVersion: "0.1";
     readonly kind: "agent-cli-error";
     readonly command?: AgentCliCommandResult["command"];
     readonly code: "usage" | "input_io" | "output_io" |
       "driver_error" | "cancelled" | "internal_error";
     readonly message: "Invalid command line." | "Unable to read input." |
       "Unable to write output." | "Trusted driver failed." |
       "Operation cancelled." | "Internal error.";
   }
   ```

   Each JSON result adds only `schemaVersion: "0.1"` and
   `kind: "agent-cli-result"` to its corresponding union member. Each NDJSON
   line replaces that kind with `agent-cli-event`. A single-result line,
   including an invalid evaluation definition, has sequence zero and carries
   its exact `{status,data}` pair. A valid evaluation uses zero-based contiguous
   sequences with ordered `"case"` lines plus one final `"summary"`, buffered
   into one stdout sink write. Evaluation case-line data is exactly one
   corresponding result case; summary-line data is the result with `cases`
   omitted. No other properties are allowed. Public JSON Schemas generated
   from these shapes are the package authority.
20. Error messages are exactly `Invalid command line.`,
    `Unable to read input.`, `Unable to write output.`,
    `Trusted driver failed.`, `Operation cancelled.`, and
    `Internal error.` mapped one-to-one to the six error codes in decision 5.
    The trusted child environment contains only
    `DUAL_SURFACE_CLI_CHILD=1`, `TZ=UTC`, `LANG=C`, and `LC_ALL=C`. On Windows,
    the parent `SystemRoot` value may additionally be copied unchanged because
    Node and system libraries can require it. No other inherited variables are
    permitted. The CLI terminates and waits for its direct child; descendants
    deliberately created by arbitrary trusted driver code are outside the
    portable process-tree guarantee and reinforce that the driver is not a
    sandbox. `serializeAgentCliOutput` returns exactly one canonical JSON value
    followed by one LF; callers must not append another terminator.

## Consequences

- CI receives byte-stable output and meaningful, bounded exit classes.
- The executable remains offline and synthetic unless a user explicitly loads
  arbitrary trusted local code for record or evaluation.
- The package can stop an uncooperative driver, but it cannot sandbox or make
  that trusted code safe.
- Portable atomic no-clobber is preferred over a racy existence check. Some
  platform/filesystem combinations and force replacement will fail closed.
- Root exports and optional peer loading remain unchanged.

## Rejected alternatives

- Implicit stdin, environment configuration, or positional paths: rejected as
  ambiguous and automation-hostile.
- Live replay or caller-owned replay backends: rejected as a policy bypass.
- Shell-command drivers or bare package imports: rejected because authority and
  resolution would be implicit.
- Redacting arbitrary artifact content for inspection: rejected because
  rejection is safer than accidentally publishing secret-bearing text.
- Driver-authored scores or model judgments: rejected because P3.5 must be an
  exact deterministic substrate for P3.8.
- Check-then-rename no-clobber writes: rejected because the target can change
  between the check and commit.
