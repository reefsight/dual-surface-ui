import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { canonicalTextSha256 } from "../scripts/phase1-baseline-lib.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = resolve(
  projectRoot,
  "benchmarks",
  "phase1-document-approval-f5547f6.json",
);
const fixturePath = resolve(
  projectRoot,
  "examples",
  "document-approval",
  "index.html",
);

describe("committed Phase 1 baseline", () => {
  it("is tied to the unchanged fixture and records the frozen method", async () => {
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    const fixture = await readFile(fixturePath, "utf8");
    const fixtureSha256 = canonicalTextSha256(fixture);

    expect(report).toEqual(
      expect.objectContaining({
        schemaVersion: "1",
        benchmarkId: "phase1-document-approval-v1",
        mode: "deterministic-scripted-no-model",
        sourceCommit: "f5547f674018ef985b33538bc1776477d1a1fee3",
        fixtureSha256,
        latencyScope: expect.stringContaining("excludes DOM parse and setup"),
      }),
    );
    expect(report.context.estimator).toContain("not tokenizer output");
    expect(report.samples.latencyMs).toHaveLength(25);
    expect(report.samples.interactionSteps).toHaveLength(25);
    expect(report.samples.completed).toHaveLength(25);
  });

  it("retains complete safety results without serializing the sentinel", async () => {
    const serialized = await readFile(reportPath, "utf8");
    const report = JSON.parse(serialized);

    expect(report.workflow).toEqual(
      expect.objectContaining({
        repetitions: 25,
        completionSuccesses: 25,
        completionRate: 1,
        medianInteractionSteps: 4,
        wrongActionCount: 0,
        wrongActionRate: 0,
      }),
    );
    expect(report.safety).toEqual({
      confirmations: 25,
      secretLeaks: 0,
      unauthorizedConsequentialActions: 0,
    });
    expect(serialized).not.toContain("SECRET_SENTINEL_DO_NOT_EXPOSE");
  });
});
