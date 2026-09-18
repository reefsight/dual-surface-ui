import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const report = JSON.parse(
  await readFile(new URL("../toon-codec-report.json", import.meta.url), "utf8"),
);

function dataset(name) {
  const result = report.datasets.find((candidate) => candidate.name === name);
  assert.ok(result, `Missing dataset: ${name}`);
  return result;
}

test("committed TOON report records strict safe-input round trips", () => {
  assert.deepEqual(report.safety, {
    inputSecretSentinelAbsent: true,
    commaRoundTrip: true,
    tabRoundTrip: true,
  });
});

test("current AgentSnapshot shapes reject the TOON adoption threshold", () => {
  for (const name of [
    "document-approval-snapshot",
    "document-approval-snapshot-scaled-20x",
  ]) {
    const formats = dataset(name).formats;
    assert.ok(formats.toonComma.tokenReductionVsCompactJsonPercent < 0);
    assert.ok(formats.toonTab.tokenReductionVsCompactJsonPercent < 0);
  }
});

test("uniform action projection clears the token-only experiment threshold", () => {
  const formats = dataset("uniform-action-catalog").formats;
  assert.ok(formats.toonComma.tokenReductionVsCompactJsonPercent >= 15);
  assert.ok(formats.toonTab.tokenReductionVsCompactJsonPercent >= 15);
});
