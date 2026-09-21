import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("P3.9 structural benchmark", () => {
  it("measures every frozen task while preserving unavailable claims", async () => {
    execFileSync(process.execPath, ["scripts/run-p3.9-structural-benchmark.mjs"], { cwd: process.cwd(), stdio: "pipe" });
    const report = JSON.parse(await readFile(resolve(process.cwd(), ".benchmark-evidence", "p3.9-structural-report.json"), "utf8"));
    expect(report.kind).toBe("phase3-structural-benchmark-report");
    expect(report.measurements).toHaveLength(48);
    expect(report.summaries.map((item: { baseline: string }) => item.baseline)).toEqual(["dual-surface-semantic", "full-page-dom", "playwright-accessibility", "vision-screenshot"]);
    expect(report.measurements.filter((item: { baseline: string }) => item.baseline === "vision-screenshot")).toHaveLength(12);
    expect(report.summaries.slice(0, 3).every((item: { taskCount: number; contextTokens: null; tokenAccounting: string }) => item.taskCount === 12 && item.contextTokens === null && item.tokenAccounting === "unavailable")).toBe(true);
    expect(report.quality).toEqual(expect.objectContaining({ completion: null, wrongActionRate: null, safety: null, reason: "no authorized model run" }));
    expect(report.nonClaims).toContain("no real-OS native proof");
    expect(report.reportDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});
