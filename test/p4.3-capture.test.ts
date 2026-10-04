import { beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admitCapturePublication, compareCapturePublication, loadAcceptedCaptureOracle, parseCapturePublication,
  CAPTURE_LIMITS, readCapturePublication } from "../scripts/p4.3-capture-contracts.mjs";
import { identityExperimentLeaks } from "../scripts/check-p4.3-identity-package.mjs";

// Synthetic verifier mutation fixtures, deliberately constructed from the oracle
// to test rejection/translation. They are NOT C# output or real native evidence.
let oracle: any;
// Source pinning invokes bounded Git reads of the17 accepted files. Use the
// repository's30-second JS test budget, NOT a widened native observation budget.
beforeAll(async () => { oracle = await loadAcceptedCaptureOracle(process.cwd()); }, 30_000);
const encode = (value: any) => new TextEncoder().encode(JSON.stringify(value));
const element = (i: number) => "element-" + i.toString(16).padStart(32, "0");
function sample(expected: any) {
  const correlations = [...new Set([...expected.nodes.map((n: any) => n.id), ...expected.nodes
    .filter((n: any) => ["selection", "combo", "tabs"].includes(n.id) && n.state.value)
    .map((n: any) => n.state.value)])].sort();
  const byCorrelation = new Map(correlations.map((id, i) => [id, element(i + 1)]));
  const nodes = expected.nodes.map((n: any) => {
    const state = { ...n.state };
    if (["selection", "combo", "tabs"].includes(n.id) && state.value) state.value = byCorrelation.get(state.value);
    return { ...structuredClone(n), id: byCorrelation.get(n.id), state };
  }).sort((a: any, b: any) => a.id < b.id ? -1 : 1);
  const comparableSnapshot = { ...structuredClone(expected), surfaceId: "surface-" + "a".repeat(32), revision: "1",
    url: expected.url.replace("native-fixture:", "native-uia:"), generatedAt: "2026-10-04T00:00:00.0000000+00:00",
    capabilities: ["snapshots"], nodes };
  return { comparableSnapshot, publicSnapshot: { ...structuredClone(comparableSnapshot), nodes: nodes.map((n: any) => ({ ...structuredClone(n), actions: [] })) },
    inverse: correlations.map((correlation) => ({ correlation, elementId: byCorrelation.get(correlation) })) };
}
const first = () => oracle.golden.normalizedCases[0].snapshot;
const compare = (p: any, expected = first(), surface = "main") => compareCapturePublication(encode(p), expected, oracle.validators, oracle.manifest, surface);
const idFor = (p: any, correlation: string) => p.inverse.find((e: any) => e.correlation === correlation).elementId;
function alterBoth(p: any, correlation: string, mutation: (node: any) => void) {
  for (const key of ["publicSnapshot", "comparableSnapshot"]) mutation(p[key].nodes.find((n: any) => n.id === idFor(p, correlation)));
}

