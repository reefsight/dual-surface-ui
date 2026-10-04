import { createHash } from "node:crypto";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { captureAndValidateNativeProtocolDataMessage, parseNativeProtocolFrame } from "../dist/native-protocol/index.js";
import { CASE_IDS, INITIAL_FIXTURE_STATE, canonical } from "./p4.2-fixture-contracts.mjs";
import { admitCapturePublication, compareCapturePublication, parseCapturePublication } from "./p4.3-capture-contracts.mjs";

export const SUITE_CAPTURE_IDS = Object.freeze([
  "initial", "initial-repeat", "invoke", "value-before", "value", "value-repeat", "toggle-check", "toggle-repeat",
  "selection", "radio", "tab", "expand", "range", "combo-expanded", "combo-collapsed", "combo", "disabled",
  "disabled-toggle", "readonly", "range-boundary", "sensitive-unsupported-hidden-offscreen", "injection",
  "replacement-before", "control-replacement", "modal-cancel-open", "modal-cancel", "modal-confirm-open",
  "modal-confirm", "window-before", "window-replacement", "restart-before", "process-restart",
]);
export const SUITE_PROBE_IDS = Object.freeze(["disabled", "disabled-toggle", "readonly", "range-boundary"]);
export const SUITE_LIMITS = Object.freeze({ nodes: 256, depth: 16, children: 64, roots: 2, nativeCandidates: 64,
  enumerationPasses: 2, characters: 256, valueCharacters: 64, textCharacters: 131072, bindings: 256,
  descriptors: 64, auxiliaryNodes: 64, snapshotBytes: 262144, reportBytes: 1048576,
  observationSeconds: 10, workerSeconds: 240 });
export const SUITE_REPORT_KEYS = Object.freeze(["schemaVersion", "kind", "sourceDigest", "collectorBinaryDigest",
  "fixtureBinaryDigest", "recordedAt", "host", "limits", "cases", "captures", "toggleObserved"]);
export const SUITE_SESSION_REF = "p4.3-suite-session";
export const suiteRequestId = (id) => {
  if (!SUITE_CAPTURE_IDS.includes(id)) refuse();
  return "p4.3-suite-" + id;
};
export const SUITE_ARTIFACT_NAMES = Object.freeze(SUITE_CAPTURE_IDS.flatMap(id => [
  id + ".capture.json", id + ".public-response.json", id + ".comparison-response.json", id + ".oracle.json",
]).concat(SUITE_PROBE_IDS.map(id => id + ".probe-before.json")));
const SUITE_SUFFIX_LIMITS = Object.freeze({ ".capture.json": SUITE_LIMITS.reportBytes,
  ".public-response.json": SUITE_LIMITS.snapshotBytes, ".comparison-response.json": SUITE_LIMITS.snapshotBytes,
  ".oracle.json": 4096, ".probe-before.json": 4096, "suite-report.json": SUITE_LIMITS.reportBytes });
const EPOCH_GROUPS = Object.freeze([
  ["initial", "initial-repeat"], ["invoke"], ["value-before", "value", "value-repeat"], ["toggle-check"],
  ["toggle-repeat"], ["selection"], ["radio"], ["tab"], ["expand"], ["range"],
  ["combo-expanded", "combo-collapsed", "combo"], ["disabled"], ["disabled-toggle"], ["readonly"],
  ["range-boundary"], ["sensitive-unsupported-hidden-offscreen"], ["injection"],
  ["replacement-before", "control-replacement"], ["modal-cancel-open", "modal-cancel"],
  ["modal-confirm-open", "modal-confirm"], ["window-before"], ["window-replacement"], ["restart-before"], ["process-restart"],
]);
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const utcPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|\+00:00)$/;
const culturePattern = /^(?:[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,3})?$/;
const refuse = () => { throw new TypeError("native_capture_suite_refused"); };
// Pure worker-count admission only. This is not the native report/coverage gate;
// the launcher and boundary tests use this same implementation.
export function admitSuiteUnitSummary(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > 1024) refuse();
  const value = parseCapturePublication(bytes);
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join(",") !== "cases,kind,nativeExecuted" ||
      value.kind !== "p4.3-native-suite-unit" || !Number.isInteger(value.cases) ||
      value.cases < 1 || value.cases > 512 || value.nativeExecuted !== false) refuse();
  return { kind: value.kind, cases: value.cases, nativeExecuted: false };
}
const equal = (left, right) => canonical(left) === canonical(right);
const exact = (value, keys) => value !== null && typeof value === "object" && !Array.isArray(value) &&
  equal(Object.keys(value).sort(), [...keys].sort());
