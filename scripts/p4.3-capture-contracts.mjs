import { open } from "node:fs/promises";
import { join } from "node:path";
import { captureAndValidateNativeProtocolDataMessage, parseNativeProtocolFrame } from "../dist/native-protocol/index.js";
import { canonical, loadFixtureValidators, readBoundedJson, sha256 } from "./p4.2-fixture-contracts.mjs";
import { verifyGolden, verifyGoldenSource } from "./p4.2-golden-contracts.mjs";

export const CAPTURE_LIMITS = Object.freeze({ nodes: 256, depth: 16, characters: 256, valueCharacters: 64,
  bindings: 256, descriptors: 64, snapshotBytes: 262144, reportBytes: 1048576 });
export const ACCEPTED_GOLDEN_DIGEST = "sha256:1e25e1146108848c5dc14bb7b320a03c9a057402682c9585d8e6b1fda17a19d3";
const reject = () => { throw new TypeError("capture_comparison_refused"); };
const equal = (a, b) => canonical(a) === canonical(b);
const opaqueElement = /^element-[a-f0-9]{32}$/;
const opaqueSurface = /^surface-[a-f0-9]{32}$/;
const originalObjectBytes = new WeakMap();
const envelopeKeys = ["schemaVersion", "surfaceId", "revision", "title", "url", "generatedAt", "capabilities", "nodes"];
const exact = (value, keys) => value !== null && typeof value === "object" && !Array.isArray(value) && equal(Object.keys(value).sort(), [...keys].sort());
const sorted = (values) => values.every((value, i) => i === 0 || values[i - 1] < value);

// Separate strict bounded parser for private development publications. This is
// NOT a new public native frame format. Duplicate keys are rejected BEFORE loss
// through JSON.parse; the public protocol parser is also used on both envelopes.
export function parseCapturePublication(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > CAPTURE_LIMITS.reportBytes ||
      bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) reject();
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { reject(); }
  let index = 0, values = 0;
  const whitespace = () => { while (/[\x20\t\r\n]/.test(text[index] ?? "x")) index++; };
  const string = () => {
    const start = index++;
    while (index < text.length) {
      const ch = text[index++];
      if (ch === "\\") { index++; continue; }
      if (ch === '"') {
        let result; try { result = JSON.parse(text.slice(start, index)); } catch { reject(); }
        if (result.length > CAPTURE_LIMITS.characters || !result.isWellFormed()) reject();
        return result;
      }
    }
    reject();
  };
  const value = (depth) => {
    if (++values > 32768 || depth > CAPTURE_LIMITS.depth) reject();
    whitespace(); const start = index; const ch = text[index];
    if (ch === '"') return string();
    if (ch === "{" || ch === "[") {
      index++; whitespace();
      const object = ch === "{"; const close = object ? "}" : "]";
      const result = object ? Object.create(null) : []; const keys = new Set();
      const complete = () => { originalObjectBytes.set(result, Buffer.byteLength(text.slice(start, index), "utf8")); return result; };
      if (text[index] === close) { index++; return complete(); }
      let count = 0;
      while (true) {
        if (++count > 512) reject(); whitespace();
        if (object) {
          if (text[index] !== '"') reject(); const key = string();
          if (keys.has(key)) reject(); keys.add(key);
          whitespace(); if (text[index++] !== ":") reject();
          result[key] = value(depth + 1);
        } else result.push(value(depth + 1));
        whitespace(); const delimiter = text[index++];
        if (delimiter === close) return complete();
        if (delimiter !== ",") reject();
      }
    }
    for (const [literal, result] of [["true", true], ["false", false], ["null", null]])
      if (text.startsWith(literal, index)) { index += literal.length; return result; }
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(index));
    if (!match || !Number.isFinite(Number(match[0]))) reject();
    index += match[0].length; return Number(match[0]);
  };
  const result = value(0); whitespace(); if (index !== text.length) reject();
  return result;
}

