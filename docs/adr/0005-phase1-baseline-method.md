# ADR 0005: Phase 1 Example and Baseline Method

Status: Accepted

Date: 2026-09-18

## Context

Phase 1 must include one end-to-end example and recorded completion, step,
context-token, and latency baselines. Model-dependent evaluation is intentionally
scheduled for Phase 3. Using a model now would make the Phase 1 gate depend on a
provider, prompt, network, and changing model snapshot that are outside the core
contract under test.

## Decision

- Use the north-star document-approval workflow with two required checkboxes, a
  consequential `approve_document` domain action, typed input/output,
  authorization, trusted confirmation, precondition, verified effect, keyed
  idempotency, and redacted lifecycle events.
- The human click path and agent action handler call the same in-memory business
  function and update the same visible DOM status. No AI-only application state
  is introduced.
- Freeze the scripted agent path as four boundary interactions: observe, toggle
  identity, toggle terms, and approve. An unexpected step is a wrong action;
  wrong-action rate is the count divided by all recorded interactions.
- Run 25 isolated repetitions. Completion requires a successful structured
  result, visible `Approved` status, and exactly one business operation.
- Measure latency around the four agent interactions only. DOM parsing and
  fixture/runtime setup are excluded. Record Node, platform, and architecture;
  latency is descriptive, not a cross-machine release threshold.
- Compare the UTF-8 byte length of the serialized live full DOM with the initial
  semantic snapshot. Estimate context tokens as `ceil(bytes / 4)`. This is an
  explicit provider-neutral proxy, not output from a model tokenizer.
- Count confirmation, hidden-sentinel leakage, wrong actions, and consequential
  execution without exactly one confirmation on every repetition.
- Record the source commit, fixture SHA-256, environment, timestamp, aggregate
  metrics, and raw latency/step/completion samples.
- Label the report `deterministic-scripted-no-model`. It establishes the Phase 1
  baseline but makes no claim about model selection quality or vision success.

## Consequences

Positive:

- Phase 1 records all required metric dimensions without adding a model or
  transport dependency;
- the workflow exercises the complete current safety lifecycle;
- the method is repeatable locally and can be reused as a later comparison;
- context reduction is transparent and independently recomputable.

Negative:

- estimated tokens are not equivalent to provider-specific tokenizer counts;
- scripted completion and wrong-action results do not predict model behavior;
- jsdom latency is not browser, device, or production latency;
- one workflow is a baseline, not a representative statistical evaluation set.

## Alternatives rejected

1. Call a hosted model in Phase 1: violates the phase boundary and makes the
   deterministic core gate externally variable.
2. Claim exact tokens from character count: the estimate would be mislabeled.
3. Benchmark only snapshot generation: misses policy and action execution.
4. Include DOM construction in latency: measures jsdom parsing more than the
   package workflow.
5. Compare against a fabricated vision-agent run: creates misleading evidence.

## Revisit conditions

Phase 3 replaces the proxy comparison with frozen multi-model tasks and real
Playwright accessibility/vision baselines. Keep this report as the `0.1`
historical baseline; do not rewrite it to improve later results.
