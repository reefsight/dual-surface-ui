import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const id = { type: "string", pattern: "^[a-z][a-z0-9-]{0,63}$" };
const digest = { type: "string", pattern: "^sha256:[a-f0-9]{64}$" };
const bool = { type: "boolean" };
const bounded = (maximum) => ({ type: "integer", minimum: 0, maximum });
const object = (properties, required = Object.keys(properties)) => ({ type: "object", additionalProperties: false, required, properties });
const state = object({
  schemaVersion: { const: "0.1" }, kind: { const: "p4.2-fixture-state" }, seed: { const: "p4.2-seed-1" },
  revision: bounded(1024), count: bounded(128), value: { type: "string", maxLength: 64 }, toggle: bool,
  selection: { enum: ["selection-a", "selection-b"] }, combo: { enum: ["combo-a", "combo-b"] },
  radio: { enum: ["radio-a", "radio-b"] }, tab: { enum: ["tab-a", "tab-b"] }, expanded: bool,
  range: { type: "number", minimum: 0, maximum: 10 }, generation: { enum: [1, 2] },
  modalResult: { enum: ["none", "confirmed", "cancelled"] }, sensitivePresent: { const: true },
});
export const INITIAL_FIXTURE_STATE = Object.freeze({ schemaVersion: "0.1", kind: "p4.2-fixture-state", seed: "p4.2-seed-1",
  revision: 0, count: 0, value: "initial", toggle: false, selection: "selection-a", combo: "combo-a",
  radio: "radio-a", tab: "tab-a", expanded: false, range: 2, generation: 1, modalResult: "none", sensitivePresent: true });
const values = object({
  value: { type: "string", maxLength: 64 }, readOnly: bool, checked: bool, selected: bool, expanded: bool,
  range: { type: "number", minimum: 0, maximum: 10 }, minimum: { const: 0 }, maximum: { const: 10 },
  selection: { type: "array", maxItems: 1, items: id },
}, []);
const node = object({
  id, parentId: { anyOf: [id, { type: "null" }] }, name: { type: "string", maxLength: 256 },
  controlType: { type: "string", maxLength: 32 }, frameworkId: { const: "WPF" },
  enabled: bool, offscreen: bool, focused: bool, sensitive: bool,
  rectangle: { enum: ["empty", "offscreen", "visible"] },
  patterns: { type: "array", maxItems: 32, uniqueItems: true, items: { type: "string", pattern: "^[A-Za-z]{1,32}$" } },
  values, instanceRef: digest,
});
const tree = object({ processRef: digest, windowRef: digest, nodes: { type: "array", minItems: 1, maxItems: 64, items: node } });
export const CASE_IDS = Object.freeze([
  "initial", "invoke", "value", "toggle-check", "toggle-repeat", "selection", "radio", "tab", "expand", "range", "combo",
  "disabled", "disabled-toggle", "readonly", "range-boundary", "sensitive-unsupported-hidden-offscreen", "injection",
  "control-replacement", "modal-cancel", "modal-confirm", "window-replacement", "process-restart",
]);
export const CAPTURE_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  ...object({
    schemaVersion: { const: "0.1" }, kind: { const: "p4.2-real-uia-capture" }, captureToolVersion: { const: "0.1" },
    seed: { const: "p4.2-seed-1" }, fixtureBinaryDigest: digest,
    host: object({
      osBuild: { type: "string", pattern: "^[0-9]{4,6}\\.[0-9]{1,6}$" }, architecture: { const: "X64" },
      runtime: { type: "string", pattern: "^\\.NET 10\\.[0-9.]+$" },
      culture: { type: "string", pattern: "^(?:[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,3})?$", maxLength: 32 },
      uiCulture: { type: "string", pattern: "^(?:[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,3})?$", maxLength: 32 },
      keyboardLayoutId: { type: "string", pattern: "^[0-9A-Fa-f]{8}$" }, windowDpi: { type: "integer", minimum: 48, maximum: 768 },
      displayScale: { type: "number", minimum: 0.5, maximum: 8 },
      uiAutomationCoreVersion: { type: "string", pattern: "^[0-9.]+(?: \\(WinBuild\\.[0-9A-Za-z.]+\\))?$", maxLength: 128 },
    }),
    cases: { type: "array", minItems: 22, maxItems: 22, items: object({
      id: { enum: CASE_IDS }, disposition: { enum: ["captured", "succeeded", "verified", "provider_rejected_unchanged", "metadata_only", "old_binding_invalidated", "cancelled", "confirmed", "identity_changed", "identity_changed_state_reset"] },
      before: state, after: state, raw: tree, modalRaw: tree, observed: { const: [true, false, true, false, true, false] },
      staleProviderOutcome: { enum: ["unavailable", "retained_callable"] },
      staleProbeBefore: state, staleProbeAfter: state,
      oldWindowProviderOutcome: { enum: ["unavailable", "retained_metadata"] },
    }, ["id", "disposition", "before", "after", "raw"]) },
    events: { type: "array", minItems: 1, maxItems: 512, items: object({ sequence: { type: "integer", minimum: 1, maximum: 512 }, targetId: id, property: { enum: ["ValuePatternIdentifiers.ValueProperty", "TogglePatternIdentifiers.ToggleStateProperty", "SelectionItemPatternIdentifiers.IsSelectedProperty", "ExpandCollapsePatternIdentifiers.ExpandCollapseStateProperty", "RangeValuePatternIdentifiers.ValueProperty"] } }) },
  }),
};