const timestamp = value => typeof value === "string" && utcPattern.test(value) && Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
const admittedResults = new WeakMap();
export const rawSuiteDigest = bytes => {
  if (!(bytes instanceof Uint8Array)) refuse();
  return "sha256:" + createHash("sha256").update(bytes).digest("hex");
};
const bounded = (bytes, limit) => {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > limit) refuse();
  return bytes;
};
const artifactLimit = name => {
  if (name === "suite-report.json") return SUITE_LIMITS.reportBytes;
  if (!SUITE_ARTIFACT_NAMES.includes(name)) refuse();
  const suffix = Object.keys(SUITE_SUFFIX_LIMITS).find(s => name.endsWith(s));
  if (!suffix) refuse();
  return SUITE_SUFFIX_LIMITS[suffix];
};

// The fixture state is an independently retained post-capture oracle. It is
// never a collector input. Exact shape/values prevent metadata or sensitive
// text from gaining an unreviewed channel through a private state artifact.
export function admitSuiteOracle(bytes, expected) {
  const value = parseCapturePublication(bounded(bytes, 4096));
  if (!exact(value, Object.keys(INITIAL_FIXTURE_STATE)) || !equal(value, expected)) refuse();
  return value;
}

export function admitSuiteReport(bytes, trusted) {
  if (!exact(trusted, ["sourceDigest", "collectorBinaryDigest", "fixtureBinaryDigest"]) ||
      Object.values(trusted).some(d => typeof d !== "string" || !digestPattern.test(d))) refuse();
  const report = parseCapturePublication(bounded(bytes, SUITE_LIMITS.reportBytes));
  if (!exact(report, SUITE_REPORT_KEYS) || report.schemaVersion !== "0.1" || report.kind !== "p4.3-native-capture-suite" ||
      ["sourceDigest", "collectorBinaryDigest", "fixtureBinaryDigest"].some(key => report[key] !== trusted[key]) ||
      !timestamp(report.recordedAt) || !equal(report.limits, SUITE_LIMITS) ||
      !exact(report.host, ["osBuild", "architecture", "runtime", "culture", "uiCulture"]) ||
      typeof report.host.osBuild !== "string" || !/^[0-9]{4,6}\.[0-9]{1,6}$/.test(report.host.osBuild) ||
      report.host.architecture !== "X64" || typeof report.host.runtime !== "string" || !/^\.NET 10\.[0-9.]+$/.test(report.host.runtime) ||
      [report.host.culture, report.host.uiCulture].some(c => typeof c !== "string" || c.length > 32 || !culturePattern.test(c)) ||
      !equal(report.toggleObserved, [true, false, true, false, true, false]) ||
      !Array.isArray(report.cases) || !equal(report.cases.map(c => c?.id), CASE_IDS) ||
      !Array.isArray(report.captures) || !equal(report.captures.map(c => c?.id), SUITE_CAPTURE_IDS)) refuse();
  for (const record of report.cases) {
    const probe = SUITE_PROBE_IDS.includes(record.id);
    if (!exact(record, ["id", "probe", "probeBeforeDigest"]) ||
        record.probe !== (probe ? "provider_rejected_unchanged" : "not_probed") ||
        (probe ? typeof record.probeBeforeDigest !== "string" || !digestPattern.test(record.probeBeforeDigest) : record.probeBeforeDigest !== null)) refuse();
  }
  for (const record of report.captures) {
    const auxiliary = record.id === "combo-expanded" ? "popup" : record.id.endsWith("-open") ? "modal" : "none";
    if (!exact(record, ["id", "publicationDigest", "publicEnvelopeDigest", "comparisonEnvelopeDigest", "oracleDigest", "resetOrdinal", "roots", "auxiliary"]) ||
        [record.publicationDigest, record.publicEnvelopeDigest, record.comparisonEnvelopeDigest, record.oracleDigest]
          .some(d => typeof d !== "string" || !digestPattern.test(d)) ||
        !Number.isInteger(record.resetOrdinal) || record.resetOrdinal < 1 || record.resetOrdinal > 512 ||
        record.auxiliary !== auxiliary || record.roots !== (auxiliary === "none" ? 1 : 2)) refuse();
  }
  let ordinal = 0;
  for (const group of EPOCH_GROUPS) {
    const records = group.map(id => report.captures.find(c => c.id === id));
    if (records[0].resetOrdinal <= ordinal || records.some(c => c.resetOrdinal !== records[0].resetOrdinal)) refuse();
    ordinal = records[0].resetOrdinal;
  }
  return report;
}

