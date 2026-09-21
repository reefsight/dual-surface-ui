import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Phase 3 OpenRouter free-model probe", () => {
  it("freezes a bounded, ZDR-only, no-retry exploratory plan without requiring a key", async () => {
    const output = execFileSync(process.execPath, ["scripts/run-phase3-openrouter-probe.mjs", "--dry-run"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {},
    });
    expect(JSON.parse(output)).toMatchObject({ status: "dry_run_ready", plannedCalls: 24 });
    const report = JSON.parse(await readFile(resolve(process.cwd(), ".phase3-preflight", "openrouter-free-probe.json"), "utf8"));
    expect(report).toMatchObject({
      kind: "phase3-openrouter-free-probe-dry-run",
      modelCount: 2,
      taskCount: 12,
      plannedCalls: 24,
      scope: "synthetic fixtures only; exploratory and not Phase 3 gate evidence",
    });
    expect(report.providerPolicies).toEqual([
      {
        requestModel: "inclusionai/ling-3.0-flash-vl:free",
        provider: { allow_fallbacks: false, data_collection: "deny", zdr: true, require_parameters: true },
      },
      {
        requestModel: "nex-agi/nex-n2.5-pro:free",
        provider: { allow_fallbacks: false, data_collection: "deny", require_parameters: true },
      },
    ]);
    expect(report.configDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(report.suiteFileDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});
