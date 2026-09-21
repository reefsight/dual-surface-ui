import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Phase 3 readiness preflight", () => {
  it("keeps the exit audit closed while authority-bound evidence is absent", async () => {
    const result = spawnSync(process.execPath, ["scripts/check-phase3-readiness.mjs"], { cwd: process.cwd(), encoding: "utf8" });
    expect(result.status).toBe(0);
    const report = JSON.parse(await readFile(resolve(process.cwd(), ".phase3-preflight", "report.json"), "utf8"));
    expect(report.status).toBe("not_ready");
    expect(report.readyForP310).toBe(false);
    expect(report.summary).toEqual({ ready: 4, missing: 3, failed: 0 });
    expect(report.checks.filter((item: { status: string }) => item.status === "missing").map((item: { id: string }) => item.id)).toEqual(["p3.7.independent_security", "p3.8.actual_models", "p3.9.model_benchmark"]);
    expect(report.reportDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("fails the strict gate rather than treating missing evidence as success", () => {
    const result = spawnSync(process.execPath, ["scripts/check-phase3-readiness.mjs", "--require-ready"], { cwd: process.cwd(), encoding: "utf8" });
    expect(result.status).toBe(2);
  });
});