// Supplemental expectation is explicit and separate from all frozen P4.2
// snapshots. This is a comparator target, NOT runtime subject filtering.
export function expandedComboExpectation(golden, manifest) {
  const expected = structuredClone(golden.normalizedCases.find(c => c.id === "initial").snapshot);
  const combo = expected.nodes.find(n => n.id === "combo");
  if (!combo || combo.state.value !== "combo-a" || combo.state.expanded !== false) refuse();
  combo.state.expanded = true;
  for (const id of ["combo-a", "combo-b"]) {
    const subject = manifest.controls.find(c => c.id === id);
    if (!subject || subject.role !== "option" || subject.action !== "select" || !equal(subject.patterns, ["SelectionItem"])) refuse();
    expected.nodes.push({ id, role: "option", name: subject.name, state: { selected: id === "combo-a" },
      actions: [{ name: "select", risk: "write" }] });
  }
  expected.nodes.sort((a, b) => a.id.localeCompare(b.id, "en"));
  return expected;
}

function expectation(id, golden, manifest) {
  const main = golden.normalizedCases.find(c => c.id === id);
  if (main) return { snapshot: main.snapshot, state: main.after, surface: "main" };
  if (id.endsWith("-open")) {
    const modal = golden.normalizedCases.find(c => c.id === id.slice(0, -5));
    if (!modal?.modalSnapshot) refuse();
    return { snapshot: modal.modalSnapshot, state: modal.before, surface: "modal" };
  }
  if (id === "combo-expanded") return { snapshot: expandedComboExpectation(golden, manifest), state: INITIAL_FIXTURE_STATE, surface: "main" };
  const baseline = golden.normalizedCases.find(c => c.id === (id === "value-repeat" ? "value" : "initial"));
  if (!baseline) refuse();
  return { snapshot: baseline.snapshot, state: baseline.after, surface: "main" };
}

function admitEnvelope(bytes, id, snapshot) {
  bounded(bytes, SUITE_LIMITS.snapshotBytes);
  // BOTH parsers consume ORIGINAL retained bytes, never a reserialized stand-in.
  const strict = parseCapturePublication(bytes);
  const protocol = parseNativeProtocolFrame(bytes);
  captureAndValidateNativeProtocolDataMessage(strict);
  if (!exact(strict, ["schemaVersion", "kind", "requestId", "sessionRef", "surfaceRef", "snapshot"]) ||
      strict.schemaVersion !== "0.1" || strict.kind !== "snapshot-response" || strict.requestId !== suiteRequestId(id) ||
      strict.sessionRef !== SUITE_SESSION_REF || strict.surfaceRef !== snapshot.surfaceId ||
      !equal(strict.snapshot, snapshot) || !equal(protocol, strict)) refuse();
}

const withoutTime = snapshot => {
  const { generatedAt: _generatedAt, ...rest } = snapshot;
  return rest;
};
const referenceMap = publication => new Map(publication.inverse.map(entry => [entry.correlation, entry.elementId]));
const disjoint = (left, right) => {
  const values = new Set(left);
  return ![...right].some(value => values.has(value));
};
const sameGeneration = (left, right) => {
  if (left.publicSnapshot.surfaceId !== right.publicSnapshot.surfaceId) refuse();
};
const sharedStable = (left, right) => {
  sameGeneration(left, right);
  const a = referenceMap(left), b = referenceMap(right);
  for (const [correlation, elementId] of a) if (b.has(correlation) && b.get(correlation) !== elementId) refuse();
};
const rotated = (left, right) => {
  if (left.publicSnapshot.surfaceId === right.publicSnapshot.surfaceId ||
      !disjoint(left.inverse.map(e => e.elementId), right.inverse.map(e => e.elementId))) refuse();
};

