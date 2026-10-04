import { createHash } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

// Private D1/D2 failure-only development evidence. This module neither launches a
// fixture nor reads partial capture, recorder or report contents. A failure
// record can describe a frozen host callsite, never establish native success.
export const FAILURE_LIMITS = Object.freeze({ bytes: 4096, depth: 2, tokens: 32, string: 128 });
export const FAILURE_KEYS = Object.freeze(["schemaVersion", "kind", "sourceDigest", "collectorBinaryDigest",
  "fixtureBinaryDigest", "case", "stage", "site", "classification", "code", "cleanupCode", "recordedAt"]);
const PIN_KEYS = Object.freeze(["sourceDigest", "collectorBinaryDigest", "fixtureBinaryDigest"]);
export const FAILURE_CASES = Object.freeze(["initial", "invoke", "value", "toggle-check", "toggle-repeat", "selection",
  "radio", "tab", "expand", "range", "combo", "disabled", "disabled-toggle", "readonly", "range-boundary",
  "sensitive-unsupported-hidden-offscreen", "injection", "control-replacement", "modal-cancel", "modal-confirm",
  "window-replacement", "process-restart"]);
export const FAILURE_PROPERTY_SITES = Object.freeze(["process-id", "window-handle", "control-type", "automation-id",
  "is-password", "is-enabled", "is-offscreen", "value-readonly", "range-readonly", "expansion-state", "selection-container"]);
const SETUP_SITES = Object.freeze(["setup-admission", "collector-start", "record-read", ...FAILURE_PROPERTY_SITES,
  "runtime-id", "root-from-handle", "tree-first-child", "tree-next-sibling", "tree-parent", "pattern-required",
  "pattern-operation", "sdk-mutation"]);
export const FAILURE_STAGE_SITES = Object.freeze({ output: Object.freeze([]),
  startup: Object.freeze(["fixture-start", "fixture-ready", "setup-admission", "collector-start", "record-read"]),
  setup: SETUP_SITES, capture: Object.freeze(["capture-call", "record-read"]),
  publication: Object.freeze(["artifact-write"]), report: Object.freeze(["report-write"]), cleanup: Object.freeze(["owned-stop"]) });
export const FAILURE_CODES = Object.freeze(["InvalidObservation", "AmbiguousSubject", "ResourceExceeded", "Unavailable", "Timeout", "Unexpected"]);
const GUARD_CODES = FAILURE_CODES.slice(0, 4);
const CLASSES = Object.freeze(["guard-refused", "not-supported", "malformed-property", "sdk-fault", "timeout", "unexpected"]);
const D2_KEYS = Object.freeze([...FAILURE_KEYS, "admissionCheck", "admissionGuard"]);
const TOKEN_GUARDS = Object.freeze(["token-open", "token-elevation-uiaccess", "token-buffer-bound", "token-buffer-result",
  "token-integer-shape", "token-sid-size", "token-sid-pointer", "token-sid-body"]);
const DESKTOP_GUARDS = Object.freeze(["name-query", "desktop-name-or-null", "desktop-input"]);
const ADMISSION_GUARDS = Object.freeze({ "subject-token": TOKEN_GUARDS, "worker-token": TOKEN_GUARDS,
  "current-subject-token": TOKEN_GUARDS, "process-liveness": Object.freeze(["liveness"]),
  "token-context": Object.freeze(["identity-session"]), "session-active": Object.freeze(["session-query-state"]),
  "window-station": Object.freeze(["name-query", "name-value"]), "worker-desktop": DESKTOP_GUARDS,
  "input-desktop-open": Object.freeze(["input-open"]), "input-desktop": DESKTOP_GUARDS,
  "anchored-main": Object.freeze(["window-boundary"]), "main-desktop": DESKTOP_GUARDS });
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const refuse = () => { throw new TypeError("native_suite_failure_refused"); };
const exact = (value, keys) => value !== null && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

function admitPins(pins) {
  if (!exact(pins, PIN_KEYS) || PIN_KEYS.some(key => typeof pins[key] !== "string" || pins[key].length !== 71 || !DIGEST.test(pins[key]))) refuse();
  return Object.fromEntries(PIN_KEYS.map(key => [key, pins[key]]));
}

