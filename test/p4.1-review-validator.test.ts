import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

const draftRoot = resolve(process.cwd(), ".phase4-preflight", "drafts");
const review = {
  schemaVersion: "0.1",
  kind: "p4.1-independent-protocol-review",
  status: "approved",
  reviewedCommit: "033738e3c265d5b615630b6f9bee78c7fc897806",
  messageCorpusDigest: "sha256:1e783a3be9098efc776ce8771e1ce9d44bf5c89eff9913e472fc686c5fa7b241",
  sessionCorpusDigest: "sha256:9be355e4276a9d0249927693144f084b0fb52316cb92f3ba5f08440762e72692",
  reviewer: { id: "reviewer-1", independent: true },
  scopes: { protocol: "approved", security: "approved", interoperability: "approved", package: "approved" },
  findings: [],
  unresolvedCriticalHigh: 0,
  disposition: "no_unresolved_critical_high",
};
const run = (name: string) => spawnSync(
  process.execPath,
  ["scripts/validate-p4.1-review.mjs", resolve(draftRoot, name)],
  { cwd: process.cwd(), encoding: "utf8" },
);

describe("P4.1 independent review validator", () => {
  beforeAll(async () => {
    await mkdir(draftRoot, { recursive: true });
    await writeFile(resolve(draftRoot, "ready.json"), JSON.stringify(review), "utf8");
    await writeFile(resolve(draftRoot, "not-independent.json"), JSON.stringify({
      ...review,
      reviewer: { id: "reviewer-1", independent: false },
    }), "utf8");
    await writeFile(resolve(draftRoot, "open-high.json"), JSON.stringify({
      ...review,
      findings: [{ id: "finding-1", severity: "high", status: "open", summary: "Open high finding" }],
    }), "utf8");
    await writeFile(resolve(draftRoot, "invalid.json"), JSON.stringify({ kind: review.kind }), "utf8");
  });

  it("accepts only an independent four-scope approval bound to frozen evidence", () => {
    const result = run("ready.json");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(expect.objectContaining({
      status: "gate_ready", contractValid: true, gateReady: true,
    }));
  });

  it.each(["not-independent.json", "open-high.json"])(
    "keeps a contract-valid but unsafe review outside the gate: %s",
    (name) => {
      const result = run(name);
      expect(result.status).toBe(3);
      expect(JSON.parse(result.stdout)).toEqual(expect.objectContaining({
        status: "gate_not_ready", contractValid: true, gateReady: false,
      }));
    },
  );

  it("rejects malformed evidence without echoing reviewer content", () => {
    const result = run("invalid.json");
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toEqual(expect.objectContaining({
      status: "contract_invalid", contractValid: false, gateReady: false,
    }));
    expect(result.stdout).not.toContain("reviewer-1");
  });
});