function verifyLifecycles(publications, report) {
  const get = id => publications.get(id);
  for (const [left, right] of [["initial", "initial-repeat"], ["value", "value-repeat"]]) {
    if (!equal(withoutTime(get(left).comparableSnapshot), withoutTime(get(right).comparableSnapshot)) ||
        !equal(get(left).inverse, get(right).inverse)) refuse();
  }
  for (const [left, right] of [["value-before", "value"], ["replacement-before", "control-replacement"],
    ["combo-expanded", "combo-collapsed"], ["combo-collapsed", "combo"]]) {
    sharedStable(get(left), get(right));
    if (BigInt(get(right).publicSnapshot.revision) <= BigInt(get(left).publicSnapshot.revision)) refuse();
  }
  // Every independently reset main group retires the previous main surface AND
  // its complete visible/private inverse. Modal-open publication is separate.
  let previous;
  for (const group of EPOCH_GROUPS) {
    const id = group.find(captureId => !captureId.endsWith("-open"));
    if (!id) refuse();
    if (previous) rotated(get(previous), get(id));
    previous = group[group.length - 1];
  }
  const replaced = referenceMap(get("control-replacement"));
  const before = referenceMap(get("replacement-before"));
  if (!before.has("dynamic-a") || before.has("dynamic-b") || replaced.has("dynamic-a") || !replaced.has("dynamic-b") ||
      [...replaced.values()].includes(before.get("dynamic-a"))) refuse();
  const expanded = referenceMap(get("combo-expanded")), collapsed = referenceMap(get("combo-collapsed")), selected = referenceMap(get("combo"));
  if (!expanded.has("combo-a") || !expanded.has("combo-b") || collapsed.has("combo-b") || !collapsed.has("combo-a") ||
      selected.get("combo-b") === expanded.get("combo-b") || !selected.has("combo-b") || selected.has("combo-a") ||
      get("combo-collapsed").publicSnapshot.nodes.some(n => n.id === collapsed.get("combo-a"))) refuse();
  // No retired generation/reference can later be resurrected, including a
  // window/process replacement and a modal-root→main-root transition.
  const retiredSurfaces = new Set(), retiredElements = new Set();
  let priorSurface, activeElements = new Set();
  for (const record of report.captures) {
    const p = get(record.id), surface = p.publicSnapshot.surfaceId, elements = new Set(p.inverse.map(e => e.elementId));
    if (retiredSurfaces.has(surface) || [...elements].some(e => retiredElements.has(e))) refuse();
    if (priorSurface !== undefined && surface !== priorSurface) {
      retiredSurfaces.add(priorSurface);
      for (const e of activeElements) retiredElements.add(e);
      if (!disjoint(activeElements, elements)) refuse();
    } else for (const e of activeElements) if (!elements.has(e)) retiredElements.add(e);
    priorSurface = surface; activeElements = elements;
  }
}

