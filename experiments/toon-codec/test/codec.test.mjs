import assert from "node:assert/strict";
import test from "node:test";
import { decode, encode } from "@toon-format/toon";
import {
  FORMATTERS,
  assertToonRoundTrip,
  createActionCatalog,
  measureDataset,
  scaleSnapshot,
} from "../codec.mjs";

const snapshot = {
  schemaVersion: "0.1",
  surfaceId: "fixture",
  revision: "1",
  title: "Codec fixture",
  url: "https://example.test/fixture",
  generatedAt: "2026-09-18T00:00:00.000Z",
  capabilities: ["click", "toggle"],
  nodes: [
    {
      id: "approve",
      role: "button",
      name: "Approve, then notify",
      state: { disabled: false },
      actions: [
        {
          name: "approve_document",
          risk: "consequential",
          requiresConfirmation: true,
          description: "Approve the current document",
        },
      ],
    },
  ],
};

test("TOON comma and tab encodings round-trip JSON-compatible snapshots", () => {
  for (const formatter of [FORMATTERS.toonComma, FORMATTERS.toonTab]) {
    assertToonRoundTrip(snapshot, formatter(snapshot));
  }
});

test("TOON encoding is deterministic", () => {
  assert.equal(FORMATTERS.toonComma(snapshot), FORMATTERS.toonComma(snapshot));
  assert.equal(FORMATTERS.toonTab(snapshot), FORMATTERS.toonTab(snapshot));
});

test("strict decoding rejects a truncated declared array", () => {
  const encoded = encode({ rows: [{ id: 1 }, { id: 2 }] });
  const truncated = encoded.split("\n").slice(0, -1).join("\n");
  assert.throws(() => decode(truncated, { strict: true }), SyntaxError);
});

test("the codec does not provide secret redaction", () => {
  const sentinel = "SECRET_SENTINEL_DO_NOT_EXPOSE";
  assert.match(encode({ value: sentinel }), new RegExp(sentinel));
});

test("scaled snapshots retain shape and unique element ids", () => {
  const scaled = scaleSnapshot(snapshot, 3);
  assert.equal(scaled.nodes.length, 3);
  assert.equal(new Set(scaled.nodes.map((node) => node.id)).size, 3);
  assert.equal(createActionCatalog(scaled).length, 3);
});

test("dataset measurements include compact JSON and both TOON delimiters", () => {
  const measured = measureDataset("fixture", snapshot, { repetitions: 2 });
  assert.deepEqual(Object.keys(measured.formats), ["jsonCompact", "toonComma", "toonTab"]);
  for (const result of Object.values(measured.formats)) {
    assert.ok(result.utf8Bytes > 0);
    assert.ok(result.tokensO200kBase > 0);
    assert.ok(result.medianEncodeMs >= 0);
  }
});