function timestamp(value) {
  if (typeof value !== "string" || value.length !== 24 || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(value)) return false;
  const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10));
  if (year < 1 || month < 1 || month > 12 || Number(value.slice(11, 13)) > 23 ||
      Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1];
}

// Dedicated flat grammar: original bytes are bounded before decoding, decoded
// keys are unique before JSON.parse can discard duplicates, and container/value
// forms outside the exact flat string/null contract are never accepted.
function parseFlatRecord(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > FAILURE_LIMITS.bytes ||
      bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) refuse();
  let content;
  try { content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); } catch { refuse(); }
  let index = 0, tokens = 0;
  const token = () => { if (++tokens > FAILURE_LIMITS.tokens) refuse(); };
  const whitespace = () => { while (index < content.length && /[\x20\t\r\n]/.test(content[index])) index++; };
  const string = () => {
    token();
    if (content[index] !== '"') refuse();
    const start = index++;
    while (index < content.length) {
      const ch = content[index++];
      if (ch === "\\") { if (index >= content.length) refuse(); index++; continue; }
      if (ch === '"') {
        let value;
        try { value = JSON.parse(content.slice(start, index)); } catch { refuse(); }
        if (typeof value !== "string" || value.length > FAILURE_LIMITS.string || !value.isWellFormed()) refuse();
        return value;
      }
    }
    refuse();
  };
  whitespace(); if (content[index++] !== "{") refuse(); token();
  const result = Object.create(null), keys = new Set();
  whitespace();
  if (content[index] !== "}") while (true) {
    whitespace(); const key = string();
    if (keys.has(key)) refuse(); keys.add(key);
    whitespace(); if (content[index++] !== ":") refuse(); whitespace();
    // Root container depth is1; its scalar slots are at depth2. No nested
    // object/array is legal, so recursion/allocation beyond that limit is absent.
    if (content[index] === '"') result[key] = string();
    else if (content.startsWith("null", index)) { token(); result[key] = null; index += 4; }
    else refuse();
    whitespace();
    if (content[index] === "}") break;
    if (content[index++] !== ",") refuse();
  }
  if (content[index++] !== "}") refuse(); token(); whitespace();
  if (index !== content.length) refuse();
  return result;
}

export function parseNativeSuiteFailure(bytes, pins) {
  try {
    const trusted = admitPins(pins), record = parseFlatRecord(bytes);
    if (!exact(record, FAILURE_KEYS) || record.schemaVersion !== "0.1" || record.kind !== "p4.3-native-capture-suite-failure" ||
        PIN_KEYS.some(key => record[key] !== trusted[key]) || !timestamp(record.recordedAt) ||
        record.case !== "bootstrap" && !FAILURE_CASES.includes(record.case) ||
        !Object.hasOwn(FAILURE_STAGE_SITES, record.stage) ||
        record.site !== null && !FAILURE_STAGE_SITES[record.stage].includes(record.site) ||
        !CLASSES.includes(record.classification) || !FAILURE_CODES.includes(record.code) ||
        record.cleanupCode !== null && !FAILURE_CODES.includes(record.cleanupCode)) refuse();
    if (record.stage === "output" && record.case !== "bootstrap" ||
        record.stage === "startup" && !["bootstrap", "process-restart"].includes(record.case) ||
        ["setup", "capture", "publication", "report"].includes(record.stage) && record.case === "bootstrap" ||
        record.stage === "cleanup" && record.cleanupCode !== null) refuse();
    switch (record.classification) {
      case "guard-refused": if (!GUARD_CODES.includes(record.code)) refuse(); break;
      case "not-supported": case "malformed-property":
        if (record.code !== "InvalidObservation" || !FAILURE_PROPERTY_SITES.includes(record.site)) refuse(); break;
      case "sdk-fault": case "unexpected": if (record.code !== "Unexpected") refuse(); break;
      case "timeout": if (record.code !== "Timeout") refuse(); break;
      default: refuse();
    }
    return Object.freeze(record);
  } catch { refuse(); }
}