// Pure verifier: bytes and trusted source/binary binding are supplied separately.
// Report assertions do not stand in for semantic, revision or lifecycle proof.
export function verifyNativeCaptureSuite(reportBytes, artifacts, trusted, oracle) {
  try {
    const report = admitSuiteReport(reportBytes, trusted);
    if (!(artifacts instanceof Map) || artifacts.size !== SUITE_ARTIFACT_NAMES.length ||
        !equal([...artifacts.keys()].sort(), [...SUITE_ARTIFACT_NAMES].sort())) refuse();
    const publications = new Map(), retainedDigests = [];
    for (const record of report.captures) {
      const target = expectation(record.id, oracle.golden, oracle.manifest);
      const files = [record.id + ".capture.json", record.id + ".public-response.json", record.id + ".comparison-response.json", record.id + ".oracle.json"];
      const expectedDigests = [record.publicationDigest, record.publicEnvelopeDigest, record.comparisonEnvelopeDigest, record.oracleDigest];
      files.forEach((name, i) => {
        const bytes = bounded(artifacts.get(name), artifactLimit(name));
        if (rawSuiteDigest(bytes) !== expectedDigests[i]) refuse();
        retainedDigests.push({ name, digest: expectedDigests[i] });
      });
      const publicationBytes = artifacts.get(files[0]);
      compareCapturePublication(publicationBytes, target.snapshot, oracle.validators, oracle.manifest, target.surface);
      const p = admitCapturePublication(publicationBytes, oracle.validators, oracle.manifest, target.surface);
      admitEnvelope(artifacts.get(files[1]), record.id, p.publicSnapshot);
      admitEnvelope(artifacts.get(files[2]), record.id, p.comparableSnapshot);
      admitSuiteOracle(artifacts.get(files[3]), target.state);
      if (!timestamp(p.publicSnapshot.generatedAt)) refuse();
      publications.set(record.id, p);
    }
    for (const record of report.cases.filter(c => SUITE_PROBE_IDS.includes(c.id))) {
      const name = record.id + ".probe-before.json", bytes = bounded(artifacts.get(name), 4096);
      if (rawSuiteDigest(bytes) !== record.probeBeforeDigest) refuse();
      const before = admitSuiteOracle(bytes, INITIAL_FIXTURE_STATE);
      const after = admitSuiteOracle(artifacts.get(record.id + ".oracle.json"), INITIAL_FIXTURE_STATE);
      if (!equal(before, after)) refuse();
      retainedDigests.push({ name, digest: record.probeBeforeDigest });
    }
    verifyLifecycles(publications, report);
    const result = { status: "original_artifact_suite_verified", cases: CASE_IDS.length, captures: SUITE_CAPTURE_IDS.length,
      providerProbes: SUITE_PROBE_IDS.length, reportDigest: rawSuiteDigest(reportBytes), retainedDigests,
      sourceDigest: trusted.sourceDigest, collectorBinaryDigest: trusted.collectorBinaryDigest,
      fixtureBinaryDigest: trusted.fixtureBinaryDigest, publications, host: report.host };
    // The pair checker retains its own copied proof facts. Editing a returned
    // Map or forging a green result tag cannot supply first/repeat provenance.
    admittedResults.set(result, Object.freeze({ reportDigest: result.reportDigest, sourceDigest: trusted.sourceDigest,
      collectorBinaryDigest: trusted.collectorBinaryDigest, fixtureBinaryDigest: trusted.fixtureBinaryDigest,
      host: canonical(report.host), surfaces: Object.freeze([...publications.values()].map(p => p.publicSnapshot.surfaceId)),
      elements: Object.freeze([...publications.values()].flatMap(p => p.inverse.map(e => e.elementId))) }));
    return result;
  } catch { refuse(); }
}

export function verifyNativeCapturePair(first, repeat) {
  try {
    const a = admittedResults.get(first), b = admittedResults.get(repeat);
    if (!a || !b || ["sourceDigest", "collectorBinaryDigest", "fixtureBinaryDigest", "host"].some(key => a[key] !== b[key]) ||
        a.reportDigest === b.reportDigest || !disjoint(a.surfaces, b.surfaces) || !disjoint(a.elements, b.elements)) refuse();
    return { status: "original_artifact_first_repeat_verified", casesPerRun: CASE_IDS.length,
      capturesPerRun: SUITE_CAPTURE_IDS.length, reportDigests: [a.reportDigest, b.reportDigest] };
  } catch { refuse(); }
}

// This fixed-path check is in addition to the launcher's CreateNew owned-process
// admission. A matching name is NOT evidence that the verifier created a run.
export function admitSuiteDirectoryPath(directory, temporaryRoot = tmpdir()) {
  if (typeof directory !== "string" || !directory || directory.includes("\0")) refuse();
  const parent = resolve(temporaryRoot, "dual-surface-ui-native-evidence"), absolute = resolve(directory);
  const path = relative(parent, absolute);
  const parts = path.split(sep);
  if (parts.length !== 2 || !/^p4\.3-capture-[a-f0-9]{32}$/.test(parts[0]) || !["first", "repeat"].includes(parts[1]) ||
      absolute !== directory || !absolute.startsWith(parent + sep)) refuse();
  return absolute;
}

