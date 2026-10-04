import { beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, link } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CASE_IDS, INITIAL_FIXTURE_STATE, canonical } from "../scripts/p4.2-fixture-contracts.mjs";
import { loadAcceptedCaptureOracle } from "../scripts/p4.3-capture-contracts.mjs";
import { SUITE_CAPTURE_IDS, SUITE_PROBE_IDS, SUITE_LIMITS, SUITE_ARTIFACT_NAMES, SUITE_SESSION_REF, suiteRequestId,
  rawSuiteDigest, admitSuiteReport, expandedComboExpectation, verifyNativeCaptureSuite, verifyNativeCapturePair,
  admitSuiteDirectoryPath, admitSuiteRunRootPath, readNativeCaptureSuite, admitSuiteUnitSummary } from "../scripts/p4.3-native-suite-contracts.mjs";
import { admitSuiteReviewMetadata, admitSuiteDecisionMetadata } from "../scripts/p4.3-native-suite-source.mjs";

// All fixtures in this file are SYNTHETIC verifier-negative/translation data.
// They are constructed from frozen expectations, NOT C# output, UIA observations,
// first/repeat native execution, OS admission or artifact-review evidence.
let oracle: any;
beforeAll(async () => { oracle = await loadAcceptedCaptureOracle(process.cwd()); }, 30_000);
const encode = (value: any) => new TextEncoder().encode(JSON.stringify(value));
const decode = (bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes));
describe("D2 pure suite unit-count admission (not native coverage)", () => {
  const summary = { kind: "p4.3-native-suite-unit", cases: 512, nativeExecuted: false };
  it.each([1, 256, 257, 512])("admits reviewed deterministic count %s without changing native caps", cases => {
    expect(admitSuiteUnitSummary(encode({ ...summary, cases }))).toEqual({ ...summary, cases });
    expect(SUITE_CAPTURE_IDS).toHaveLength(32); expect(CASE_IDS).toHaveLength(22);
    expect(SUITE_LIMITS.workerSeconds).toBe(240); expect(SUITE_LIMITS.observationSeconds).toBe(10);
  });
  it.each([0, 513, -1, 1.5, "512", null, Infinity])("rejects invalid/overflow pure count %s", cases => {
    expect(() => admitSuiteUnitSummary(encode({ ...summary, cases }))).toThrow();
  });
  it.each([{ ...summary, nativeExecuted: true }, { ...summary, extra: "data" }, { ...summary, kind: "p4.3-native-capture-suite" },
    [], null, {}, { ...summary, cases: undefined }])("rejects non-unit or unreviewed fields %#", value => {
    expect(() => admitSuiteUnitSummary(encode(value))).toThrow();
  });
  it("retains original byte/UTF8/BOM/decoded duplicate admission", () => {
    for (const bytes of [new Uint8Array(1025), new Uint8Array([0xc0, 0xaf]),
      new TextEncoder().encode('\ufeff' + JSON.stringify(summary)),
      new TextEncoder().encode(JSON.stringify(summary).slice(0, -1) + ',"cases":1}')])
      expect(() => admitSuiteUnitSummary(bytes)).toThrow();
  });
});
const trusted = { sourceDigest: "sha256:" + "1".repeat(64), collectorBinaryDigest: "sha256:" + "2".repeat(64),
  fixtureBinaryDigest: "sha256:" + "3".repeat(64) };
const hex = (n: number) => n.toString(16).padStart(32, "0");
const resetOrdinals = [1, 1, 2, 3, 3, 3, 4, 5, 6, 7, 8, 9, 10, 11, 11, 11, 12, 13, 14, 15, 16, 17, 18, 18, 19, 19, 20, 20, 21, 22, 23, 24];

function target(id: string) {
  const main = oracle.golden.normalizedCases.find((c: any) => c.id === id);
  if (main) return { snapshot: main.snapshot, state: main.after };
  if (id.endsWith("-open")) {
    const modal = oracle.golden.normalizedCases.find((c: any) => c.id === id.slice(0, -5));
    return { snapshot: modal.modalSnapshot, state: modal.before };
  }
  if (id === "combo-expanded") return { snapshot: expandedComboExpectation(oracle.golden, oracle.manifest), state: INITIAL_FIXTURE_STATE };
  const baseline = oracle.golden.normalizedCases.find((c: any) => c.id === (id === "value-repeat" ? "value" : "initial"));
  return { snapshot: baseline.snapshot, state: baseline.after };
}

