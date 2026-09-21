import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const draftRoot = resolve(process.cwd(), ".phase3-preflight", "drafts");
const digest = `sha256:${"a".repeat(64)}`;
const review = { schemaVersion: "0.1", kind: "p3.7-independent-security-review", status: "approved", reviewedCommit: "a".repeat(40), corpusDigest: digest, matrixDigest: digest, reportDigest: digest, reviewer: { id: "reviewer-1", independent: true }, findings: [], unresolvedCriticalHigh: 0, disposition: "no_unresolved_critical_high" };
const run = (name: string) => spawnSync(process.execPath, ["scripts/validate-phase3-evidence.mjs", "security", resolve(draftRoot, name)], { cwd: process.cwd(), encoding: "utf8" });

describe("Phase 3 draft evidence validator", () => {
  beforeAll(async () => {
    await mkdir(draftRoot, { recursive: true });
    await writeFile(resolve(draftRoot, "ready.json"), JSON.stringify(review), "utf8");
    await writeFile(resolve(draftRoot, "not-ready.json"), JSON.stringify({ ...review, reviewer: { id: "reviewer-1", independent: false } }), "utf8");
    await writeFile(resolve(draftRoot, "invalid.json"), JSON.stringify({ kind: "p3.7-independent-security-review" }), "utf8");
  });

  it("accepts a contract-valid draft that satisfies the frozen gate", () => {
    const result = run("ready.json");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(expect.objectContaining({ type: "security", status: "gate_ready", contractValid: true, gateReady: true }));
  });

  it("separates a valid contract from an unsatisfied independence gate", () => {
    const result = run("not-ready.json");
    expect(result.status).toBe(3);
    expect(JSON.parse(result.stdout)).toEqual(expect.objectContaining({ status: "gate_not_ready", contractValid: true, gateReady: false }));
  });

  it("rejects malformed evidence without printing its contents", () => {
    const result = run("invalid.json");
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toEqual(expect.objectContaining({ status: "contract_invalid", contractValid: false, gateReady: false }));
    expect(result.stdout).not.toContain("reviewer-1");
  });
});
