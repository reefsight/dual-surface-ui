# ADR 0002: Opt-In Structured Failure Results

Status: Accepted

Date: 2026-09-18

## Context

`AgentSurface.perform()` returns a versioned success result but rejects with an
exception on failure. Transport adapters need a JSON-safe failure contract and
must not forward handler messages, stack traces, action input, idempotency keys,
or principal data across the trust boundary.

Changing `perform()` to stop throwing would break existing callers. Reusing an
exception message would also make the transport contract unstable and could
leak application or secret data.

## Decision

- Keep `perform()` and its rejection behavior unchanged.
- Add `performSafe()` as an opt-in boundary that returns a discriminated
  success-or-failure outcome.
- Define a separate versioned `AgentActionFailureResult` JSON Schema. The
  existing success-result schema remains unchanged.
- Failure results contain the authoritative surface ID, the latest revision the
  runtime can safely observe, `status: "failed"`, and a normalized error object.
- Known `AgentError` codes map to fixed public messages. Unknown exceptions map
  to `internal_error`; original messages, values, causes, and stacks are never
  serialized.
- Omit request action, target, input, key, and principal fields from failures.
  Transport correlation belongs to the transport layer and must use an opaque
  correlation ID rather than reflecting untrusted request data.

## Consequences

Positive:

- exporters receive a deterministic, schema-valid result for every execution;
- existing exception-based integrations remain compatible;
- arbitrary handler failures cannot leak their payload through the envelope;
- status provides a simple discriminant for consumers.

Negative:

- callers must deliberately choose `performSafe()` when they need a transport
  envelope;
- fixed messages contain less debugging detail, so trusted local diagnostics
  require a separate redacted observability mechanism;
- failure results do not identify the requested action or target.

## Alternatives rejected

1. Change `perform()` to return failures: breaks existing exception handling.
2. Serialize `Error.message` and stack: unstable and unsafe across the boundary.
3. Include request fields in the failure: risks reflecting untrusted or secret
   data and duplicates transport correlation.
4. Add audit events in the same change: mixes an execution contract with an
   observability lifecycle and expands review scope.

## Revisit conditions

Revisit if a transport standard requires additional failure fields. Any new
field must have a redaction rule, compatibility analysis, schema fixture, and
security test before entering the public contract.
