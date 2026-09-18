import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { decode as decodeToon, encode as encodeToon } from "@toon-format/toon";
import { encode as tokenize } from "gpt-tokenizer";

export const FORMATTERS = Object.freeze({
  jsonCompact: (value) => JSON.stringify(value),
  toonComma: (value) => encodeToon(value, { delimiter: "," }),
  toonTab: (value) => encodeToon(value, { delimiter: "\t" }),
});

export function normalizedJsonValue(value) {
  return JSON.parse(JSON.stringify(value));
}

export function assertToonRoundTrip(value, encoded) {
  assert.deepStrictEqual(decodeToon(encoded, { strict: true }), normalizedJsonValue(value));
}

export function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[midpoint];
  return (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

export function measureEncoding(formatter, value, repetitions = 50) {
  const samples = [];
  let encoded = "";
  for (let iteration = 0; iteration < repetitions; iteration += 1) {
    const startedAt = performance.now();
    encoded = formatter(value);
    samples.push(performance.now() - startedAt);
  }
  return {
    encoded,
    utf8Bytes: Buffer.byteLength(encoded, "utf8"),
    tokensO200kBase: tokenize(encoded).length,
    medianEncodeMs: Number(median(samples).toFixed(3)),
  };
}

export function measureDataset(name, value, { repetitions = 50 } = {}) {
  const formats = Object.fromEntries(
    Object.entries(FORMATTERS).map(([format, formatter]) => [
      format,
      measureEncoding(formatter, value, repetitions),
    ]),
  );
  assertToonRoundTrip(value, formats.toonComma.encoded);
  assertToonRoundTrip(value, formats.toonTab.encoded);

  const jsonTokens = formats.jsonCompact.tokensO200kBase;
  for (const metrics of Object.values(formats)) {
    metrics.tokenReductionVsCompactJsonPercent = Number(
      ((1 - metrics.tokensO200kBase / jsonTokens) * 100).toFixed(1),
    );
    delete metrics.encoded;
  }

  return { name, formats };
}

export function scaleSnapshot(snapshot, copies) {
  const nodes = Array.from({ length: copies }, (_, copyIndex) =>
    snapshot.nodes.map((node) => ({
      ...structuredClone(node),
      id: `${node.id}-${copyIndex + 1}`,
    })),
  ).flat();
  return {
    ...structuredClone(snapshot),
    surfaceId: `${snapshot.surfaceId}-scaled-${copies}`,
    nodes,
  };
}

export function createActionCatalog(snapshot) {
  return snapshot.nodes.flatMap((node) =>
    node.actions.map((action) => ({
      elementId: node.id,
      role: node.role,
      elementName: node.name,
      actionName: action.name,
      risk: action.risk,
      requiresConfirmation: action.requiresConfirmation ?? false,
      description: action.description ?? "",
    })),
  );
}