function syntheticSuite(seed = 1) {
  const artifacts = new Map<string, Uint8Array>();
  const captures: any[] = [];
  let next = seed * 10_000, epoch = 0, publishedRoot = "", surface = "", revision = 0, fingerprint = "";
  let refs = new Map<string, string>();
  for (const [index, id] of SUITE_CAPTURE_IDS.entries()) {
    const expected = target(id), root = id.endsWith("-open") ? "modal" : "main";
    const resetOrdinal = resetOrdinals[index];
    if (resetOrdinal !== epoch || root !== publishedRoot) {
      epoch = resetOrdinal; publishedRoot = root; refs = new Map(); surface = "surface-" + hex(++next); revision = 0; fingerprint = "";
    }
    const correlations: string[] = [...new Set<string>([...expected.snapshot.nodes.map((n: any) => n.id), ...expected.snapshot.nodes
      .filter((n: any) => ["selection", "combo", "tabs"].includes(n.id) && n.state.value).map((n: any) => n.state.value)])].sort();
    for (const correlation of [...refs.keys()]) if (!correlations.includes(correlation)) refs.delete(correlation);
    for (const correlation of correlations) if (!refs.has(correlation)) refs.set(correlation, "element-" + hex(++next));
    const nodes = expected.snapshot.nodes.map((n: any) => {
      const node = structuredClone(n); node.id = refs.get(n.id);
      if (["selection", "combo", "tabs"].includes(n.id) && node.state.value) node.state.value = refs.get(node.state.value);
      return node;
    }).sort((a: any, b: any) => a.id < b.id ? -1 : 1);
    const inverse = correlations.map(correlation => ({ elementId: refs.get(correlation), correlation })).sort((a, b) => a.elementId! < b.elementId! ? -1 : 1);
    const nextFingerprint = canonical({ nodes, inverse });
    if (nextFingerprint !== fingerprint) { revision++; fingerprint = nextFingerprint; }
    const comparableSnapshot = { ...structuredClone(expected.snapshot), surfaceId: surface, revision: String(revision),
      generatedAt: "2026-10-04T00:00:00." + String(index).padStart(3, "0") + "Z",
      url: expected.snapshot.url.replace("native-fixture:", "native-uia:"), capabilities: ["snapshots"], nodes };
    const publicSnapshot = { ...structuredClone(comparableSnapshot), nodes: nodes.map((n: any) => ({ ...structuredClone(n), actions: [] })) };
    const publication = { publicSnapshot, comparableSnapshot, inverse };
    const response = (snapshot: any) => ({ schemaVersion: "0.1", kind: "snapshot-response", requestId: suiteRequestId(id),
      sessionRef: SUITE_SESSION_REF, surfaceRef: snapshot.surfaceId, snapshot });
    const publicationBytes = encode(publication), publicBytes = encode(response(publicSnapshot)), comparisonBytes = encode(response(comparableSnapshot)), oracleBytes = encode(expected.state);
    artifacts.set(id + ".capture.json", publicationBytes); artifacts.set(id + ".public-response.json", publicBytes);
    artifacts.set(id + ".comparison-response.json", comparisonBytes); artifacts.set(id + ".oracle.json", oracleBytes);
    const auxiliary = id === "combo-expanded" ? "popup" : id.endsWith("-open") ? "modal" : "none";
    captures.push({ id, publicationDigest: rawSuiteDigest(publicationBytes), publicEnvelopeDigest: rawSuiteDigest(publicBytes),
      comparisonEnvelopeDigest: rawSuiteDigest(comparisonBytes), oracleDigest: rawSuiteDigest(oracleBytes), resetOrdinal,
      roots: auxiliary === "none" ? 1 : 2, auxiliary });
  }
  const cases = CASE_IDS.map(id => {
    const probe = SUITE_PROBE_IDS.includes(id);
    const bytes = encode(INITIAL_FIXTURE_STATE);
    if (probe) artifacts.set(id + ".probe-before.json", bytes);
    return { id, probe: probe ? "provider_rejected_unchanged" : "not_probed", probeBeforeDigest: probe ? rawSuiteDigest(bytes) : null };
  });
  const report = { schemaVersion: "0.1", kind: "p4.3-native-capture-suite", ...trusted, recordedAt: "2026-10-04T01:00:00.000Z",
    host: { osBuild: "26100.1234", architecture: "X64", runtime: ".NET 10.0.1", culture: "en-US", uiCulture: "en-US" },
    limits: { ...SUITE_LIMITS }, cases, captures, toggleObserved: [true, false, true, false, true, false] };
  return { report, artifacts };
}
const verify = (input: ReturnType<typeof syntheticSuite>, binding = trusted) => verifyNativeCaptureSuite(encode(input.report), input.artifacts, binding, oracle);
const publication = (input: ReturnType<typeof syntheticSuite>, id: string) => decode(input.artifacts.get(id + ".capture.json")!);
function updateArtifact(input: ReturnType<typeof syntheticSuite>, name: string, bytes: Uint8Array, updateDigest = true) {
  input.artifacts.set(name, bytes);
  if (!updateDigest) return;
  const capture = input.report.captures.find((c: any) => name === c.id + ".capture.json" || name === c.id + ".public-response.json" ||
    name === c.id + ".comparison-response.json" || name === c.id + ".oracle.json");
  if (capture) {
    const key = name.endsWith(".capture.json") ? "publicationDigest" : name.endsWith(".public-response.json") ? "publicEnvelopeDigest" :
      name.endsWith(".comparison-response.json") ? "comparisonEnvelopeDigest" : "oracleDigest";
    capture[key] = rawSuiteDigest(bytes);
  } else input.report.cases.find((c: any) => name === c.id + ".probe-before.json")!.probeBeforeDigest = rawSuiteDigest(bytes);
}
function updatePublication(input: ReturnType<typeof syntheticSuite>, id: string, change: (p: any) => void) {
  const p = publication(input, id); change(p); updateArtifact(input, id + ".capture.json", encode(p));
  for (const [suffix, key] of [[".public-response.json", "publicSnapshot"], [".comparison-response.json", "comparableSnapshot"]]) {
    const response = decode(input.artifacts.get(id + suffix)!); response.surfaceRef = p[key].surfaceId; response.snapshot = p[key];
    updateArtifact(input, id + suffix, encode(response));
  }
}
function replaceRef(p: any, correlation: string, replacement: string) {
  const inverse = p.inverse.find((e: any) => e.correlation === correlation), prior = inverse.elementId; inverse.elementId = replacement;
  p.inverse.sort((a: any, b: any) => a.elementId < b.elementId ? -1 : 1);
  for (const key of ["publicSnapshot", "comparableSnapshot"]) {
    for (const node of p[key].nodes) { if (node.id === prior) node.id = replacement; if (node.state.value === prior && ["listbox", "combobox", "tablist"].includes(node.role)) node.state.value = replacement; }
    p[key].nodes.sort((a: any, b: any) => a.id < b.id ? -1 : 1);
  }
}