// D2 has its own kind and fourteen-key contract. Its null pair preserves every
// original D1 cross-field rule; a closed pair describes only the three existing
// constructor contexts, never an OS cause or a later admission/capture check.
export function parseNativeSuiteD2Failure(bytes, pins) {
  try {
    const trusted = admitPins(pins), record = parseFlatRecord(bytes);
    if (!exact(record, D2_KEYS) || record.schemaVersion !== "0.1" || record.kind !== "p4.3-native-capture-suite-d2-failure" ||
        PIN_KEYS.some(key => record[key] !== trusted[key]) || !timestamp(record.recordedAt) ||
        record.case !== "bootstrap" && !FAILURE_CASES.includes(record.case) ||
        !Object.hasOwn(FAILURE_STAGE_SITES, record.stage) ||
        record.site !== null && !FAILURE_STAGE_SITES[record.stage].includes(record.site) ||
        !CLASSES.includes(record.classification) || !FAILURE_CODES.includes(record.code) ||
        record.cleanupCode !== null && !FAILURE_CODES.includes(record.cleanupCode)) refuse();
    if (record.stage === "output" && record.case !== "bootstrap" ||
        record.stage === "startup" && !["bootstrap", "process-restart"].includes(record.case) ||
        ["setup", "capture", "publication", "report"].includes(record.stage) && record.case === "bootstrap" ||
        record.stage === "cleanup" && record.cleanupCode !== null) refuse();
    switch (record.classification) {
      case "guard-refused": if (!GUARD_CODES.includes(record.code)) refuse(); break;
      case "not-supported": case "malformed-property":
        if (record.code !== "InvalidObservation" || !FAILURE_PROPERTY_SITES.includes(record.site)) refuse(); break;
      case "sdk-fault": case "unexpected": if (record.code !== "Unexpected") refuse(); break;
      case "timeout": if (record.code !== "Timeout") refuse(); break;
      default: refuse();
    }
    const check = record.admissionCheck, guard = record.admissionGuard;
    if ((check === null) !== (guard === null)) refuse();
    if (check !== null && (!Object.hasOwn(ADMISSION_GUARDS, check) || !ADMISSION_GUARDS[check].includes(guard) ||
        record.classification !== "guard-refused" || record.code !== "Unavailable" || record.site !== "setup-admission" ||
        !(["bootstrap", "process-restart"].includes(record.case) && record.stage === "startup" ||
          record.case === "window-replacement" && record.stage === "setup"))) refuse();
    return Object.freeze(record);
  } catch { refuse(); }
}

const samePath = (left, right) => process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
const sameIdentity = (left, right) => left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
const sameFile = (left, right) => sameIdentity(left, right) && left.size === right.size && left.nlink === right.nlink &&
  left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;

async function directoryObservation(path, expectedRealPath = null) {
  const info = await lstat(path, { bigint: true }), canonical = resolve(await realpath(path));
  if (!info.isDirectory() || info.isSymbolicLink() || expectedRealPath !== null && !samePath(canonical, expectedRealPath)) refuse();
  return { path, info, canonical };
}
async function ancestorObservations(path, canonicalOnly) {
  const result = [];
  for (let current = path; ; current = dirname(current)) {
    if (result.length >= 256) refuse();
    result.push(await directoryObservation(current, canonicalOnly ? current : null));
    if (current === dirname(current)) return result;
  }
}
async function recheckDirectories(observations) {
  for (const observed of observations) {
    const current = await directoryObservation(observed.path, observed.canonical);
    if (!sameIdentity(observed.info, current.info)) refuse();
  }
}