export function admitSuiteRunRootPath(directory, temporaryRoot = tmpdir()) {
  if (typeof directory !== "string" || !directory || directory.includes("\0")) refuse();
  const parent = resolve(temporaryRoot, "dual-surface-ui-native-evidence"), absolute = resolve(directory);
  const path = relative(parent, absolute);
  if (!/^p4\.3-capture-[a-f0-9]{32}$/.test(path) || absolute !== directory || !absolute.startsWith(parent + sep)) refuse();
  return absolute;
}

async function regularDirectory(path, expectedRealPath) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || resolve(await realpath(path)) !== expectedRealPath) refuse();
}
async function readOpenedArtifact(path, limit) {
  const pathInfo = await lstat(path);
  if (!pathInfo.isFile() || pathInfo.isSymbolicLink() || pathInfo.nlink !== 1 || pathInfo.size <= 0 || pathInfo.size > limit) refuse();
  const file = await open(path, "r");
  try {
    const opened = await file.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== pathInfo.dev || opened.ino !== pathInfo.ino ||
        opened.size !== pathInfo.size || opened.mtimeMs !== pathInfo.mtimeMs) refuse();
    const buffer = Buffer.alloc(limit + 1); let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
      if (length > limit) refuse();
    }
    const final = await file.stat(), finalPath = await lstat(path);
    if (length !== opened.size || final.size !== opened.size || final.mtimeMs !== opened.mtimeMs || final.nlink !== 1 ||
        !finalPath.isFile() || finalPath.isSymbolicLink() || finalPath.dev !== opened.dev || finalPath.ino !== opened.ino ||
        finalPath.size !== opened.size || finalPath.mtimeMs !== opened.mtimeMs || finalPath.nlink !== 1) refuse();
    return buffer.subarray(0, length);
  } finally { await file.close(); }
}

export async function readNativeCaptureSuite(directory, temporaryRoot = tmpdir()) {
  try {
    const path = admitSuiteDirectoryPath(directory, temporaryRoot);
    // Windows may expose the legitimate OS temporary folder using an8.3 alias.
    // Resolve only that separately trusted root; every owned descendant must
    // have the exact corresponding real path and must not be a junction/link.
    const canonicalTemporary = resolve(await realpath(resolve(temporaryRoot)));
    const canonicalParent = join(canonicalTemporary, "dual-surface-ui-native-evidence");
    const ownedParts = relative(resolve(temporaryRoot, "dual-surface-ui-native-evidence"), path).split(sep);
    const canonicalRun = join(canonicalParent, ownedParts[0]), canonicalDirectory = join(canonicalRun, ownedParts[1]);
    await regularDirectory(resolve(temporaryRoot), canonicalTemporary);
    await regularDirectory(resolve(temporaryRoot, "dual-surface-ui-native-evidence"), canonicalParent);
    await regularDirectory(resolve(path, ".."), canonicalRun); await regularDirectory(path, canonicalDirectory);
    const allowed = [...SUITE_ARTIFACT_NAMES, "suite-report.json", "fixture-records"].sort(), names = new Set();
    // opendir keeps a fixed filesystem-entry buffer; do not allocate an
    // unbounded readdir array before enforcing the fixed artifact count.
    for await (const entry of await opendir(path, { bufferSize: 32 })) {
      if (names.size >= allowed.length || !allowed.includes(entry.name) || names.has(entry.name)) refuse();
      names.add(entry.name);
    }
    if (!equal([...names].sort(), allowed)) refuse();
    await regularDirectory(join(path, "fixture-records"), join(canonicalDirectory, "fixture-records"));
    const reportBytes = await readOpenedArtifact(join(path, "suite-report.json"), SUITE_LIMITS.reportBytes);
    const artifacts = new Map();
    for (const name of SUITE_ARTIFACT_NAMES) artifacts.set(name, await readOpenedArtifact(join(path, name), artifactLimit(name)));
    await regularDirectory(path, canonicalDirectory); await regularDirectory(resolve(path, ".."), canonicalRun);
    return { reportBytes, artifacts };
  } catch { refuse(); }
}