describe("P4.3 original-byte suite verifier (synthetic, no native execution)", () => {
  it("admits exact32 captures,22 main cases,2 modal roots,explicit popup and4 independent probe-before states", () => {
    const input = syntheticSuite();
    const result = verify(input);
    expect(result).toMatchObject({ status: "original_artifact_suite_verified", captures: 32, cases: 22, providerProbes: 4 });
    expect(result.retainedDigests).toHaveLength(132); expect(SUITE_ARTIFACT_NAMES).toHaveLength(132);
    expect(result.publications.get("modal-cancel-open").publicSnapshot.nodes).toHaveLength(3);
    expect(oracle.golden.normalizedCases).toHaveLength(22);
  });
  it("keeps expanded Combo expectation outside the frozen golden and preserves exact option metadata", () => {
    const before = canonical(oracle.golden), expanded = expandedComboExpectation(oracle.golden, oracle.manifest);
    expect(expanded.nodes.filter((n: any) => /^combo-[ab]$/.test(n.id))).toEqual([
      { id: "combo-a", role: "option", name: "Option A", state: { selected: true }, actions: [{ name: "select", risk: "write" }] },
      { id: "combo-b", role: "option", name: "Option B", state: { selected: false }, actions: [{ name: "select", risk: "write" }] },
    ]);
    expect(canonical(oracle.golden)).toBe(before);
  });
  it("accepts exact raw byte digest including harmless formatting, without replacing retained bytes", () => {
    const input = syntheticSuite(), name = "initial.public-response.json";
    const pretty = new TextEncoder().encode(JSON.stringify(decode(input.artifacts.get(name)!), null, 1));
    updateArtifact(input, name, pretty); expect(verify(input).status).toBe("original_artifact_suite_verified");
    expect(verify(input).retainedDigests.find((d: any) => d.name === name)?.digest).toBe(rawSuiteDigest(pretty));
  });
  it("does not invent wall-clock monotonicity or make time-only captures churn semantic revision", () => {
    const input = syntheticSuite(); input.report.recordedAt = "2026-10-03T00:00:00Z";
    updatePublication(input, "initial-repeat", p => { for (const key of ["publicSnapshot", "comparableSnapshot"]) p[key].generatedAt = "2000-01-01T00:00:00Z"; });
    const result = verify(input);
    expect(result.publications.get("initial-repeat").publicSnapshot.revision).toBe(result.publications.get("initial").publicSnapshot.revision);
  });

  const reportMutations: [string, (report: any) => void][] = [
    ["wrong source digest", r => { r.sourceDigest = "sha256:" + "4".repeat(64); }],
    ["wrong worker binary digest", r => { r.collectorBinaryDigest = "sha256:" + "4".repeat(64); }],
    ["wrong fixture binary digest", r => { r.fixtureBinaryDigest = "sha256:" + "4".repeat(64); }],
    ["unknown report field", r => { r.checks = { successful: true }; }],
    ["wrong report kind", r => { r.kind = "p4.2-real-uia-capture"; }],
    ["wrong host field", r => { r.host.pid = 1; }],
    ["non-X64 host", r => { r.host.architecture = "ARM64"; }],
    ["invalid culture", r => { r.host.culture = "../../private"; }],
    ["invalid recorded date", r => { r.recordedAt = "2026-02-30T01:00:00Z"; }],
    ["budget widening", r => { r.limits.nodes = 257; }],
    ["omitted budget", r => { delete r.limits.nativeCandidates; }],
    ["missing capture", r => { r.captures.pop(); }],
    ["reordered captures", r => { [r.captures[0], r.captures[1]] = [r.captures[1], r.captures[0]]; }],
    ["duplicate capture", r => { r.captures[1] = structuredClone(r.captures[0]); }],
    ["missing case", r => { r.cases.pop(); }],
    ["reordered cases", r => { [r.cases[0], r.cases[1]] = [r.cases[1], r.cases[0]]; }],
    ["wrong toggle observation", r => { r.toggleObserved[5] = true; }],
    ["missing closed provider rejection", r => { r.cases.find((c: any) => c.id === "disabled").probe = "not_probed"; }],
    ["invented probe", r => { r.cases[0].probe = "provider_rejected_unchanged"; }],
    ["unknown probe field", r => { r.cases[0].exception = "provider raw failure"; }],
    ["nullable probe digest on rejection", r => { r.cases.find((c: any) => c.id === "disabled").probeBeforeDigest = null; }],
    ["unknown capture field", r => { r.captures[0].nativeHandle = 1; }],
    ["missing popup root", r => { r.captures.find((c: any) => c.id === "combo-expanded").roots = 1; }],
    ["invented normal auxiliary", r => { r.captures[0].auxiliary = "popup"; }],
    ["zero reset ordinal", r => { r.captures[0].resetOrdinal = 0; }],
    ["epoch changes in repeat", r => { r.captures[1].resetOrdinal = 2; }],
    ["reset not advanced", r => { r.captures.find((c: any) => c.id === "invoke").resetOrdinal = 1; }],
    ["window reset not advanced", r => { r.captures.find((c: any) => c.id === "window-replacement").resetOrdinal = 21; }],
    ["restart reset not advanced", r => { r.captures.find((c: any) => c.id === "process-restart").resetOrdinal = 23; }],
  ];
  it.each(reportMutations)("rejects %s", (_name, change) => { const input = syntheticSuite(); change(input.report); expect(() => verify(input)).toThrow("native_capture_suite_refused"); });

  const artifactMutations: [string, (input: ReturnType<typeof syntheticSuite>) => void][] = [
    ["missing exact file", s => { s.artifacts.delete("initial.capture.json"); }],
    ["extra arbitrary file", s => { s.artifacts.set("raw-provider.json", encode({})); }],
    ["uncorrected raw digest", s => { updateArtifact(s, "initial.capture.json", new TextEncoder().encode(JSON.stringify(publication(s, "initial")) + " "), false); }],
    ["wrong public envelope state even corrected digest", s => { const e = decode(s.artifacts.get("initial.public-response.json")!); e.snapshot.title = "invented"; updateArtifact(s, "initial.public-response.json", encode(e)); }],
    ["wrong comparison envelope descriptor", s => { const e = decode(s.artifacts.get("initial.comparison-response.json")!); e.snapshot.nodes.find((n: any) => n.actions.length).actions[0].risk = "read"; updateArtifact(s, "initial.comparison-response.json", encode(e)); }],
    ["swapped public/comparison bytes", s => { const a = s.artifacts.get("initial.public-response.json")!, b = s.artifacts.get("initial.comparison-response.json")!; updateArtifact(s, "initial.public-response.json", b); updateArtifact(s, "initial.comparison-response.json", a); }],
    ["wrong exact request ref", s => { const e = decode(s.artifacts.get("initial.public-response.json")!); e.requestId = suiteRequestId("invoke"); updateArtifact(s, "initial.public-response.json", encode(e)); }],
    ["wrong exact session ref", s => { const e = decode(s.artifacts.get("initial.public-response.json")!); e.sessionRef = "arbitrary"; updateArtifact(s, "initial.public-response.json", encode(e)); }],
    ["wrong surface ref", s => { const e = decode(s.artifacts.get("initial.public-response.json")!); e.surfaceRef = "surface-" + hex(999); updateArtifact(s, "initial.public-response.json", encode(e)); }],
    ["envelope extra native field", s => { const e = decode(s.artifacts.get("initial.public-response.json")!); e.rawPid = 1; updateArtifact(s, "initial.public-response.json", encode(e)); }],
    ["oracle value forged", s => { updateArtifact(s, "value.oracle.json", encode({ ...INITIAL_FIXTURE_STATE, value: "invented", revision: 1 })); }],
    ["probe before altered", s => { updateArtifact(s, "readonly.probe-before.json", encode({ ...INITIAL_FIXTURE_STATE, value: "altered" })); }],
    ["probe-before digest drift", s => { s.report.cases.find((c: any) => c.id === "readonly")!.probeBeforeDigest = trusted.sourceDigest; }],
    ["oracle extra field", s => { updateArtifact(s, "initial.oracle.json", encode({ ...INITIAL_FIXTURE_STATE, sensitiveValue: "must not leak" })); }],
    ["publication sensitive field", s => { updatePublication(s, "initial", p => { for (const key of ["publicSnapshot", "comparableSnapshot"]) p[key].nodes.find((n: any) => n.state.sensitive).state.value = "must not leak"; }); }],
    ["main missing subject", s => { updatePublication(s, "initial", p => { for (const key of ["publicSnapshot", "comparableSnapshot"]) p[key].nodes.pop(); }); }],
    ["modal missing subject", s => { updatePublication(s, "modal-cancel-open", p => { for (const key of ["publicSnapshot", "comparableSnapshot"]) p[key].nodes.pop(); }); }],
    ["popup incomplete supplemental shape", s => { updatePublication(s, "combo-expanded", p => { const id = p.inverse.find((e: any) => e.correlation === "combo-b").elementId; for (const key of ["publicSnapshot", "comparableSnapshot"]) p[key].nodes = p[key].nodes.filter((n: any) => n.id !== id); }); }],
    ["unexpected focus never masked", s => { updatePublication(s, "initial", p => { for (const key of ["publicSnapshot", "comparableSnapshot"]) p[key].focusedElementId = p[key].nodes[0].id; }); }],
    ["selector-looking textbox not translated", s => { updatePublication(s, "value", p => { const id = p.inverse.find((e: any) => e.correlation === "value").elementId; for (const key of ["publicSnapshot", "comparableSnapshot"]) p[key].nodes.find((n: any) => n.id === id).state.value = p.inverse.find((e: any) => e.correlation === "selection-a").elementId; }); }],
    ["public action leak", s => { updatePublication(s, "initial", p => { p.publicSnapshot.nodes.find((n: any) => n.role === "checkbox").actions.push({ name: "toggle", risk: "write" }); }); }],
    ["inverse collision", s => { updatePublication(s, "initial", p => { p.inverse[1].elementId = p.inverse[0].elementId; }); }],
    ["wrong complete action schema", s => { updatePublication(s, "range", p => { p.comparableSnapshot.nodes.find((n: any) => n.role === "slider").actions[0].inputSchema.maximum = 11; }); }],
    ["malformed actual snapshot UTC", s => { updatePublication(s, "invoke", p => { for (const key of ["publicSnapshot", "comparableSnapshot"]) p[key].generatedAt = "2026-02-30T00:00:00Z"; }); }],
    ["original publication snapshot span over cap", s => { const raw = JSON.stringify(publication(s, "initial")).replace('"publicSnapshot":{', '"publicSnapshot":{' + " ".repeat(SUITE_LIMITS.snapshotBytes)); updateArtifact(s, "initial.capture.json", new TextEncoder().encode(raw)); }],
    ["original protocol envelope over cap", s => { const bytes = new TextEncoder().encode(new TextDecoder().decode(s.artifacts.get("initial.public-response.json")!) + " ".repeat(SUITE_LIMITS.snapshotBytes)); updateArtifact(s, "initial.public-response.json", bytes); }],
    ["original oracle over cap", s => { updateArtifact(s, "initial.oracle.json", new TextEncoder().encode(JSON.stringify(INITIAL_FIXTURE_STATE) + " ".repeat(4096))); }],
  ];
  it.each(artifactMutations)("rejects %s from original bytes even when metadata digests match", (_name, change) => { const input = syntheticSuite(); change(input); expect(() => verify(input)).toThrow("native_capture_suite_refused"); });

  const lifecycleMutations: [string, (input: ReturnType<typeof syntheticSuite>) => void][] = [
    ["unchanged repeat revision churn", s => updatePublication(s, "initial-repeat", p => { for (const key of ["publicSnapshot", "comparableSnapshot"]) p[key].revision = "2"; })],
    ["value repeat revision churn", s => updatePublication(s, "value-repeat", p => { for (const key of ["publicSnapshot", "comparableSnapshot"]) p[key].revision = "3"; })],
    ["changed value stale revision", s => updatePublication(s, "value", p => { for (const key of ["publicSnapshot", "comparableSnapshot"]) p[key].revision = "1"; })],
    ["changed value rotates surface", s => updatePublication(s, "value", p => { for (const key of ["publicSnapshot", "comparableSnapshot"]) p[key].surfaceId = "surface-" + hex(999999); })],
    ["unchanged shared value binding churn", s => updatePublication(s, "value", p => replaceRef(p, "value", "element-" + hex(999999)))],
    ["reset surface not rotated", s => { const old = publication(s, "initial").publicSnapshot.surfaceId; updatePublication(s, "invoke", p => { for (const key of ["publicSnapshot", "comparableSnapshot"]) p[key].surfaceId = old; }); }],
    ["reset element reused", s => { const old = publication(s, "initial").inverse.find((e: any) => e.correlation === "invoke").elementId; updatePublication(s, "invoke", p => replaceRef(p, "invoke", old)); }],
    ["replacement new dynamic control uses retired old reference", s => { const old = publication(s, "replacement-before").inverse.find((e: any) => e.correlation === "dynamic-a").elementId; updatePublication(s, "control-replacement", p => replaceRef(p, "dynamic-b", old)); }],
    ["replacement unrelated shared binding churn", s => updatePublication(s, "control-replacement", p => replaceRef(p, "invoke", "element-" + hex(999999)))],
    ["collapsed popup B reference resurrected", s => { const old = publication(s, "combo-expanded").inverse.find((e: any) => e.correlation === "combo-b").elementId; updatePublication(s, "combo", p => replaceRef(p, "combo-b", old)); }],
    ["collapsed A current selected ref churn", s => updatePublication(s, "combo-collapsed", p => replaceRef(p, "combo-a", "element-" + hex(999999)))],
    ["window same surface reused", s => { const old = publication(s, "window-before").publicSnapshot.surfaceId; updatePublication(s, "window-replacement", p => { for (const key of ["publicSnapshot", "comparableSnapshot"]) p[key].surfaceId = old; }); }],
    ["restart same root element reused", s => { const old = publication(s, "restart-before").inverse.find((e: any) => e.correlation === "fixture-window").elementId; updatePublication(s, "process-restart", p => replaceRef(p, "fixture-window", old)); }],
    ["modal root ref reused after close", s => { const old = publication(s, "modal-cancel-open").inverse.find((e: any) => e.correlation === "modal-window").elementId; updatePublication(s, "modal-cancel", p => replaceRef(p, "fixture-window", old)); }],
    ["older unrelated retired reference resurrected", s => { const old = publication(s, "initial").inverse.find((e: any) => e.correlation === "toggle").elementId; updatePublication(s, "range", p => replaceRef(p, "toggle", old)); }],
  ];
  it.each(lifecycleMutations)("derives and rejects %s instead of trusting success metadata", (_name, change) => { const input = syntheticSuite(); change(input); expect(() => verify(input)).toThrow("native_capture_suite_refused"); });

  it.each(["{\"a\":1,\"a\":2}", "{\"a\":1,\"\\u0061\":2}", "{\"a\":\"\\ud800\"}", "[1,]", "{}{}", "{\"a\":1e999}"])("rejects malformed raw report %s", raw => {
    expect(() => admitSuiteReport(new TextEncoder().encode(raw), trusted)).toThrow();
  });
  it.each(["initial.capture.json", "initial.public-response.json", "initial.comparison-response.json", "initial.oracle.json", "disabled.probe-before.json"])("rejects original duplicate-key bytes in %s despite matching digest", name => {
    const input = syntheticSuite(); updateArtifact(input, name, new TextEncoder().encode('{"x":1,"\\u0078":2}')); expect(() => verify(input)).toThrow();
  });
  it("rejects invalid UTF8/BOM/depth/oversized original report and does not emit raw diagnostics", () => {
    for (const bytes of [new Uint8Array([0xff]), new Uint8Array([0xef, 0xbb, 0xbf, 123, 125]), new TextEncoder().encode("[".repeat(18) + "0" + "]".repeat(18)), new Uint8Array(SUITE_LIMITS.reportBytes + 1)])
      expect(() => admitSuiteReport(bytes, trusted)).toThrow();
  });
  it("requires separately supplied exact trusted binding, not producer metadata", () => {
    const input = syntheticSuite(); expect(() => verify(input, { ...trusted, sourceDigest: "sha256:" + "9".repeat(64) })).toThrow();
    expect(() => verifyNativeCaptureSuite(encode(input.report), input.artifacts, input.report, oracle)).toThrow();
  });
  it("verifies independent first/repeat references from two fully admitted synthetic suites", () => {
    const first = verify(syntheticSuite(1)), repeat = verify(syntheticSuite(2));
    expect(verifyNativeCapturePair(first, repeat).status).toBe("original_artifact_first_repeat_verified");
    expect(() => verifyNativeCapturePair(first, first)).toThrow();
    expect(() => verifyNativeCapturePair(first, { ...repeat })).toThrow();
  });
  it("rejects shared first/repeat opaque references even if report bytes differ", () => {
    const firstInput = syntheticSuite(1), secondInput = syntheticSuite(1); secondInput.report.recordedAt = "2026-10-04T02:00:00Z";
    expect(() => verifyNativeCapturePair(verify(firstInput), verify(secondInput))).toThrow();
  });
  it("pair proof cannot be bypassed by replacing mutable returned maps/status with green tags", () => {
    const first = verify(syntheticSuite(1)), repeat = verify(syntheticSuite(1));
    first.publications.clear(); repeat.publications.clear(); first.reportDigest = "invented"; repeat.status = "invented";
    expect(() => verifyNativeCapturePair(first, repeat)).toThrow();
  });

  it("admits only exact native temporary first/repeat directory topology", () => {
    const temporary = resolve(tmpdir()), parent = join(temporary, "dual-surface-ui-native-evidence", "p4.3-capture-" + "a".repeat(32));
    expect(admitSuiteDirectoryPath(join(parent, "first"), temporary)).toBe(join(parent, "first"));
    expect(admitSuiteDirectoryPath(join(parent, "repeat"), temporary)).toBe(join(parent, "repeat"));
    expect(admitSuiteRunRootPath(parent, temporary)).toBe(parent);
    for (const path of [join(parent, "first"), join(temporary, "arbitrary"), parent + "\0", parent + "-suffix"])
      expect(() => admitSuiteRunRootPath(path, temporary)).toThrow();
    for (const path of [join(parent, "third"), join(parent, "first", "nested"), join(temporary, "first"), "../first", parent,
      join(temporary, "dual-surface-ui-native-evidence", "p4.3-capture-" + "A".repeat(32), "first"), join(parent, "first") + "\0"])
      expect(() => admitSuiteDirectoryPath(path, temporary)).toThrow();
  });

  async function fixtureDirectory() {
    const temporary = await mkdtemp(join(tmpdir(), "p43-suite-reader-unit-"));
    const directory = join(temporary, "dual-surface-ui-native-evidence", "p4.3-capture-" + "a".repeat(32), "first");
    await mkdir(join(directory, "fixture-records"), { recursive: true });
    const input = syntheticSuite();
    await writeFile(join(directory, "suite-report.json"), encode(input.report));
    for (const [name, bytes] of input.artifacts) await writeFile(join(directory, name), bytes);
    return { temporary, directory, input };
  }
  it("opens bounded original regular artifact bytes and verifies without reading arbitrary fixture recorder files", async () => {
    const { temporary, directory, input } = await fixtureDirectory();
    try {
      await writeFile(join(directory, "fixture-records", "not-a-selector.txt"), "not read by suite verifier");
      const read = await readNativeCaptureSuite(directory, temporary);
      expect(read.reportBytes).toEqual(Buffer.from(encode(input.report)));
      expect(verifyNativeCaptureSuite(read.reportBytes, read.artifacts, trusted, oracle).status).toBe("original_artifact_suite_verified");
      await writeFile(join(directory, "unreviewed-artifact.json"), "{}");
      await expect(readNativeCaptureSuite(directory, temporary)).rejects.toThrow();
    } finally { await rm(temporary, { recursive: true, force: true }); }
  });
  it("refuses oversized and nonregular files before any unbounded allocation", async () => {
    const { temporary, directory } = await fixtureDirectory();
    try {
      await writeFile(join(directory, "initial.oracle.json"), new Uint8Array(4097));
      await expect(readNativeCaptureSuite(directory, temporary)).rejects.toThrow();
      await rm(join(directory, "initial.oracle.json")); await mkdir(join(directory, "initial.oracle.json"));
      await expect(readNativeCaptureSuite(directory, temporary)).rejects.toThrow();
    } finally { await rm(temporary, { recursive: true, force: true }); }
  });
  it("refuses hard-linked artifact aliases through the opened file identity checks", async () => {
    const { temporary, directory } = await fixtureDirectory();
    try {
      await link(join(directory, "initial.oracle.json"), join(directory, "fixture-records", "alias.json"));
      await expect(readNativeCaptureSuite(directory, temporary)).rejects.toThrow();
    } finally { await rm(temporary, { recursive: true, force: true }); }
  });
});