describe("P4.3 capture comparator foundation (synthetic, not native)", () => {
  it("verifies the unchanged pinned P4.2 oracle before using it", () => {
    expect(oracle.golden.normalizedCases).toHaveLength(22);
    expect(oracle.golden.sourceCommit).toBe("5c6b80e34fa8dab9a83d8771e6ee52bde63da272");
  });
  it("accepts narrow inverse translation for all22 main and both modal semantic shapes", () => {
    for (const c of oracle.golden.normalizedCases) {
      expect(compare(sample(c.snapshot), c.snapshot).status).toBe("semantic_comparison_passed");
      if (c.modalSnapshot) expect(compare(sample(c.modalSnapshot), c.modalSnapshot, "modal").subjects).toBe(3);
    }
  });
  it("keeps selected collapsed combo identity private and duplicate labels distinct", () => {
    const p = sample(first()); const q = admitCapturePublication(encode(p), oracle.validators, oracle.manifest);
    const combo = q.comparableSnapshot.nodes.find((n: any) => n.id === idFor(p, "combo"));
    expect(combo.state.value).toBe(idFor(p, "combo-a"));
    expect(q.publicSnapshot.nodes.some((n: any) => n.id === combo.state.value)).toBe(false);
    expect(idFor(p, "selection-a")).not.toBe(idFor(p, "selection-b"));
  });
  it("never rewrites an arbitrary selector-looking textbox value", () => {
    const expected = structuredClone(first()); expected.nodes.find((n: any) => n.id === "value").state.value = "selection-a";
    const p = sample(expected); expect(compare(p, expected).status).toBe("semantic_comparison_passed");
    alterBoth(p, "value", n => { n.state.value = idFor(p, "selection-a"); });
    expect(() => compare(p, expected)).toThrow();
  });
  const mutations: [string, (p: any) => void][] = [
    ["missing subject", p => { alterBoth(p, "toggle", n => { n.id = element(999); }); }],
    ["extra subject", p => { for (const key of ["publicSnapshot", "comparableSnapshot"]) p[key].nodes.push({ id: element(999), role: "text", name: "extra", state: {}, actions: [] }); }],
    ["duplicate subject", p => { for (const key of ["publicSnapshot", "comparableSnapshot"]) p[key].nodes.push(structuredClone(p[key].nodes[0])); }],
    ["wrong name", p => alterBoth(p, "toggle", n => { n.name = "wrong"; })],
    ["wrong role", p => alterBoth(p, "toggle", n => { n.role = "button"; })],
    ["wrong state", p => alterBoth(p, "toggle", n => { n.state.checked = true; })],
    ["omitted false state", p => alterBoth(p, "toggle", n => { delete n.state.checked; })],
    ["wrong descriptor", p => { p.comparableSnapshot.nodes.find((n: any) => n.id === idFor(p, "toggle")).actions[0].name = "click"; }],
    ["weakened schema", p => { p.comparableSnapshot.nodes.find((n: any) => n.id === idFor(p, "value")).actions[0].inputSchema.maxLength = 65; }],
    ["oracle-hardcoded range bounds mismatch", p => { p.comparableSnapshot.nodes.find((n: any) => n.id === idFor(p, "range")).actions[0].inputSchema.maximum = 11; }],
    ["inverse ID collision", p => { p.inverse[1].elementId = p.inverse[0].elementId; }],
    ["inverse correlation collision", p => { p.inverse[1].correlation = p.inverse[0].correlation; }],
    ["missing inverse", p => { p.inverse.splice(0, 1); }],
    ["unknown inverse", p => { p.inverse[0].correlation = "provider-wrapper"; }],
    ["orphan inverse", p => { p.inverse.push({ elementId: element(999), correlation: "combo-b" }); }],
    ["inverse extra field", p => { p.inverse[0].nativeHandle = 1; }],
    ["missing collapsed relation", p => { p.inverse = p.inverse.filter((e: any) => e.correlation !== "combo-a"); }],
    ["wrong selected container reference", p => alterBoth(p, "combo", n => { n.state.value = idFor(p, "selection-a"); })],
    ["selected peer contradictory flag", p => alterBoth(p, "selection-a", n => { n.state.selected = false; })],
    ["unexpected focus", p => { for (const key of ["publicSnapshot", "comparableSnapshot"]) p[key].focusedElementId = p[key].nodes[0].id; }],
    ["unexpected bounds", p => alterBoth(p, "toggle", n => { n.bounds = { x: 0, y: 0, width: 1, height: 1 }; })],
    ["unexpected description", p => alterBoth(p, "toggle", n => { n.description = "unreviewed"; })],
    ["unexpected capability", p => { for (const key of ["publicSnapshot", "comparableSnapshot"]) p[key].capabilities.push("actions"); }],
    ["public action leak", p => { p.publicSnapshot.nodes.find((n: any) => n.id === idFor(p, "toggle")).actions.push({ name: "toggle", risk: "write" }); }],
    ["public state diverges", p => { p.publicSnapshot.nodes.find((n: any) => n.id === idFor(p, "toggle")).state.checked = true; }],
    ["private selector ID", p => alterBoth(p, "toggle", n => { n.id = "toggle"; })],
    ["wrong fixed URL", p => { for (const key of ["publicSnapshot", "comparableSnapshot"]) p[key].url = "native-uia://other/main"; }],
    ["wrong title", p => { for (const key of ["publicSnapshot", "comparableSnapshot"]) p[key].title = "invented"; }],
    ["revision overflow", p => { for (const key of ["publicSnapshot", "comparableSnapshot"]) p[key].revision = "18446744073709551616"; }],
    ["timestamp malformed", p => { for (const key of ["publicSnapshot", "comparableSnapshot"]) p[key].generatedAt = "yesterday"; }],
    ["snapshot order unsorted", p => { for (const key of ["publicSnapshot", "comparableSnapshot"]) p[key].nodes.reverse(); }],
    ["inverse order unsorted", p => { p.inverse.reverse(); }],
    ["sensitive content leak", p => alterBoth(p, "sensitive", n => { n.state.value = "never read me"; })],
    ["sensitive name leak", p => alterBoth(p, "sensitive", n => { n.name = "provider sensitive name"; })],
    ["extra publication field", p => { p.rawRuntimeId = [1, 2]; }],
    ["empty publication", p => { delete p.publicSnapshot; }],
  ];
  it.each(mutations)("refuses %s without broad normalization", (_name, mutation) => {
    const p = sample(first()); mutation(p); expect(() => compare(p)).toThrow();
  });
  it("rejects wrong immutable golden pins", async () => {
    // Load function pins the actual oracle; semantic mutations cannot be passed
    // as a different golden envelope to translation without exact comparison.
    const bad = structuredClone(first()); bad.url = "native-fixture://other/main";
    expect(() => compare(sample(first()), bad)).toThrow();
  });
  it.each(["{\"a\":1,\"a\":2}", "{\"a\":1,\"\\u0061\":2}", "{\"x\":\"\\ud800\"}", "[1,]", "{\"x\":1e999}", "{}{}"])("rejects malformed or duplicate-key raw bytes %s", raw => {
    expect(() => parseCapturePublication(new TextEncoder().encode(raw))).toThrow();
  });
  it("rejects invalid UTF8, BOM, depth and byte overflow", () => {
    expect(() => parseCapturePublication(new Uint8Array([0xff]))).toThrow();
    expect(() => parseCapturePublication(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]))).toThrow();
    expect(() => parseCapturePublication(new TextEncoder().encode("[".repeat(18) + "0" + "]".repeat(18)))).toThrow();
    expect(() => parseCapturePublication(new Uint8Array(CAPTURE_LIMITS.reportBytes + 1))).toThrow();
  });
  it("enforces original snapshot bytes before compact re-encoding", () => {
    const p = sample(first()); const raw = JSON.stringify(p).replace('"publicSnapshot":{', '"publicSnapshot":{'+ " ".repeat(CAPTURE_LIMITS.snapshotBytes));
    expect(() => compareCapturePublication(new TextEncoder().encode(raw), first(), oracle.validators, oracle.manifest)).toThrow();
  });
  it("does not publish capture source/binaries through package isolation", () => {
    const paths = ["experiments/windows-uia/managed-reference/CaptureHarness/CopiedObservation.cs",
      "experiments/windows-uia/managed-reference/CaptureHarness/bin/Release/a.dll"];
    expect(identityExperimentLeaks(paths)).toEqual(paths);
  });
  it("keeps owned unit worker raw stdout/stderr out of console publication", async () => {
    const source = await readFile("scripts/run-p4.3-capture-unit.ps1", "utf8");
    expect(source).not.toMatch(/Write-Output\s+\$(?:err|out)\b/);
    expect(source).toContain("if ($err) { throw 'Capture unit worker reported stderr; raw diagnostic withheld.' }");
    expect(source).toContain("scripts/verify-p4.3-capture-unit.mjs");
  });
  it("reads exact regular-file bytes through one bounded opened handle", async () => {
    const directory = await mkdtemp(join(tmpdir(), "p43-capture-reader-unit-"));
    const path = join(directory, "synthetic-publication.json");
    try {
      const bytes = encode(sample(first())); await writeFile(path, bytes);
      expect(await readCapturePublication(path)).toEqual(Buffer.from(bytes));
      await writeFile(path, new Uint8Array(CAPTURE_LIMITS.reportBytes + 1));
      await expect(readCapturePublication(path)).rejects.toThrow();
      await expect(readCapturePublication(directory)).rejects.toThrow();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