// Byte admission + unchanged core/protocol validation, independent of C# code.
// Generated development envelopes exercise the existing validators; they do not
// claim service negotiation, transport execution or deployed native-host proof.
export function admitCapturePublication(bytes, validators, manifest, surface = "main") {
  const publication = parseCapturePublication(bytes);
  if (!exact(publication, ["publicSnapshot", "comparableSnapshot", "inverse"])) reject();
  const { publicSnapshot, comparableSnapshot, inverse } = publication;
  for (const snapshot of [publicSnapshot, comparableSnapshot]) {
    if (!exact(snapshot, envelopeKeys) || !validators.snapshot(snapshot) ||
        !opaqueSurface.test(snapshot.surfaceId) || !/^[1-9][0-9]{0,19}$/.test(snapshot.revision) ||
        BigInt(snapshot.revision) > 18446744073709551615n ||
        snapshot.url !== "native-uia://windows/" + surface || !equal(snapshot.capabilities, ["snapshots"]) ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|\+00:00)$/.test(snapshot.generatedAt) ||
        snapshot.title.length > 256 || snapshot.nodes.length > CAPTURE_LIMITS.nodes ||
        originalObjectBytes.get(snapshot) > CAPTURE_LIMITS.snapshotBytes ||
        Buffer.byteLength(JSON.stringify(snapshot), "utf8") > CAPTURE_LIMITS.snapshotBytes || !sorted(snapshot.nodes.map(n => n.id))) reject();
    let descriptors = 0;
    for (const node of snapshot.nodes) {
      if (!exact(node, ["id", "role", "name", "state", "actions"]) || !opaqueElement.test(node.id) ||
          node.name.length > 256 || node.actions.length > 1 || !sorted(node.actions.map(a => a.name)) ||
          Object.keys(node.state).some(key => !["disabled", "checked", "expanded", "selected", "value", "sensitive"].includes(key)) ||
          node.state.value !== undefined && node.state.value.length > 64) reject();
      descriptors += node.actions.length;
      if (node.state.sensitive === true && (node.name !== "Sensitive value" || node.actions.length || "value" in node.state)) reject();
    }
    if (descriptors > CAPTURE_LIMITS.descriptors) reject();
    const envelope = { schemaVersion: "0.1", kind: "snapshot-response", requestId: "capture-unit-request",
      sessionRef: "capture-unit-session", surfaceRef: snapshot.surfaceId, snapshot };
    captureAndValidateNativeProtocolDataMessage(envelope);
    parseNativeProtocolFrame(new TextEncoder().encode(JSON.stringify(envelope)));
  }
  if (!equal(publicSnapshot, { ...comparableSnapshot, nodes: comparableSnapshot.nodes.map(n => ({ ...n, actions: [] })) })) reject();
  if (!Array.isArray(inverse) || inverse.length > CAPTURE_LIMITS.bindings || !sorted(inverse.map(i => i?.elementId))) reject();
  const definitions = new Map(manifest.controls.map(d => [d.id, d]));
  const byElement = new Map(), byCorrelation = new Map();
  for (const entry of inverse) {
    if (!exact(entry, ["elementId", "correlation"]) || !opaqueElement.test(entry.elementId) ||
        !definitions.has(entry.correlation) || byElement.has(entry.elementId) || byCorrelation.has(entry.correlation)) reject();
    byElement.set(entry.elementId, entry.correlation); byCorrelation.set(entry.correlation, entry.elementId);
  }
  const required = new Set();
  for (const node of comparableSnapshot.nodes) {
    const correlation = byElement.get(node.id); if (correlation === undefined) reject(); required.add(node.id);
    const definition = definitions.get(correlation);
    if (node.role !== definition.role) reject();
    if (["selection", "combo", "tabs"].includes(correlation) && node.state.value !== undefined && node.state.value !== "") {
      const peer = node.state.value; const item = byElement.get(peer);
      const allowed = { selection: ["selection-a", "selection-b"], combo: ["combo-a", "combo-b"], tabs: ["tab-a", "tab-b"] }[correlation];
      if (!allowed.includes(item)) reject(); required.add(peer);
      const visible = comparableSnapshot.nodes.find(n => n.id === peer);
      if (visible && visible.state.selected !== true) reject();
    }
  }
  if (inverse.length !== required.size || inverse.some(i => !required.has(i.elementId))) reject();
  return publication;
}

// Translate only the frozen permitted envelope slots and the three proven
// selected-reference fields. Preserve ALL actual semantic data, including names,
// descriptor schemas, unknown-vs-false distinctions and selector-looking values.
export function compareCapturePublication(bytes, expected, validators, manifest, surface = "main") {
  if (!validators.snapshot(expected) || expected.url !== "native-fixture://windows/" + surface ||
      expected.surfaceId !== "p4.2-fixture-" + surface || !equal(expected.capabilities, ["fixture-only"])) reject();
  const publication = admitCapturePublication(bytes, validators, manifest, surface);
  const { comparableSnapshot, inverse } = publication;
  const lookup = new Map(inverse.map(i => [i.elementId, i.correlation]));
  const nodes = comparableSnapshot.nodes.map(node => {
    const correlation = lookup.get(node.id); const state = { ...node.state };
    if (["selection", "combo", "tabs"].includes(correlation) && state.value !== undefined && state.value !== "") {
      if (!lookup.has(state.value)) reject(); state.value = lookup.get(state.value);
    }
    return { ...node, id: correlation, state };
  }).sort((a, b) => a.id.localeCompare(b.id, "en"));
  const translated = { ...comparableSnapshot, nodes, surfaceId: expected.surfaceId, revision: expected.revision,
    generatedAt: expected.generatedAt, url: expected.url, capabilities: ["fixture-only"] };
  if (!equal(translated, expected)) reject();
  return { status: "semantic_comparison_passed", subjects: nodes.length, descriptors: nodes.reduce((n, node) => n + node.actions.length, 0) };
}

export async function loadAcceptedCaptureOracle(root) {
  const fixtureRoot = join(root, "fixtures/native/windows-app");
  const golden = await readBoundedJson(join(fixtureRoot, "golden-0.1.json"), 4194304);
  const manifest = await readBoundedJson(join(fixtureRoot, "manifest-0.1.json"), 32768);
  const validators = await loadFixtureValidators(root);
  if (sha256(golden) !== ACCEPTED_GOLDEN_DIGEST || golden.sourceCommit !== "5c6b80e34fa8dab9a83d8771e6ee52bde63da272") reject();
  verifyGolden(golden, manifest, validators); await verifyGoldenSource(root, golden);
  return { golden, manifest, validators };
}
export async function readCapturePublication(path) {
  // Caller must separately admit the owned path/directory. One opened regular
  // file handle plus a fixed bounded buffer avoids stat(path)/readFile(path)
  // allocation races; changing/growing data can never grow our read buffer.
  const file = await open(path, "r");
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > CAPTURE_LIMITS.reportBytes) reject();
    const buffer = Buffer.alloc(CAPTURE_LIMITS.reportBytes + 1); let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
      if (length > CAPTURE_LIMITS.reportBytes) reject();
    }
    const bytes = buffer.subarray(0, length); parseCapturePublication(bytes); return bytes;
  } finally { await file.close(); }
}