async function admitDirectory(directory, temporaryRoot) {
  if (typeof directory !== "string" || !directory || directory.length > 32767 || directory.includes("\0") ||
      typeof temporaryRoot !== "string" || !temporaryRoot || temporaryRoot.length > 32767 || temporaryRoot.includes("\0") ||
      resolve(directory) !== directory || resolve(temporaryRoot) !== temporaryRoot) refuse();
  // The trusted OS temporary root alone may be spelled with its legitimate8.3
  // prefix. Both original and canonical ancestor chains are non-link checked;
  // no alias is tolerated in an owned descendant or in failure.json itself.
  const canonicalTemporary = resolve(await realpath(temporaryRoot));
  const observations = [...await ancestorObservations(temporaryRoot, false), ...await ancestorObservations(canonicalTemporary, true)];
  const originalParent = join(temporaryRoot, "dual-surface-ui-native-evidence");
  const canonicalParent = join(canonicalTemporary, "dual-surface-ui-native-evidence");
  let parts = null;
  for (const parent of [originalParent, canonicalParent]) {
    const candidate = relative(parent, directory).split(sep);
    if (candidate.length === 2 && /^p4\.3-capture-[a-f0-9]{32}$/.test(candidate[0]) && ["first", "repeat"].includes(candidate[1]) &&
        directory.startsWith(parent + sep)) { parts = candidate; break; }
  }
  if (parts === null) refuse();
  const expected = join(canonicalParent, ...parts), parent = dirname(dirname(directory));
  observations.push(await directoryObservation(parent, canonicalParent),
    await directoryObservation(dirname(directory), dirname(expected)), await directoryObservation(directory, expected));
  return { directory, canonical: expected, observations };
}

async function readFailureFile(admission) {
  const path = join(admission.directory, "failure.json"), expected = join(admission.canonical, "failure.json");
  const before = await lstat(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size <= 0n ||
      before.size > BigInt(FAILURE_LIMITS.bytes) || !samePath(resolve(await realpath(path)), expected)) refuse();
  const file = await open(path, "r");
  try {
    const opened = await file.stat({ bigint: true });
    if (!opened.isFile() || opened.nlink !== 1n || !sameFile(before, opened)) refuse();
    const buffer = Buffer.alloc(FAILURE_LIMITS.bytes + 1); let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead; if (length > FAILURE_LIMITS.bytes) refuse();
    }
    const after = await file.stat({ bigint: true }), current = await lstat(path, { bigint: true });
    if (BigInt(length) !== opened.size || !after.isFile() || !sameFile(opened, after) || !current.isFile() ||
        current.isSymbolicLink() || !sameFile(opened, current) || !samePath(resolve(await realpath(path)), expected)) refuse();
    await recheckDirectories(admission.observations);
    return buffer.subarray(0, length);
  } finally { await file.close(); }
}

// temporaryRoot is a private isolated-unit seam, never a CLI parameter. Pins
// supplied to this low-level reader do not grant production execution authority.
// The production entry below admits the actual fixed D2 freeze first instead;
// this separate D1 reader remains available only for its historical contract.
export async function readNativeSuiteFailure(directory, pins, temporaryRoot = tmpdir()) {
  try {
    const trusted = admitPins(pins), admission = await admitDirectory(directory, temporaryRoot);
    const bytes = await readFailureFile(admission), record = parseNativeSuiteFailure(bytes, trusted);
    return Object.freeze({ record, failureDigest: "sha256:" + createHash("sha256").update(bytes).digest("hex"), nativeAccepted: false });
  } catch { refuse(); }
}

export async function readNativeSuiteD2Failure(directory, pins, temporaryRoot = tmpdir()) {
  try {
    const trusted = admitPins(pins), admission = await admitDirectory(directory, temporaryRoot);
    const bytes = await readFailureFile(admission), record = parseNativeSuiteD2Failure(bytes, trusted);
    return Object.freeze({ record, failureDigest: "sha256:" + createHash("sha256").update(bytes).digest("hex"), nativeAccepted: false });
  } catch { refuse(); }
}

export async function inspectOwnedNativeSuiteFailure(root, directory) {
  const { admitNativeSuiteFreeze } = await import("./p4.3-native-suite-source.mjs");
  const trusted = await admitNativeSuiteFreeze(root);
  return readNativeSuiteD2Failure(directory, trusted);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== "--failure-directory") refuse();
    console.log(JSON.stringify(await inspectOwnedNativeSuiteFailure(process.cwd(), process.argv[3])));
  } catch { console.error("p4.3_native_suite_failure_refused"); process.exitCode = 1; }
}
