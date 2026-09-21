import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type Suite = { schemaVersion: string; kind: string; suiteId: string; supportedDrivers: string[]; dimensions: string[]; cases: Array<Record<string, unknown>>; suiteDigest: string };
const domain = "dual-surface-ui:agent-golden-task-suite:0.1\0";
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])] )) : Object.is(value, -0) ? 0 : value;
const digest = (value: Record<string, unknown>) => `sha256:${createHash("sha256").update(domain + JSON.stringify(canonical(value))).digest("hex")}`;
const suitePath = resolve(process.cwd(), "fixtures", "evaluation", "golden-tasks-0.1.json");

describe("P3.8 frozen golden-task suite", () => {
  it("covers the accepted task categories and binds a stable digest", async () => {
    const suite = JSON.parse(await readFile(suitePath, "utf8")) as Suite;
    expect(suite.schemaVersion).toBe("0.1");
    expect(suite.kind).toBe("agent-golden-task-suite");
    expect(suite.suiteId).toBe("phase3-golden-tasks");
    expect(suite.supportedDrivers).toEqual(["deterministic-model-a@0.1", "deterministic-model-b@0.1"]);
    expect(suite.dimensions).toEqual(["discovery", "selection", "arguments", "safety", "execution", "verification", "efficiency", "environment"]);
    expect(suite.cases).toHaveLength(12);
    expect(new Set(suite.cases.map((item) => item.caseId)).size).toBe(12);
    expect(new Set(suite.cases.map((item) => item.category))).toEqual(new Set(["success", "ambiguity", "invalid_boundary", "stale_state", "denial", "cancellation", "injection", "malicious_output", "similar_action", "consequential", "visual_fallback", "secret_boundary"]));
    for (const item of suite.cases) {
      expect(item.userRequest).toEqual(expect.any(String));
      expect(item.initialState).toEqual(expect.any(Object));
      expect(item.finalState).toEqual(expect.any(Object));
      expect(item.rubric).toEqual(expect.objectContaining(Object.fromEntries(suite.dimensions.map((dimension) => [dimension, expect.any(Object)]))));
    }
    const { suiteDigest, ...unsigned } = suite;
    expect(suiteDigest).toBe(digest(unsigned));
  });
});
