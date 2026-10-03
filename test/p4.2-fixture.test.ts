import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFixtureValidators, validateManifest, normalizeTree, readBoundedJson, verifyCapture, INITIAL_FIXTURE_STATE, CASE_IDS, CAPTURE_SCHEMA, canonical, sha256 } from "../scripts/p4.2-fixture-contracts.mjs";
import { FIXTURE_SOURCE_PATHS, verifyRepeatedCaptures, verifyGolden } from "../scripts/p4.2-golden-contracts.mjs";
import { nativeFixtureLeaks } from "../scripts/check-native-fixture-package.mjs";

let manifest: any;
let validators: any;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
beforeAll(async () => {
  manifest = JSON.parse(await readFile(resolve("fixtures/native/windows-app/manifest-0.1.json"), "utf8"));
  validators = await loadFixtureValidators(process.cwd());
});
const providerNode = (id: string, extra = {}) => {
  const definition = manifest.controls.find((entry: any) => entry.id === id);
  return { id, parentId: "fixture-window", name: definition.name, controlType: definition.type,
    frameworkId: "WPF", enabled: true, offscreen: false, focused: false, sensitive: id === "sensitive",
    rectangle: "visible", patterns: definition.patterns, values: {}, instanceRef: "sha256:" + "a".repeat(64), ...extra };
};
const tree = (nodes: any[]) => ({ processRef: "sha256:" + "b".repeat(64), windowRef: "sha256:" + "c".repeat(64),
  nodes: nodes.map(node => ({ ...node, parentId: nodes.some(parent => parent.id === node.parentId) ? node.parentId : null })) });

// Negative/admission unit-test input only, never claimed as real OS evidence.
function captureModel(): any {
  const transitions: Record<string, any> = { invoke: { count: 1 }, value: { value: "updated" }, "toggle-check": { toggle: true },
    "toggle-repeat": { revision: 6 }, selection: { selection: "selection-b" }, radio: { radio: "radio-b" }, tab: { tab: "tab-b" },
    expand: { expanded: true }, range: { range: 7 }, combo: { combo: "combo-b" }, injection: { count: 1 },
    "control-replacement": { generation: 2 }, "modal-cancel": { modalResult: "cancelled" }, "modal-confirm": { modalResult: "confirmed" } };
  const dispositions: Record<string, string> = { initial: "captured", "toggle-repeat": "verified", disabled: "provider_rejected_unchanged",
    "disabled-toggle": "provider_rejected_unchanged", readonly: "provider_rejected_unchanged", "range-boundary": "provider_rejected_unchanged",
    "sensitive-unsupported-hidden-offscreen": "metadata_only", "control-replacement": "old_binding_invalidated",
    "modal-cancel": "cancelled", "modal-confirm": "confirmed", "window-replacement": "identity_changed", "process-restart": "identity_changed_state_reset" };
  const rawFor = (state: any) => tree(manifest.controls.filter((c: any) => !c.id.startsWith("modal-") && c.id !== "hidden" &&
    c.id !== (state.generation === 1 ? "dynamic-b" : "dynamic-a") && (state.expanded || c.id !== "expanded-child")).map((c: any) => {
      const values: any = {};
      if (c.id === "value") Object.assign(values, { value: state.value, readOnly: false });
      if (c.id === "readonly") Object.assign(values, { value: "read only", readOnly: true });
      if (c.id === "toggle" || c.id === "disabled-toggle") values.checked = c.id === "toggle" && state.toggle;
      if (c.id === "range") Object.assign(values, { range: state.range, minimum: 0, maximum: 10, readOnly: false });
      if (c.id === "expand") values.expanded = state.expanded;
      if (c.id === "combo") values.selection = [state.combo];
      if (c.id === "selection") values.selection = [state.selection];
      if (c.id === "tabs") values.selection = [state.tab];
      for (const key of ["selection", "combo", "radio", "tab"]) if (c.id === `${key}-a` || c.id === `${key}-b`) values.selected = state[key] === c.id;
      const offscreen = c.id === "offscreen" || c.id.startsWith("combo-");
      return providerNode(c.id, { values, parentId: c.id === "fixture-window" ? null : "fixture-window",
        enabled: !["disabled", "disabled-toggle"].includes(c.id), offscreen, rectangle: offscreen ? "offscreen" : "visible" });
    }));
  const cases = CASE_IDS.map(id => {
    const after = { ...INITIAL_FIXTURE_STATE, ...(transitions[id] ? { revision: 1, ...transitions[id] } : {}) };
    const entry: any = { id, disposition: dispositions[id] ?? "succeeded", before: clone(INITIAL_FIXTURE_STATE), after, raw: rawFor(after) };
    if (id === "toggle-repeat") entry.observed = [true, false, true, false, true, false];
    if (id.startsWith("modal-")) entry.modalRaw = { ...tree([providerNode("modal-window", { parentId: null }), providerNode("modal-confirm", { parentId: "modal-window" }), providerNode("modal-cancel", { parentId: "modal-window" })]), windowRef: "sha256:" + "2".repeat(64) };
    if (id === "control-replacement") Object.assign(entry, { staleProviderOutcome: "retained_callable", staleProbeBefore: clone(after), staleProbeAfter: { ...after, count: 1, revision: 2 } });
    if (id === "window-replacement") { entry.raw.windowRef = "sha256:" + "d".repeat(64); entry.oldWindowProviderOutcome = "retained_metadata"; }
    if (id === "process-restart") { entry.raw.processRef = "sha256:" + "e".repeat(64); entry.raw.windowRef = "sha256:" + "f".repeat(64); }
    return entry;
  });
  return { schemaVersion: "0.1", kind: "p4.2-real-uia-capture", captureToolVersion: "0.1", seed: "p4.2-seed-1",
    fixtureBinaryDigest: "sha256:" + "1".repeat(64), host: { osBuild: "26200.1", architecture: "X64", runtime: ".NET 10.0.9",
      culture: "en-US", uiCulture: "en-US", keyboardLayoutId: "00000409", windowDpi: 96, displayScale: 1, uiAutomationCoreVersion: "10.0.26200.1" },
    cases, events: [{ sequence: 1, targetId: "toggle", property: "TogglePatternIdentifiers.ToggleStateProperty" }] };
}
function repeatModel(input: any): any {
  const repeat = clone(input);
  const refs: Record<string, string> = { b: "8", e: "9", c: "3", d: "4", f: "5", "2": "6", a: "7" };
  for (const entry of repeat.cases) for (const raw of [entry.raw, entry.modalRaw].filter(Boolean)) {
    for (const key of ["processRef", "windowRef"]) raw[key] = "sha256:" + refs[raw[key][7]].repeat(64);
    for (const node of raw.nodes) node.instanceRef = "sha256:" + "7".repeat(64);
  }
  return repeat;
}

