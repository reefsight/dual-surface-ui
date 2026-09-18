# Testing and Agent Evaluation Strategy

Status: Accepted at Gate 0 on 2026-09-18

Deterministic software tests and probabilistic agent evaluations answer
different questions. Both are required; neither can substitute for the other.

## Test pyramid

### Static and schema checks

- TypeScript strict typecheck
- JSON Schema validity and generated-type parity
- API surface and package export checks
- dependency-boundary checks
- documentation links and code-example compilation

### Unit tests

- roles, names, state, visibility, and redaction
- stable IDs and duplicate handling
- risk defaults and policy decisions
- input/output validation
- error mapping
- snapshot deltas and revisions

### Contract and conformance tests

The same fixture corpus runs against DOM, WebMCP, MCP, Playwright, and native
adapters. Golden fixtures include normal, optional, disabled, hidden, dynamic,
sensitive, stale, ambiguous, malformed, cross-origin, and unsupported cases.

### Integration tests

- real browser lifecycle and navigation
- framework mount/unmount/rerender
- authentication and current-user permission changes
- confirmation and cancellation
- business handler plus effect verification
- transport interruption, timeout, and replay

### End-to-end tests

Compare the human workflow and agent action against authoritative application
state. A screenshot can supplement evidence but is not the state oracle.

## Evaluation dimensions

1. Discovery: did the agent see the relevant action?
2. Selection: did it choose the correct action rather than a tempting wrong one?
3. Arguments: are inputs valid, complete, and grounded in user intent?
4. Safety: did it refuse or request confirmation appropriately?
5. Execution: did the handler complete without policy bypass?
6. Verification: did it confirm the declared effect?
7. Efficiency: steps, tokens, latency, retries, and fallback rate.

## Evaluation dataset

Each task has an ID, user request, initial fixture state, permitted actions,
forbidden actions, expected arguments, expected confirmation, authoritative
final state, and scoring rubric. Include paraphrases and adversarial variants;
do not modify the frozen test set to hide regressions.

Required suites:

- straightforward success
- incomplete or ambiguous request
- invalid and boundary inputs
- changed/stale UI state
- permission denial
- cancellation
- untrusted page instructions
- malicious tool output
- multiple similar actions
- destructive/consequential action
- unsupported visual-only control and fallback

## Reproducibility record

An eval report records commit, package version, schema version, fixture version,
model/provider, model snapshot when available, prompt/configuration, browser/OS,
timestamp, repetitions, raw scores, and redacted failure traces.

## Release thresholds

- Deterministic required tests: 100% pass.
- Critical safety scenarios: 100% pass across all repetitions.
- No secret may appear in serialized artifacts.
- Agent quality thresholds come from the accepted phase plan.
- A model improvement cannot excuse a deterministic contract regression.

## Failure triage

Classify failures as compiler, schema, policy, adapter, transport, model
selection, model arguments, application, verification, fixture, or environment.
Fix the responsible layer. Do not add prompt instructions to mask a contract or
authorization defect.
