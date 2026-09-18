# TOON Codec Experiment

Status: Measurement pending

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