export const canonical = (value) => JSON.stringify(value, (_, entry) => {
  if (entry && !Array.isArray(entry) && typeof entry === "object") return Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b, "en")));
  return entry;
});
export const sha256 = (value) => "sha256:" + createHash("sha256").update(typeof value === "string" ? value : canonical(value)).digest("hex");

export async function loadFixtureValidators(root) {
  const ajv = new Ajv2020({ strict: true }); addFormats(ajv);
  const path = join(root, "fixtures/native/windows-app");
  const manifestSchema = JSON.parse(await readFile(join(path, "manifest-0.1.schema.json"), "utf8"));
  const snapshotSchema = JSON.parse(await readFile(join(root, "schemas/agent-snapshot-0.1.schema.json"), "utf8"));
  return { manifest: ajv.compile(manifestSchema), capture: ajv.compile(CAPTURE_SCHEMA), snapshot: ajv.compile(snapshotSchema) };
}
export async function readBoundedJson(path, bytes) {
  if ((await stat(path)).size > bytes) throw new Error("fixture_artifact_budget");
  const data = await readFile(path);
  if (data.length > bytes) throw new Error("fixture_artifact_budget");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
}
export function validateManifest(manifest, validators) {
  if (!validators.manifest(manifest) || new Set(manifest.controls.map(control => control.id)).size !== manifest.controls.length)
    throw new Error("fixture_manifest_invalid");
  const supported = { click: "Invoke", set_value: "Value", toggle: "Toggle", select: "SelectionItem", expand: "ExpandCollapse", set_range: "RangeValue" };
  for (const control of manifest.controls) {
    if (control.action !== "none" && !control.patterns.includes(supported[control.action])) throw new Error("fixture_action_pattern_mismatch");
    if (["sensitive", "hidden", "unsupported"].includes(control.id) && control.action !== "none") throw new Error("fixture_unsafe_action");
  }
}
export function normalizeTree(raw, manifest, fixtureState, surface = "main") {
  const definitions = new Map(manifest.controls.map(control => [control.id, control]));
  const nodes = [];
  const seen = new Set();
  for (const entry of raw.nodes) {
    const definition = definitions.get(entry.id);
    if (!definition || seen.has(entry.id) || entry.name !== definition.name || entry.controlType !== definition.type ||
      definition.patterns.some(pattern => !entry.patterns.includes(pattern))) throw new Error("fixture_provider_mapping_mismatch");
    seen.add(entry.id);
    if (entry.sensitive !== (entry.id === "sensitive") || (entry.sensitive && Object.keys(entry.values).length)) throw new Error("fixture_sensitive_disclosure");
    const keys = entry.id === "value" || entry.id === "readonly" ? ["value", "readOnly"] :
      ["toggle", "disabled-toggle"].includes(entry.id) ? ["checked"] :
      ["selection", "tabs"].includes(entry.id) ? ["selection"] : entry.id === "combo" ? ["selection", "expanded"] :
      /^(selection|combo|radio|tab)-[ab]$/.test(entry.id) ? ["selected"] : entry.id === "expand" ? ["expanded"] :
      entry.id === "range" ? ["range", "minimum", "maximum", "readOnly"] : [];
    if (Object.keys(entry.values).some(key => !keys.includes(key))) throw new Error("fixture_unexpected_value_payload");
    if (entry.offscreen || entry.rectangle === "empty" || entry.id === "hidden") continue;
    const state = {};
    if (!entry.enabled) state.disabled = true;
    if (entry.sensitive) state.sensitive = true;
    for (const key of ["value", "checked", "selected", "expanded"]) if (key in entry.values) state[key] = entry.values[key];
    if ("range" in entry.values) state.value = String(entry.values.range);
    if ("selection" in entry.values) state.value = entry.values.selection.join("");
    const actions = entry.enabled && !entry.sensitive && !entry.values.readOnly && definition.action !== "none"
      ? [{ name: definition.action, risk: "write" }] : [];
    if (actions.length && definition.action === "set_value") actions[0].inputSchema = { type: "string", maxLength: 64 };
    if (actions.length && definition.action === "set_range") actions[0].inputSchema = { type: "number", minimum: 0, maximum: 10 };
    nodes.push({ id: entry.id, role: definition.role, name: entry.name, state, actions });
  }
  const ordered = nodes.sort((a, b) => a.id.localeCompare(b.id, "en"));
  const parents = new Map(raw.nodes.map(entry => [entry.id, entry.parentId]));
  for (const entry of raw.nodes) {
    const chain = new Set([entry.id]); let parent = entry.parentId;
    while (parent !== null) {
      if (!parents.has(parent) || chain.has(parent)) throw new Error("fixture_parent_binding_invalid");
      chain.add(parent); parent = parents.get(parent);
    }
  }
  return { schemaVersion: "0.1", surfaceId: "p4.2-fixture-" + surface, revision: String(fixtureState.revision),
    title: surface === "main" ? "Dual Surface P4.2 Fixture" : "Fixture confirmation", url: "native-fixture://windows/" + surface,
    generatedAt: "2000-01-01T00:00:00.000Z", capabilities: ["fixture-only"], nodes: ordered };
}
function verifyOracle(raw, state) {
  const get = (id) => raw.nodes.find(entry => entry.id === id);
  const check = (condition) => { if (!condition) throw new Error("fixture_oracle_mismatch"); };
  for (const id of ["fixture-window", "invoke", "value", "readonly", "toggle", "disabled", "disabled-toggle", "sensitive",
    "selection", "selection-a", "selection-b", "combo", "radio-a", "radio-b", "tabs", "tab-a", "tab-b", "expand",
    "range", "replace", "modal", "replace-window", "unsupported", "injection", "offscreen", "reset", "status"]) check(!!get(id));
  check(get("value")?.values.value === state.value);
  check(get("readonly")?.values.readOnly === true && get("readonly")?.values.value === "read only");
  check(get("toggle")?.values.checked === state.toggle);
  check(get("range")?.values.range === state.range);
  check(get("range")?.values.minimum === 0 && get("range")?.values.maximum === 10 && get("range")?.values.readOnly === false);
  check(get("value")?.values.readOnly === false && get("disabled-toggle")?.values.checked === false);
  check(get("combo")?.values.selection?.[0] === state.combo);
  check(get("expand")?.values.expanded === state.expanded);
  for (const [key, ids] of [["selection", ["selection-a", "selection-b"]], ["radio", ["radio-a", "radio-b"]], ["tab", ["tab-a", "tab-b"]]]) {
    for (const id of ids) check(get(id)?.values.selected === (state[key] === id));
  }
  check(get("disabled")?.enabled === false && get("disabled-toggle")?.enabled === false);
  check(get("sensitive")?.sensitive === true && Object.keys(get("sensitive").values).length === 0);
  check(get("unsupported")?.patterns.every(pattern => !["Invoke", "Value", "Toggle", "SelectionItem", "RangeValue"].includes(pattern)));
  check(!get("hidden") || get("hidden").offscreen);
  check(get("offscreen")?.offscreen === true);
  check(state.expanded || !get("expanded-child") || get("expanded-child").offscreen);
  check(!!get(state.generation === 1 ? "dynamic-a" : "dynamic-b"));
  check(!get(state.generation === 1 ? "dynamic-b" : "dynamic-a"));
}
export function verifyCapture(capture, manifest, validators) {
  validateManifest(manifest, validators);
  if (!validators.capture(capture) || canonical(capture.cases.map(entry => entry.id)) !== canonical(CASE_IDS)) throw new Error("fixture_capture_invalid");
  const normalized = capture.cases.map(entry => {
    verifyOracle(entry.raw, entry.after);
    const snapshot = normalizeTree(entry.raw, manifest, entry.after);
    if (!validators.snapshot(snapshot)) throw new Error("fixture_core_snapshot_invalid");
    const record = { id: entry.id, disposition: entry.disposition, before: entry.before, after: entry.after, snapshot };
    if (entry.modalRaw) {
      if (entry.modalRaw.processRef !== entry.raw.processRef || entry.modalRaw.windowRef === entry.raw.windowRef ||
        canonical(entry.modalRaw.nodes.map(node => node.id).sort()) !== canonical(["modal-cancel", "modal-confirm", "modal-window"]))
        throw new Error("fixture_modal_binding_invalid");
      record.modalSnapshot = normalizeTree(entry.modalRaw, manifest, entry.before, "modal");
      if (!validators.snapshot(record.modalSnapshot)) throw new Error("fixture_core_snapshot_invalid");
    }
    if (entry.observed) record.observed = entry.observed;
    if (entry.staleProviderOutcome) record.staleProviderOutcome = entry.staleProviderOutcome;
    if (entry.staleProbeBefore) { record.staleProbeBefore = entry.staleProbeBefore; record.staleProbeAfter = entry.staleProbeAfter; }
    if (entry.oldWindowProviderOutcome) record.oldWindowProviderOutcome = entry.oldWindowProviderOutcome;
    return record;
  });
  const known = new Set(manifest.controls.map(entry => entry.id));
  const fixedDispositions = { initial: "captured", "toggle-repeat": "verified",
    "sensitive-unsupported-hidden-offscreen": "metadata_only", "control-replacement": "old_binding_invalidated",
    "modal-cancel": "cancelled", "modal-confirm": "confirmed", "window-replacement": "identity_changed",
    "process-restart": "identity_changed_state_reset" };
  for (const entry of capture.cases) {
    const expectedDisposition = fixedDispositions[entry.id] ?? (["disabled", "disabled-toggle", "readonly", "range-boundary"].includes(entry.id) ? "provider_rejected_unchanged" : "succeeded");
    if (entry.disposition !== expectedDisposition || canonical(entry.before) !== canonical(INITIAL_FIXTURE_STATE) ||
      (entry.id.startsWith("modal-") !== ("modalRaw" in entry)) ||
      ((entry.id === "toggle-repeat") !== ("observed" in entry)) ||
      ((entry.id === "control-replacement") !== ("staleProviderOutcome" in entry)) ||
      ((entry.id === "control-replacement") !== ("staleProbeBefore" in entry)) ||
      ((entry.id === "control-replacement") !== ("staleProbeAfter" in entry)) ||
      ((entry.id === "window-replacement") !== ("oldWindowProviderOutcome" in entry))) throw new Error("fixture_case_contract_mismatch");
  }
  capture.events.forEach((event, index) => {
    if (event.sequence !== index + 1 || !known.has(event.targetId)) throw new Error("fixture_event_sequence_invalid");
  });
  const expect = (caseId, key, value) => {
    const entry = capture.cases.find(entry => entry.id === caseId);
    const expected = { ...entry.before, [key]: value, revision: entry.after.revision };
    if (canonical(entry.after) !== canonical(expected) || entry.after.revision <= entry.before.revision) throw new Error("fixture_expected_transition_mismatch");
  };
  expect("invoke", "count", 1); expect("value", "value", "updated"); expect("toggle-check", "toggle", true);
  expect("selection", "selection", "selection-b"); expect("radio", "radio", "radio-b"); expect("tab", "tab", "tab-b");
  expect("expand", "expanded", true); expect("range", "range", 7); expect("combo", "combo", "combo-b");
  expect("injection", "count", 1); expect("control-replacement", "generation", 2);
  expect("modal-cancel", "modalResult", "cancelled"); expect("modal-confirm", "modalResult", "confirmed");
  for (const caseId of ["disabled", "disabled-toggle", "readonly", "range-boundary"]) {
    const entry = capture.cases.find(entry => entry.id === caseId);
    if (entry.disposition !== "provider_rejected_unchanged" || canonical(entry.before) !== canonical(entry.after)) throw new Error("fixture_rejected_mutation");
  }
  for (const caseId of ["initial", "sensitive-unsupported-hidden-offscreen", "window-replacement", "process-restart"]) {
    const entry = capture.cases.find(entry => entry.id === caseId);
    if (canonical(entry.after) !== canonical(INITIAL_FIXTURE_STATE)) throw new Error("fixture_reset_mismatch");
  }
  const repeated = capture.cases.find(entry => entry.id === "toggle-repeat");
  if (canonical(repeated.after) !== canonical({ ...INITIAL_FIXTURE_STATE, revision: 6 })) throw new Error("fixture_toggle_repeat_mismatch");
  const replaced = capture.cases.find(entry => entry.id === "control-replacement");
  if (replaced.raw.nodes.some(entry => entry.id === "dynamic-a") || replaced.staleProbeBefore.generation !== 2 ||
    canonical(replaced.staleProbeBefore) !== canonical(replaced.after)) throw new Error("fixture_old_binding_not_invalidated");
  const probeExpected = replaced.staleProviderOutcome === "unavailable" ? replaced.staleProbeBefore :
    { ...replaced.staleProbeBefore, count: 1, revision: replaced.staleProbeBefore.revision + 1 };
  if (canonical(replaced.staleProbeAfter) !== canonical(probeExpected)) throw new Error("fixture_stale_probe_mismatch");
  const initialRaw = capture.cases[0].raw;
  const replacedWindow = capture.cases.find(entry => entry.id === "window-replacement").raw;
  const restarted = capture.cases.find(entry => entry.id === "process-restart").raw;
  if (initialRaw.processRef !== replacedWindow.processRef || initialRaw.windowRef === replacedWindow.windowRef ||
    initialRaw.processRef === restarted.processRef || replacedWindow.windowRef === restarted.windowRef)
    throw new Error("fixture_identity_not_invalidated");
  return { cases: normalized, semanticsDigest: sha256(normalized), manifestDigest: sha256(manifest) };
}
