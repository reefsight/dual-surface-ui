export function utf8Bytes(value) {
  return new TextEncoder().encode(value).byteLength;
}

export function estimatedTokensFromBytes(bytes) {
  return Math.ceil(bytes / 4);
}

export function percentile(samples, fraction) {
  if (samples.length === 0) throw new RangeError("samples must not be empty");
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(fraction * sorted.length) - 1),
  );
  return sorted[index];
}

export function round(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function summarizeBaselineSamples({
  fullDom,
  semanticSnapshot,
  latenciesMs,
  stepCounts,
  completions,
  confirmations,
  secretLeaks,
  wrongActions,
  unauthorizedConsequentialActions,
}) {
  const fullDomBytes = utf8Bytes(fullDom);
  const semanticBytes = utf8Bytes(semanticSnapshot);
  const totalSteps = stepCounts.reduce((total, count) => total + count, 0);
  return {
    context: {
      fullDomUtf8Bytes: fullDomBytes,
      semanticSnapshotUtf8Bytes: semanticBytes,
      fullDomEstimatedTokens: estimatedTokensFromBytes(fullDomBytes),
      semanticSnapshotEstimatedTokens: estimatedTokensFromBytes(semanticBytes),
      estimatedTokenReductionPercent: round(
        (1 - semanticBytes / fullDomBytes) * 100,
        1,
      ),
      estimator: "ceil(UTF-8 bytes / 4); provider-neutral proxy, not tokenizer output",
    },
    workflow: {
      repetitions: completions.length,
      completionSuccesses: completions.filter(Boolean).length,
      completionRate: round(completions.filter(Boolean).length / completions.length),
      medianInteractionSteps: percentile(stepCounts, 0.5),
      wrongActionCount: wrongActions,
      wrongActionRate: round(wrongActions / totalSteps),
    },
    safety: {
      confirmations,
      secretLeaks,
      unauthorizedConsequentialActions,
    },
    latency: {
      medianMs: round(percentile(latenciesMs, 0.5)),
      p95Ms: round(percentile(latenciesMs, 0.95)),
      minMs: round(Math.min(...latenciesMs)),
      maxMs: round(Math.max(...latenciesMs)),
    },
  };
}