describe("P4.3 source-governance metadata parser (synthetic, not an approval)", () => {
  const agents = ["/root/p42_security_review", "/root/p42_accessibility_interop_review", "/root/p42_package_gate_review"];
  const source = trusted.sourceDigest, stale = "sha256:" + "9".repeat(64);
  const review = (agent = agents[0]) => "# Synthetic parser review input\n\n" +
    "Reviewer agent: " + agent + "\nDisposition: source-approved\nReviewed source: " + source +
    "\nUnresolved Critical/High/Medium: 0\n\nParser testing only, not actual independent review.\n";
  const decision = () => "# Synthetic parser decision input\n\nNative execution: authorized for the frozen fixed suite only\n" +
    "Reviewed source: " + source + "\n\nParser testing only, not an actual execution authorization.\n";
  it.each(agents)("admits standalone metadata for the exact expected role %s", agent => {
    expect(() => admitSuiteReviewMetadata(review(agent), agent, source)).not.toThrow();
  });
  it("admits the distinct two-field execution entry without granting authority to this synthetic text", () => {
    expect(() => admitSuiteDecisionMetadata(decision(), source)).not.toThrow();
  });
  it("uses the same CRLF-to-LF normalization as source/blob admission", () => {
    expect(() => admitSuiteReviewMetadata(review().replaceAll("\n", "\r\n"), agents[0], source)).not.toThrow();
    expect(() => admitSuiteDecisionMetadata(decision().replaceAll("\n", "\r\n"), source)).not.toThrow();
  });
  const wrappers = ["<div hidden>", "<script>", "<pre>", "<template>", "<div>\n<pre>",
    "<!DOCTYPE hidden>", "<?hidden?>", "<!-- hidden", "<div>" ];
  it.each(wrappers)("rejects review metadata enclosed after heading by %s", opening => {
    const text = review().replace("\n\nReviewer agent:", "\n\n" + opening + "\nReviewer agent:") + "\n</div>\n";
    expect(() => admitSuiteReviewMetadata(text, agents[0], source)).toThrow("native_suite_source_refused");
  });
  it.each(wrappers)("rejects decision metadata enclosed after heading by %s", opening => {
    const text = decision().replace("\n\nNative execution:", "\n\n" + opening + "\nNative execution:") + "\n</div>\n";
    expect(() => admitSuiteDecisionMetadata(text, source)).toThrow("native_suite_source_refused");
  });
  const reviewNegatives: [string, (text: string) => string][] = [
    ["quoted all-fields block", text => text.split("\n").map(line => "> " + line).join("\n")],
    ["quoted single disposition", text => text.replace("Disposition: source-approved", '> Disposition: source-approved')],
    ["inline quoted disposition", text => text.replace("Disposition: source-approved", '"Disposition: source-approved"')],
    ["inline code disposition", text => text.replace("Disposition: source-approved", '`Disposition: source-approved`')],
    ["indented required field", text => text.replace("Disposition: source-approved", '    Disposition: source-approved')],
    ["backtick fenced required metadata", text => "```md\n" + text + "```\n"],
    ["tilde fenced required metadata", text => "~~~~markdown\n" + text + "~~~~\n"],
    ["longer backtick fence with shorter inner ticks", text => "````md\n```\n" + text + "````\n"],
    ["Unicode-containing fence info string", text => "```\u2028markdown\n" + text + "```\n"],
    ["unclosed fence after metadata", text => text + "```md\nunfinished history\n"],
    ["duplicate acceptable disposition", text => text + "\nDisposition: source-approved\n"],
    ["contradictory disposition", text => text + "\nDisposition: refused\n"],
    ["quoted historical acceptable disposition", text => text + '\n> History "Disposition: source-approved"\n'],
    ["fenced historical source marker", text => text + "\n~~~\nReviewed source: " + stale + "\n~~~\n"],
    ["inline historical-only disposition", text => text.replace("Disposition: source-approved", "Historical marker reference Disposition: source-approved")],
    ["stale reviewed source", text => text.replace(source, stale)],
    ["wrong expected reviewer role", text => text.replace(agents[0], agents[1])],
    ["unresolved Medium", text => text.replace("Unresolved Critical/High/Medium: 0", "Unresolved Critical/High/Medium: 1")],
    ["missing required field", text => text.replace("Unresolved Critical/High/Medium: 0\n", "")],
    ["unexpected reserved execution label", text => text + "\nNative execution: not authorized\n"],
    ["hidden HTML-comment metadata", text => "<!--\n" + text + "-->\n"],
    ["lazy blockquote continuation", text => text.replace("Reviewed source: " + source, "> Historical note\nReviewed source: " + source)],
    ["unclosed HTML comment", text => text + "\n<!-- unfinished\n"],
    ["BOM prefix", text => "\ufeff" + text],
    ["bare CR line breaks", text => text.replaceAll("\n", "\r")],
    ["malformed UTF16", text => text + "\ud800"],
    ["embedded NUL", text => text + "\0"],
    ["one-MiB byte overflow", text => text + "ก".repeat(350000)],
  ];
  it.each(reviewNegatives)("rejects %s without relying on a matching substring", (_name, mutate) => {
    expect(() => admitSuiteReviewMetadata(mutate(review()), agents[0], source)).toThrow("native_suite_source_refused");
  });
  const decisionNegatives: [string, (text: string) => string][] = [
    ["quoted decision marker", text => text.replace("Native execution:", "> Native execution:")],
    ["fenced decision marker", text => "~~~\n" + text + "~~~\n"],
    ["duplicate decision marker", text => text + "\nNative execution: authorized for the frozen fixed suite only\n"],
    ["contradictory execution decision", text => text + "\nNative execution: not authorized\n"],
    ["historical-only execution marker", text => text.replace("Native execution:", "History quotation Native execution:")],
    ["stale execution source", text => text.replace(source, stale)],
    ["unexpected reviewer metadata", text => text + "\nReviewer agent: " + agents[0] + "\n"],
    ["unexpected disposition metadata", text => text + "\nDisposition: source-approved\n"],
    ["missing source field", text => text.replace("Reviewed source: " + source + "\n", "")],
    ["broader authorization text", text => text.replace("authorized for the frozen fixed suite only", "authorized for any application")],
  ];
  it.each(decisionNegatives)("rejects %s in the distinct execution entry", (_name, mutate) => {
    expect(() => admitSuiteDecisionMetadata(mutate(decision()), source)).toThrow("native_suite_source_refused");
  });
  it("rejects nonallowlisted expected roles and malformed independently supplied source pins", () => {
    expect(() => admitSuiteReviewMetadata(review(), "/root", source)).toThrow();
    expect(() => admitSuiteReviewMetadata(review(), agents[0], source + "\n")).toThrow();
    expect(() => admitSuiteDecisionMetadata(decision(), source.toUpperCase())).toThrow();
  });
});
