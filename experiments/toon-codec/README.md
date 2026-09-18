# TOON Codec Experiment

Status: Complete — reject direct snapshot adoption; retain the harness

This experiment evaluates `@toon-format/toon` as an optional model-context
serialization layer. It does not change the frozen `0.1` JSON contract, core
runtime dependencies, package exports, or transport formats.

## Questions

1. Does TOON reduce `o200k_base` tokens versus compact JSON for the current
   document-approval snapshot?
2. Does the result change when the current snapshot shape is scaled?
3. Is TOON useful for a uniform action-catalog projection?
4. Do comma and tab encodings round-trip through strict decoding?
5. Does the encoder add any security property, or must redaction remain an
   upstream requirement?

## Reproduce

From the repository root:

```text
npm run build
cd experiments/toon-codec
npm ci
npm test
npm run benchmark -- --write
```

The benchmark uses `gpt-tokenizer`'s `o200k_base` encoding. Results are valid
for this corpus and tokenizer only; they are not universal model-cost claims.

## Results

| Dataset | Compact JSON | TOON comma | TOON tab | Best TOON change |
|---|---:|---:|---:|---:|
| Document-approval snapshot | 576 tokens | 661 | 668 | 14.8% worse |
| Current snapshot shape scaled 20× | 10,423 tokens | 12,047 | 12,149 | 15.6% worse |
| Uniform action-catalog projection | 7,803 tokens | 4,021 | 3,858 | 50.6% better |

Both TOON variants round-tripped through strict decoding. The benchmark input
contained no secret sentinel, but a focused test confirms that TOON serializes
secrets when they are supplied. Redaction must therefore remain upstream of
every codec.

Encoding latency was higher than compact JSON for every dataset. The largest
current-shape fixture had median encoding times of roughly 0.2 ms for JSON and
20–25 ms for TOON on the audit host. These numbers are diagnostic rather than a
portable performance claim.

## Decision

- Do not add TOON to the core package or frozen JSON contract.
- Do not encode the current `AgentSnapshot` directly as TOON; it costs more
  tokens than compact JSON for both the real and scaled fixtures.
- Keep this experiment isolated and reproducible.
- Reconsider an opt-in TOON exporter only for deliberately uniform projections,
  such as a read-only action catalog, after model comprehension and latency
  evaluations pass. The projection must derive from the canonical snapshot and
  must not become a second source of application truth.

The uniform projection clears a proposed 15% token-saving threshold, but token
savings alone are insufficient to ship an adapter. Browser/model task accuracy,
prompt-injection handling, truncation behavior, and consumer demand remain
unproven.
