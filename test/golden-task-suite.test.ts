import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

type Suite = { schemaVersion: string; kind: string; suiteId: string; supportedDrivers: string[]; dimensions: string[]; cases: Array<Record<string, unknown>>; suiteDigest: string };
const domain = "dual-surface-ui:agent-golden-task-suite:0.4\0";
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])] )) : Object.is(value, -0) ? 0 : value;
const digest = (value: Record<string, unknown>) => `sha256:${createHash("sha256").update(domain + JSON.stringify(canonical(value))).digest("hex")}`;
const suitePath = resolve(process.cwd(), "fixtures", "evaluation", "golden-tasks-0.4.json");
const schemaPath = resolve(process.cwd(), "fixtures", "evaluation", "golden-task-suite-0.4.schema.json");

describe("P3.8 frozen golden-task suite", () => {
  it("covers the accepted task categories and binds a stable digest", async () => {
    const suite = JSON.parse(await readFile(suitePath, "utf8")) as Suite;
    const schema = JSON.parse(await readFile(schemaPath, "utf8"));
    const validate = new Ajv2020({ strict: true }).compile(schema);
    expect(validate(suite), JSON.stringify(validate.errors)).toBe(true);
    expect(suite.schemaVersion).toBe("0.4");
    expect(suite.kind).toBe("agent-golden-task-suite");
    expect(suite.suiteId).toBe("phase3-golden-tasks");
    expect(suite.supportedDrivers).toEqual(["openai-gpt-5.6-luna-none@0.4", "openai-gpt-5.6-luna-low@0.4"]);
    expect(suite.dimensions).toEqual(["discovery", "selection", "arguments", "safety", "execution", "verification", "efficiency", "environment"]);
    expect(suite.cases).toHaveLength(12);
    expect(new Set(suite.cases.map((item) => item.caseId)).size).toBe(12);
    expect(new Set(suite.cases.map((item) => item.category))).toEqual(new Set(["success", "ambiguity", "invalid_boundary", "stale_state", "denial", "cancellation", "injection", "malicious_output", "similar_action", "consequential", "visual_fallback", "secret_boundary"]));
    for (const item of suite.cases) {
      expect(item.input).toEqual(expect.objectContaining({ trustedUserRequest: expect.any(String), initialState: expect.any(Object), protocol: expect.any(Object), actions: expect.any(Array), untrustedContent: expect.any(Array) }));
      expect(item.input.actions).toEqual(expect.arrayContaining([expect.objectContaining({ postcondition: expect.any(Object) })]));
      expect(item.oracle).toEqual(expect.objectContaining({ decision: expect.any(String), finalState: expect.any(Object), forbiddenActions: expect.any(Array) }));
      expect(item.rubric).toEqual(expect.objectContaining(Object.fromEntries(suite.dimensions.map((dimension) => [dimension, expect.any(Object)]))));
    }
    const injection = suite.cases.find((item) => item.caseId === "page-injection") as { input: { trustedUserRequest: string; untrustedContent: Array<{ text: string }> }; oracle: { action: string } };
    expect(injection.input.trustedUserRequest).toContain("Approve");
    expect(injection.input.untrustedContent[0]?.text).toContain("delete");
    expect(injection.oracle.action).toBe("approve");
    const stale = suite.cases.find((item) => item.caseId === "stale-state") as { input: { initialState: { observedRevision: string; currentRevision: string } }; oracle: { decision: string } };
    expect(stale.input.initialState.observedRevision).not.toBe(stale.input.initialState.currentRevision);
    expect(stale.oracle.decision).toBe("refuse");
    const { suiteDigest, ...unsigned } = suite;
    expect(suiteDigest).toBe(digest(unsigned));
  });
});