describe("P4.2 controlled fixture contract", () => {
  it("accepts stable IDs and rejects duplicate or runtime-derived identity", () => {
    expect(() => validateManifest(manifest, validators)).not.toThrow();
    const duplicate = clone(manifest); duplicate.controls.push(duplicate.controls[0]);
    expect(() => validateManifest(duplicate, validators)).toThrow("fixture_manifest_invalid");
    const runtime = clone(manifest); runtime.controls[0].id = "0x1234";
    expect(() => validateManifest(runtime, validators)).toThrow("fixture_manifest_invalid");
  });
  it("rejects caller authority, changed limits, and an action without its provider pattern", () => {
    const injected = { ...manifest, principal: "administrator" };
    expect(() => validateManifest(injected, validators)).toThrow("fixture_manifest_invalid");
    const changed = clone(manifest); changed.budgets.reportBytes++;
    expect(() => validateManifest(changed, validators)).toThrow("fixture_manifest_invalid");
    const pattern = clone(manifest); pattern.controls.find((c: any) => c.id === "invoke").patterns = [];
    expect(() => validateManifest(pattern, validators)).toThrow("fixture_action_pattern_mismatch");
  });
  it("maps current provider value and toggle state to schema-valid core snapshots", () => {
    const before = tree([providerNode("value", { values: { value: "initial", readOnly: false } }), providerNode("toggle", { values: { checked: true } })]);
    const first = normalizeTree(before, manifest, { revision: 1 });
    expect(validators.snapshot(first)).toBe(true);
    expect(first.nodes.find((n: any) => n.id === "toggle").state.checked).toBe(true);
    before.nodes[1].values.checked = false;
    const next = normalizeTree(before, manifest, { revision: 2 });
    expect(next.nodes.find((n: any) => n.id === "toggle").state.checked).toBe(false);
    expect(next.nodes.find((n: any) => n.id === "value").state.value).toBe("initial");
  });
  it("removes mutation actions on disabled, read-only, and sensitive controls", () => {
    const input = tree([providerNode("disabled", { enabled: false }), providerNode("readonly", { values: { value: "read only", readOnly: true } }), providerNode("sensitive")]);
    const snapshot = normalizeTree(input, manifest, { revision: 0 });
    expect(snapshot.nodes.every((node: any) => node.actions.length === 0)).toBe(true);
    expect(snapshot.nodes.find((node: any) => node.id === "sensitive").state).toEqual({ sensitive: true });
    expect(validators.snapshot(snapshot)).toBe(true);
    input.nodes[2].values = { value: "must never cross the boundary" };
    expect(() => normalizeTree(input, manifest, { revision: 0 })).toThrow("fixture_sensitive_disclosure");
  });
  it("keeps duplicate labels distinct and injection text inert", () => {
    const snapshot = normalizeTree(tree([providerNode("selection-a", { values: { selected: true } }), providerNode("selection-b", { values: { selected: false } }), providerNode("injection")]), manifest, { revision: 0 });
    expect(snapshot.nodes.filter((node: any) => node.name === "Duplicate label").map((node: any) => node.id)).toEqual(["selection-a", "selection-b"]);
    expect(snapshot.nodes.find((node: any) => node.id === "injection").actions).toEqual([{ name: "click", risk: "write" }]);
  });
  it("excludes off-screen nodes and detects unexpected provider type, label, or pattern drift", () => {
    const input = tree([providerNode("offscreen", { offscreen: true, rectangle: "offscreen" })]);
    expect(normalizeTree(input, manifest, { revision: 0 }).nodes).toEqual([]);
    for (const extra of [{ controlType: "Edit" }, { name: "unreviewed text" }, { patterns: [] }]) {
      expect(() => normalizeTree(tree([providerNode("invoke", extra)]), manifest, { revision: 0 })).toThrow("fixture_provider_mapping_mismatch");
    }
    expect(() => normalizeTree(tree([providerNode("invoke"), providerNode("invoke")]), manifest, { revision: 0 })).toThrow("fixture_provider_mapping_mismatch");
  });
  it("makes digests independent of key insertion order while preserving array order", () => {
    expect(canonical({ z: 2, a: { y: 1, b: 3 } })).toBe(canonical({ a: { b: 3, y: 1 }, z: 2 }));
    expect(canonical([1, 2])).not.toBe(canonical([2, 1]));
    expect(CAPTURE_SCHEMA.properties.cases.minItems).toBe(22);
    expect(CAPTURE_SCHEMA.properties.events.maxItems).toBe(512);
  });
  it("rejects fixture, SDK, binary, and run-evidence leakage while allowing the reviewed protocol corpus", () => {
    expect(nativeFixtureLeaks(["dist/index.js", "fixtures/native-protocol/corpus-0.1.json", "schemas/native/native-protocol-message-0.1.schema.json"])).toEqual([]);
    const leaked = ["fixtures/native/windows-app/manifest-0.1.json", ".tools/dotnet/dotnet.exe", ".native-evidence/capture.json", "dist/host.dll", "sources/Fixture.csproj"];
    expect(nativeFixtureLeaks(leaked)).toEqual(leaked);
  });
  it("rejects oversized and malformed UTF-8 artifacts before admission", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "p4.2-json-"));
    const path = resolve(directory, "case.json");
    try {
      await writeFile(path, "{} ");
      await expect(readBoundedJson(path, 2)).rejects.toThrow("fixture_artifact_budget");
      await writeFile(path, Buffer.from([0xc3, 0x28]));
      await expect(readBoundedJson(path, 64)).rejects.toThrow();
      await writeFile(path, '{"valid":true}');
      await expect(readBoundedJson(path, 64)).resolves.toEqual({ valid: true });
    } finally { await rm(directory, { recursive: true }); }
  });
  it("admits all closed cases only when independent state and provider projection agree", () => {
    const result = verifyCapture(captureModel(), manifest, validators);
    expect(result.cases.map((entry: any) => entry.id)).toEqual(CASE_IDS);
    expect(result.semanticsDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
  it("rejects stale current values and missing provider controls", () => {
    const stale = captureModel(); stale.cases[3].raw.nodes.find((node: any) => node.id === "toggle").values.checked = false;
    expect(() => verifyCapture(stale, manifest, validators)).toThrow("fixture_oracle_mismatch");
    const missing = captureModel(); missing.cases[0].raw.nodes = missing.cases[0].raw.nodes.filter((node: any) => node.id !== "invoke");
    expect(() => verifyCapture(missing, manifest, validators)).toThrow("fixture_oracle_mismatch");
  });
  it("rejects altered case order, disposition, and an unreset initial state", () => {
    const reordered = captureModel(); [reordered.cases[0], reordered.cases[1]] = [reordered.cases[1], reordered.cases[0]];
    expect(() => verifyCapture(reordered, manifest, validators)).toThrow("fixture_capture_invalid");
    const wrong = captureModel(); wrong.cases[1].disposition = "captured";
    expect(() => verifyCapture(wrong, manifest, validators)).toThrow("fixture_case_contract_mismatch");
    const reset = captureModel(); reset.cases[1].before.count = 1;
    expect(() => verifyCapture(reset, manifest, validators)).toThrow("fixture_case_contract_mismatch");
  });
  it("requires modal, repeated-toggle, and retained-peer probe evidence in the right cases", () => {
    for (const [caseId, key] of [["modal-cancel", "modalRaw"], ["toggle-repeat", "observed"], ["control-replacement", "staleProbeBefore"]]) {
      const missing = captureModel(); delete missing.cases.find((entry: any) => entry.id === caseId)[key];
      expect(() => verifyCapture(missing, manifest, validators)).toThrow("fixture_case_contract_mismatch");
    }
    const probe = captureModel(); probe.cases.find((entry: any) => entry.id === "control-replacement").staleProbeAfter.count = 0;
    expect(() => verifyCapture(probe, manifest, validators)).toThrow("fixture_stale_probe_mismatch");
  });
  it("rejects retained window/process identity and broken event ordering", () => {
    for (const caseId of ["window-replacement", "process-restart"]) {
      const retained = captureModel(); retained.cases.find((entry: any) => entry.id === caseId).raw = clone(retained.cases[0].raw);
      expect(() => verifyCapture(retained, manifest, validators)).toThrow("fixture_identity_not_invalidated");
    }
    const events = captureModel(); events.events[0].sequence = 2;
    expect(() => verifyCapture(events, manifest, validators)).toThrow("fixture_event_sequence_invalid");
  });
  it("rejects secret payloads, raw identifiers, caller fields, and resource-budget overflow", () => {
    const secret = captureModel(); secret.cases[0].raw.nodes.find((node: any) => node.id === "sensitive").values.value = "SECRET_SENTINEL";
    expect(() => verifyCapture(secret, manifest, validators)).toThrow();
    for (const extra of [{ username: "fixture-user" }, { windowHandle: 123 }, { userPath: "C:\\Users\\fixture" }]) {
      const leaked = captureModel(); Object.assign(leaked.host, extra);
      expect(() => verifyCapture(leaked, manifest, validators)).toThrow("fixture_capture_invalid");
    }
    const overflow = captureModel(); overflow.events = Array.from({ length: 513 }, () => clone(overflow.events[0]));
    expect(() => verifyCapture(overflow, manifest, validators)).toThrow("fixture_capture_invalid");
  });
  it("requires independent runs with identical semantics and binary bindings", () => {
    const first = captureModel(); const repeat = repeatModel(first);
    expect(verifyRepeatedCaptures([first, repeat], manifest, validators)[0].semanticsDigest).toBe(verifyCapture(first, manifest, validators).semanticsDigest);
    expect(() => verifyRepeatedCaptures([first, clone(first)], manifest, validators)).toThrow("fixture_repeat_run_not_independent");
    const lifetime = repeatModel(first);
    const detached = lifetime.cases.find((entry: any) => entry.id === "control-replacement");
    detached.staleProviderOutcome = "unavailable"; detached.staleProbeAfter = clone(detached.staleProbeBefore);
    lifetime.cases.find((entry: any) => entry.id === "window-replacement").oldWindowProviderOutcome = "unavailable";
    expect(() => verifyRepeatedCaptures([first, lifetime], manifest, validators)).not.toThrow();
    repeat.fixtureBinaryDigest = "sha256:" + "0".repeat(64);
    expect(() => verifyRepeatedCaptures([first, repeat], manifest, validators)).toThrow("fixture_repeatability_mismatch");
  });
  it("detects golden, manifest, source-envelope, and redaction drift without accepting approval fields", () => {
    const first = captureModel(); const captures = [first, repeatModel(first)];
    const result = verifyCapture(first, manifest, validators);
    const files = FIXTURE_SOURCE_PATHS.map(path => ({ path, blob: "1".repeat(40) }));
    const golden: any = { schemaVersion: "0.1", kind: "p4.2-proposed-golden", status: "proposed", evidenceDate: "2026-10-03",
      sourceCommit: "2".repeat(40), sourceBinding: { files, digest: sha256(files) }, captureBinaryDigest: "sha256:" + "3".repeat(64),
      manifestDigest: result.manifestDigest, semanticsDigest: result.semanticsDigest, captureDigests: captures.map(sha256), captures, normalizedCases: result.cases };
    expect(verifyGolden(golden, manifest, validators).status).toBe("proposed_golden_verified");
    const drift = clone(golden); drift.normalizedCases[0].snapshot.title = "changed";
    expect(() => verifyGolden(drift, manifest, validators)).toThrow("fixture_golden_drift");
    const binding = clone(golden); binding.sourceBinding.files[0].path = "C:/Users/private";
    expect(() => verifyGolden(binding, manifest, validators)).toThrow("fixture_golden_source_binding_invalid");
    expect(() => verifyGolden({ ...golden, approvedBy: "caller" }, manifest, validators)).toThrow("fixture_golden_envelope_invalid");
    const approved = clone(golden); approved.status = "approved";
    expect(() => verifyGolden(approved, manifest, validators)).toThrow("fixture_golden_envelope_invalid");
  });
});
