import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { FAILURE_CASES, FAILURE_CODES, FAILURE_KEYS, FAILURE_LIMITS, FAILURE_PROPERTY_SITES, FAILURE_STAGE_SITES,
  inspectOwnedNativeSuiteFailure, parseNativeSuiteFailure, readNativeSuiteFailure,
  parseNativeSuiteD2Failure, readNativeSuiteD2Failure } from "../scripts/p4.3-native-failure-diagnostics.mjs";
import { CASE_IDS } from "../scripts/p4.2-fixture-contracts.mjs";
import { admitNativeSuiteFreeze } from "../scripts/p4.3-native-suite-source.mjs";

vi.mock("node:fs/promises", { spy: true });
vi.mock("../scripts/p4.3-native-suite-source.mjs", () => ({ admitNativeSuiteFreeze: vi.fn() }));
const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");

const pins = { sourceDigest: "sha256:" + "1".repeat(64), collectorBinaryDigest: "sha256:" + "2".repeat(64),
  fixtureBinaryDigest: "sha256:" + "3".repeat(64) };
const record = () => ({ schemaVersion: "0.1", kind: "p4.3-native-capture-suite-failure", ...pins, case: "initial",
  stage: "setup", site: null as string | null, classification: "guard-refused", code: "InvalidObservation",
  cleanupCode: null as string | null, recordedAt: "2026-10-04T08:00:00.000Z" });
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8");
const parse = (value: unknown, authority = pins) => parseNativeSuiteFailure(bytes(value), authority);
const refused = "native_suite_failure_refused";
const temporaryRoots: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  // Original calls must use the unmocked module, not a reference to the mutable
  // spy whose implementation the current fault-injection vector replaces.
  vi.mocked(fs.open).mockImplementation(actualFs.open);
  vi.mocked(fs.lstat).mockImplementation(actualFs.lstat);
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of temporaryRoots.splice(0)) {
    // Only newly created, explicitly recorded isolated unit roots are removed.
    // These are never real native runs or the preserved failed evidence root.
    if (root !== resolve(root) || !root.startsWith(resolve(tmpdir()) + sep) || !/^p4\.3-failure-unit-[^\\/]+$/.test(root.slice(resolve(tmpdir()).length + 1)))
      throw new Error("unit_cleanup_target_refused");
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function fixture(content: unknown = record()) {
  const temporaryRoot = await fs.mkdtemp(join(tmpdir(), "p4.3-failure-unit-"));
  temporaryRoots.push(temporaryRoot);
  const directory = join(temporaryRoot, "dual-surface-ui-native-evidence", "p4.3-capture-" + randomUUID().replaceAll("-", ""), "first");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(join(directory, "failure.json"), bytes(content), { flag: "wx" });
  return { temporaryRoot, directory, file: join(directory, "failure.json") };
}

describe("P4.3 D1 closed original-byte failure parser (pure; no native proof)", () => {
  it("freezes exactly12 private keys and retains no native success tag", () => {
    const input = record(), result = parse(input);
    expect(result).toEqual(input); expect(Object.keys(result)).toEqual(FAILURE_KEYS);
    expect(Object.isFrozen(result)).toBe(true);
    expect(FAILURE_LIMITS).toEqual({ bytes: 4096, depth: 2, tokens: 32, string: 128 });
    expect(FAILURE_CASES).toEqual(CASE_IDS);
    expect(result).not.toHaveProperty("nativeAccepted"); expect(result).not.toHaveProperty("cases");
  });
  const stageVectors = Object.entries(FAILURE_STAGE_SITES).flatMap(([stage, sites]) => [null, ...sites].map(site => [stage, site] as const));
  it.each(stageVectors)("admits closed %s/%s locations with their fixed case rule", (stage, site) => {
    const input = record(); input.stage = stage; input.site = site;
    if (["output", "startup"].includes(stage)) input.case = "bootstrap";
    expect(parse(input)).toEqual(input);
  });
  it.each(FAILURE_CASES)("admits unchanged fixed case %s after SetCase", id => {
    const input = record(); input.case = id; expect(parse(input).case).toBe(id);
  });
  it("admits process-restart startup and bootstrap cleanup without losing current case", () => {
    const restart = { ...record(), case: "process-restart", stage: "startup", site: "fixture-start" };
    expect(parse(restart).case).toBe("process-restart");
    expect(parse({ ...record(), case: "bootstrap", stage: "cleanup", site: "owned-stop" }).case).toBe("bootstrap");
  });
  it.each(FAILURE_PROPERTY_SITES)("admits already-observed unsupported/malformed classification only at %s", site => {
    for (const classification of ["not-supported", "malformed-property"])
      expect(parse({ ...record(), site, classification }).classification).toBe(classification);
  });
  it.each(FAILURE_CODES.slice(0, 4))("preserves actual guard code %s", code => {
    expect(parse({ ...record(), code }).code).toBe(code);
  });
  it.each([["sdk-fault", "Unexpected"], ["timeout", "Timeout"], ["unexpected", "Unexpected"]])("admits closed %s/%s", (classification, code) => {
    expect(parse({ ...record(), classification, code }).classification).toBe(classification);
  });
  it.each(FAILURE_CODES)("retains later actual cleanup code %s without overriding primary", cleanupCode => {
    const input = { ...record(), cleanupCode }; expect(parse(input)).toEqual(input);
  });
  const wrongFields: [string, unknown][] = [
    ["schemaVersion", "0.2"], ["kind", "p4.3-native-capture-suite"], ["case", "initial-repeat"], ["case", "success"],
    ["stage", "entry"], ["stage", "__proto__"], ["site", "Name"], ["site", "provider-selector"],
    ["classification", "passed"], ["classification", "InvalidOperationException"], ["code", "InvalidOperation"],
    ["cleanupCode", "cleanup_succeeded"], ["schemaVersion", null], ["site", false], ["cleanupCode", false],
    ["case", null], ["stage", null], ["recordedAt", null], ["classification", null], ["code", null],
  ];
  it.each(wrongFields)("rejects unknown/wrong %s=%s", (key, value) => {
    expect(() => parse({ ...record(), [key]: value })).toThrow(refused);
  });
  it.each(FAILURE_KEYS)("rejects missing required %s", key => {
    const input: Record<string, unknown> = record(); delete input[key]; expect(() => parse(input)).toThrow(refused);
  });
  it.each(["PID", "HWND", "runtimeId", "providerName", "value", "text", "helpText", "rawException", "stack", "status", "nativeAccepted"])
    ("rejects unreviewed channel %s", key => { expect(() => parse({ ...record(), [key]: "secret" })).toThrow(refused); });
  const crossFields = [
    { stage: "output", case: "initial" }, { stage: "output", case: "bootstrap", site: "fixture-start" },
    { stage: "startup", case: "initial", site: "fixture-start" }, { stage: "startup", case: "bootstrap", site: "sdk-mutation" },
    { stage: "setup", case: "bootstrap" }, { stage: "capture", case: "bootstrap" },
    { stage: "publication", case: "bootstrap" }, { stage: "report", case: "bootstrap" },
    { stage: "capture", site: "is-enabled" }, { stage: "setup", site: "capture-call" },
    { stage: "publication", site: "report-write" }, { stage: "report", site: "artifact-write" },
    { stage: "cleanup", site: "owned-stop", cleanupCode: "Unexpected" },
    { classification: "not-supported", site: null }, { classification: "malformed-property", site: "runtime-id" },
    { classification: "not-supported", site: "control-type", code: "ResourceExceeded" },
    { classification: "malformed-property", site: "is-enabled", code: "Unavailable" },
    { classification: "guard-refused", code: "Timeout" }, { classification: "guard-refused", code: "Unexpected" },
    { classification: "sdk-fault", code: "InvalidObservation" }, { classification: "sdk-fault", code: "Timeout" },
    { classification: "timeout", code: "ResourceExceeded" }, { classification: "unexpected", code: "Unavailable" },
  ];
  it.each(crossFields)("rejects contradictory case/stage/site/classification/code %j", changes => {
    expect(() => parse({ ...record(), ...changes })).toThrow(refused);
  });
  it.each(["sourceDigest", "collectorBinaryDigest", "fixtureBinaryDigest"])("requires exact independently supplied %s pin", key => {
    expect(() => parse({ ...record(), [key]: "sha256:" + "4".repeat(64) })).toThrow(refused);
    for (const malformed of ["SHA256:" + "1".repeat(64), "sha256:" + "A".repeat(64), "sha256:" + "1".repeat(63),
      pins.sourceDigest + "\n", pins.sourceDigest + "\r\n", pins.sourceDigest + "x", null])
      expect(() => parse(record(), { ...pins, [key]: malformed } as any)).toThrow(refused);
  });
  it("rejects caller authority with extra/missing/null/array pins", () => {
    for (const authority of [{ ...pins, status: "approved" }, { sourceDigest: pins.sourceDigest }, null, []])
      expect(() => parse(record(), authority as any)).toThrow(refused);
  });
  it.each(["0001-01-01T00:00:00.000Z", "2000-02-29T23:59:59.999Z", "2024-02-29T00:00:00.001Z", "9999-12-31T23:59:59.999Z"])
    ("admits real calendar timestamp %s without proving its clock origin", recordedAt => { expect(parse({ ...record(), recordedAt }).recordedAt).toBe(recordedAt); });
  it.each(["0000-01-01T00:00:00.000Z", "1900-02-29T00:00:00.000Z", "2026-02-29T00:00:00.000Z", "2026-04-31T00:00:00.000Z",
    "2026-00-04T08:00:00.000Z", "2026-13-04T08:00:00.000Z", "2026-10-00T08:00:00.000Z", "2026-10-04T24:00:00.000Z",
    "2026-10-04T08:60:00.000Z", "2026-10-04T08:00:60.000Z", "2026-10-04T08:00:00Z", "2026-10-04T08:00:00.0Z",
    "2026-10-04T08:00:00.000+00:00", "2026-10-04t08:00:00.000z", " 2026-10-04T08:00:00.000Z", "2026-10-04T08:00:00.000Z\n"])
    ("rejects invalid/noncanonical timestamp %s", recordedAt => { expect(() => parse({ ...record(), recordedAt })).toThrow(refused); });
  it("admits valid escapes and surrounding JSON whitespace without altering original-byte evidence", () => {
    const escaped = JSON.stringify(record()).replace('"schemaVersion"', '"schema\\u0056ersion"').replace('"setup"', '"s\\u0065tup"');
    expect(parseNativeSuiteFailure(Buffer.from("\t\r\n" + escaped + "\n "), pins)).toEqual(record());
  });
  const invalidJson = [
    "", "{}", "null", "[]", JSON.stringify(record()) + "{}", JSON.stringify(record()) + "true",
    JSON.stringify(record()).replace('"site":null', '"site":nullx'),
    JSON.stringify(record()).replace('"site":null', '"site":{}'),
    JSON.stringify(record()).replace('"site":null', '"site":[[[null]]]'),
    JSON.stringify(record()).replace('"site":null', '"site":0'),
    JSON.stringify(record()).replace('"site":null', '"site":true'),
    JSON.stringify(record()).replace('"site":null', '"site":"\\ud800"'),
    JSON.stringify(record()).replace('"site":null', '"site":"\\udc00"'),
    JSON.stringify(record()).replace('"site":null', '"site":"\\x41"'),
    JSON.stringify(record()).replace('"site":null', '"site":"raw\ncontrol"'),
    JSON.stringify(record()).slice(0, -1) + ",}", JSON.stringify(record()).slice(0, -1),
    JSON.stringify(record()).slice(0, -1) + ',"site":null}',
    JSON.stringify(record()).slice(0, -1) + ',"s\\u0069te":null}',
    JSON.stringify(record()).slice(0, -1) + ',"__proto__":null}',
    JSON.stringify(record()).replace('"site":null', '"site":"' + "x".repeat(129) + '"'),
    '{"' + "k".repeat(129) + '":null}',
    "{" + Array.from({ length: 17 }, (_, i) => '"key' + i + '":null').join(",") + "}",
    "[".repeat(32) + "null" + "]".repeat(32),
  ];
  it.each(invalidJson)("rejects malformed/duplicate/overdepth/token/string JSON vector %#", value => {
    expect(() => parseNativeSuiteFailure(Buffer.from(value), pins)).toThrow(refused);
  });
  it("rejects malformed original UTF8, BOM, incomplete escapes and non-byte input", () => {
    const input = bytes(record());
    for (const malformed of [Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), input]), Buffer.concat([input, Buffer.from([0xff])]),
      Buffer.from([0xc0, 0xaf]), Buffer.from([0xed, 0xa0, 0x80]), Buffer.from([0xf4, 0x90, 0x80, 0x80]),
      Buffer.from([0xe2, 0x82]), Buffer.from('{"site":"\\'), input.toString(), null, []])
      expect(() => parseNativeSuiteFailure(malformed, pins)).toThrow(refused);
  });
  it("admits exact4096 original bytes but rejects4097 before decoding", () => {
    const input = bytes(record()), exact = Buffer.concat([input, Buffer.alloc(4096 - input.length, 0x20)]);
    expect(parseNativeSuiteFailure(exact, pins)).toEqual(record());
    expect(() => parseNativeSuiteFailure(Buffer.concat([exact, Buffer.from(" ")]), pins)).toThrow(refused);
  });
  it("does not stringify error/native/provider data into a rejected record", () => {
    const input = bytes({ ...record(), site: "secret-native-ID-provider-text", code: "secret-exception-message" });
    let caught: any; try { parseNativeSuiteFailure(input, pins); } catch (error) { caught = error; }
    expect(caught?.message).toBe(refused); expect(String(caught)).not.toContain("secret");
  });
});

describe("P4.3 D1 fixed failure-file reader (isolated synthetic IO, no fixture launch)", () => {
  it("reads only failure original bytes and emits explicit negative-only evidence", async () => {
    const owned = await fixture(), original = bytes(record());
    const result = await readNativeSuiteFailure(owned.directory, pins, owned.temporaryRoot);
    expect(result).toEqual({ record: record(), failureDigest: "sha256:" + createHash("sha256").update(original).digest("hex"), nativeAccepted: false });
    expect(Object.keys(result)).toEqual(["record", "failureDigest", "nativeAccepted"]);
    expect(Object.isFrozen(result)).toBe(true); expect(result).not.toHaveProperty("cases");
  });
  it("supports the fixed repeat lane and canonical spelling of its trusted Temp root only", async () => {
    const owned = await fixture(), repeat = join(owned.directory, "..", "repeat");
    await fs.mkdir(repeat); await fs.writeFile(join(repeat, "failure.json"), bytes(record()), { flag: "wx" });
    const canonical = await fs.realpath(repeat);
    expect((await readNativeSuiteFailure(canonical, pins, owned.temporaryRoot)).nativeAccepted).toBe(false);
  });
  it.each(["", "{", '{"status":"passed"}', '{"cases":["initial"]}'])
    ("permits coexisting partial/complete report without reading or interpreting vector %#", async report => {
      const owned = await fixture(); await fs.writeFile(join(owned.directory, "suite-report.json"), report, { flag: "wx" });
      await fs.mkdir(join(owned.directory, "fixture-records"));
      await fs.writeFile(join(owned.directory, "fixture-records", "state-private.json"), "secret-private-content", { flag: "wx" });
      const originalOpen = actualFs.open, opened: string[] = [];
      vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => { opened.push(String(args[0])); return originalOpen(...args); });
      const result = await readNativeSuiteFailure(owned.directory, pins, owned.temporaryRoot);
      expect(result.nativeAccepted).toBe(false); expect(opened).toEqual([owned.file]);
      expect(fs.opendir).not.toHaveBeenCalled(); expect(fs.readdir).not.toHaveBeenCalled(); expect(fs.readFile).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain("secret");
    });
  it("admits exact-byte digest rather than a reserialized surrogate", async () => {
    const owned = await fixture(), original = Buffer.from("\n" + JSON.stringify(record(), null, 2) + "\t");
    await fs.writeFile(owned.file, original);
    const result = await readNativeSuiteFailure(owned.directory, pins, owned.temporaryRoot);
    expect(result.failureDigest).toBe("sha256:" + createHash("sha256").update(original).digest("hex"));
    expect(result.failureDigest).not.toBe("sha256:" + createHash("sha256").update(bytes(record())).digest("hex"));
  });
  it("rejects wrong pins before opening any record", async () => {
    const owned = await fixture(), opened = vi.spyOn(fs, "open");
    await expect(readNativeSuiteFailure(owned.directory, { ...pins, sourceDigest: "wrong" }, owned.temporaryRoot)).rejects.toThrow(refused);
    expect(opened).not.toHaveBeenCalled();
  });
  it("rejects caller-selected paths and aliases outside fixed owned topology", async () => {
    const owned = await fixture();
    for (const path of [join(owned.directory, "failure.json"), join(owned.directory, ".."), join(owned.directory, "..", "third"),
      owned.directory + sep + ".", owned.directory + "\0", "first", join(owned.temporaryRoot, "first"), owned.directory.replace("p4.3-capture-", "p4.3-capture-XYZ")])
      await expect(readNativeSuiteFailure(path, pins, owned.temporaryRoot)).rejects.toThrow(refused);
  });
  it.each(["empty", "truncated", "oversize", "malformed-UTF8", "unknown-kind"])("rejects admitted-path %s record without overwriting it", async kind => {
    const owned = await fixture();
    const content = kind === "empty" ? Buffer.alloc(0) : kind === "truncated" ? bytes(record()).subarray(0, 120) :
      kind === "oversize" ? Buffer.alloc(4097, 0x20) : kind === "malformed-UTF8" ? Buffer.from([0xff]) : bytes({ ...record(), kind: "unknown" });
    await fs.writeFile(owned.file, content);
    await expect(readNativeSuiteFailure(owned.directory, pins, owned.temporaryRoot)).rejects.toThrow(refused);
    expect(await fs.readFile(owned.file)).toEqual(content);
  });
  it("uses a fixed cap+1 opened buffer at the exact cap", async () => {
    const owned = await fixture(), input = bytes(record()), content = Buffer.concat([input, Buffer.alloc(4096 - input.length, 0x20)]);
    await fs.writeFile(owned.file, content);
    const originalOpen = actualFs.open, allocations: number[] = [];
    vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args), originalRead = handle.read.bind(handle);
      vi.spyOn(handle, "read").mockImplementation(async (...readArgs: any[]) => { allocations.push(readArgs[0].length); return originalRead(...readArgs as [any, any, any, any]); });
      return handle;
    });
    expect((await readNativeSuiteFailure(owned.directory, pins, owned.temporaryRoot)).nativeAccepted).toBe(false);
    expect(allocations.length).toBeGreaterThan(0); expect(allocations.every(size => size === 4097)).toBe(true);
  });
  it("rejects a hardlinked file with both original links retained", async () => {
    const owned = await fixture(), extra = join(owned.directory, "unit-hardlink.json");
    await fs.link(owned.file, extra);
    await expect(readNativeSuiteFailure(owned.directory, pins, owned.temporaryRoot)).rejects.toThrow(refused);
    expect(await fs.readFile(owned.file)).toEqual(bytes(record())); expect(await fs.readFile(extra)).toEqual(bytes(record()));
  });
  it("rejects a junction in the owned lane without following its failure file", async () => {
    const owned = await fixture(), target = join(owned.temporaryRoot, "unit-junction-target"), saved = join(owned.temporaryRoot, "unit-original-lane");
    await fs.mkdir(target); await fs.writeFile(join(target, "failure.json"), bytes(record()), { flag: "wx" });
    await fs.rename(owned.directory, saved); await fs.symlink(target, owned.directory, process.platform === "win32" ? "junction" : "dir");
    const opened = vi.spyOn(fs, "open");
    await expect(readNativeSuiteFailure(owned.directory, pins, owned.temporaryRoot)).rejects.toThrow(refused);
    expect(opened).not.toHaveBeenCalled(); expect(await fs.readFile(join(saved, "failure.json"))).toEqual(bytes(record()));
  });
  it("rejects a linked ancestor above even the supplied unit Temp root", async () => {
    const owned = await fixture(), target = join(owned.temporaryRoot, "unit-ancestor-target"), alias = join(owned.temporaryRoot, "unit-ancestor-alias");
    const nestedTemporary = join(target, "nested-temp");
    const lane = join(nestedTemporary, "dual-surface-ui-native-evidence", "p4.3-capture-" + "a".repeat(32), "first");
    await fs.mkdir(lane, { recursive: true }); await fs.writeFile(join(lane, "failure.json"), bytes(record()), { flag: "wx" });
    await fs.symlink(target, alias, process.platform === "win32" ? "junction" : "dir");
    const aliasedTemporary = join(alias, "nested-temp"), aliasedLane = join(aliasedTemporary, "dual-surface-ui-native-evidence", "p4.3-capture-" + "a".repeat(32), "first");
    const opened = vi.spyOn(fs, "open");
    await expect(readNativeSuiteFailure(aliasedLane, pins, aliasedTemporary)).rejects.toThrow(refused);
    expect(opened).not.toHaveBeenCalled();
  });
  it("rejects a changed current file after opened read and closes the owned handle", async () => {
    const owned = await fixture(), originalOpen = actualFs.open, moved = join(owned.directory, "unit-retained-original.json");
    let closed = false, changed = false;
    vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args), originalRead = handle.read.bind(handle), originalClose = handle.close.bind(handle);
      vi.spyOn(handle, "read").mockImplementation(async (...readArgs: any[]) => {
        const result = await originalRead(...readArgs as [any, any, any, any]);
        if (!changed) { changed = true; await fs.rename(owned.file, moved); await fs.writeFile(owned.file, bytes(record()), { flag: "wx" }); }
        return result;
      });
      vi.spyOn(handle, "close").mockImplementation(async () => { closed = true; return originalClose(); });
      return handle;
    });
    await expect(readNativeSuiteFailure(owned.directory, pins, owned.temporaryRoot)).rejects.toThrow(refused);
    expect(changed).toBe(true); expect(closed).toBe(true);
    expect(await fs.readFile(moved)).toEqual(bytes(record()));
  });
  it("rejects same-file mutation observed after opened read", async () => {
    const owned = await fixture(), originalOpen = actualFs.open; let changed = false;
    vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args), originalRead = handle.read.bind(handle);
      vi.spyOn(handle, "read").mockImplementation(async (...readArgs: any[]) => {
        const result = await originalRead(...readArgs as [any, any, any, any]);
        if (!changed) { changed = true; await fs.appendFile(owned.file, " "); } return result;
      });
      return handle;
    });
    await expect(readNativeSuiteFailure(owned.directory, pins, owned.temporaryRoot)).rejects.toThrow(refused);
    expect(changed).toBe(true);
  });
  it("rejects changed ancestor identity in post-read recheck", async () => {
    const owned = await fixture(), originalLstat = actualFs.lstat; let laneReads = 0;
    vi.spyOn(fs, "lstat").mockImplementation(async (...args: Parameters<typeof fs.lstat>) => {
      const result: any = await originalLstat(...args);
      if (String(args[0]) === owned.directory && ++laneReads === 2) return new Proxy(result, {
        get(target, property) { if (property === "ino") return target.ino + 1n; const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value; },
      });
      return result;
    });
    await expect(readNativeSuiteFailure(owned.directory, pins, owned.temporaryRoot)).rejects.toThrow(refused);
    expect(laneReads).toBe(2);
  });
  it("closes the one owned opened handle after a read refusal without publishing or retrying", async () => {
    const owned = await fixture(), originalOpen = actualFs.open; let opened = 0, closed = 0;
    vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      opened++; const handle = await originalOpen(...args), originalClose = handle.close.bind(handle);
      vi.spyOn(handle, "read").mockRejectedValue(new Error("secret-native-exception-message"));
      vi.spyOn(handle, "close").mockImplementation(async () => { closed++; return originalClose(); }); return handle;
    });
    await expect(readNativeSuiteFailure(owned.directory, pins, owned.temporaryRoot)).rejects.toThrow(refused);
    expect(opened).toBe(1); expect(closed).toBe(1);
  });
  it("admits the actual fixed D2 freeze before any failure-directory observation", async () => {
    vi.mocked(admitNativeSuiteFreeze).mockRejectedValue(new Error("fixed-d2-freeze-refused"));
    const observed = vi.spyOn(fs, "lstat"), opened = vi.spyOn(fs, "open");
    await expect(inspectOwnedNativeSuiteFailure("unit-repo-root", "raw-unadmitted-output")).rejects.toThrow("fixed-d2-freeze-refused");
    expect(admitNativeSuiteFreeze).toHaveBeenCalledWith("unit-repo-root");
    expect(observed).not.toHaveBeenCalled(); expect(opened).not.toHaveBeenCalled();
  });
});

// Independent design-derived vectors: no parser table is imported as its own
// expected oracle. These are synthetic bytes and isolated IO, never OS proof.
const d2Pins = { ...pins, sourceDigest: "sha256:" + "a".repeat(64), collectorBinaryDigest: "sha256:" + "b".repeat(64) };
const d2Keys = ["schemaVersion", "kind", "sourceDigest", "collectorBinaryDigest", "fixtureBinaryDigest", "case",
  "stage", "site", "classification", "code", "cleanupCode", "recordedAt", "admissionCheck", "admissionGuard"];
const d2Record = () => ({ ...record(), kind: "p4.3-native-capture-suite-d2-failure", ...d2Pins,
  admissionCheck: null as string | null, admissionGuard: null as string | null });
const taggedD2Record = () => ({ ...d2Record(), case: "bootstrap", stage: "startup", site: "setup-admission",
  code: "Unavailable", admissionCheck: "subject-token", admissionGuard: "token-open" });
const parseD2 = (value: unknown, authority = d2Pins) => parseNativeSuiteD2Failure(bytes(value), authority);
const tokenGuards = ["token-open", "token-elevation-uiaccess", "token-buffer-bound", "token-buffer-result",
  "token-integer-shape", "token-sid-size", "token-sid-pointer", "token-sid-body"];
const desktopGuards = ["name-query", "desktop-name-or-null", "desktop-input"];
const admissionPairsByCheck: Record<string, string[]> = {
  "subject-token": tokenGuards, "worker-token": tokenGuards, "current-subject-token": tokenGuards,
  "process-liveness": ["liveness"], "token-context": ["identity-session"], "session-active": ["session-query-state"],
  "window-station": ["name-query", "name-value"], "worker-desktop": desktopGuards, "input-desktop-open": ["input-open"],
  "input-desktop": desktopGuards, "anchored-main": ["window-boundary"], "main-desktop": desktopGuards,
};
const admissionPairs = Object.entries(admissionPairsByCheck).flatMap(([check, guards]) => guards.map(guard => [check, guard] as const));
const admissionGuards = [...new Set(Object.values(admissionPairsByCheck).flat())];
const constructorContexts = [["bootstrap", "startup"], ["process-restart", "startup"], ["window-replacement", "setup"]] as const;

describe("P4.3 D2 distinct closed constructor-failure parser (pure; no native proof)", () => {
  it("retains exactly14 keys,12 checks,17 guards,40 pairs and all original resource caps", () => {
    const input = d2Record(), result = parseD2(input);
    expect(result).toEqual(input); expect(Object.keys(result)).toEqual(d2Keys); expect(Object.isFrozen(result)).toBe(true);
    expect(Object.keys(admissionPairsByCheck)).toHaveLength(12); expect(admissionGuards).toHaveLength(17);
    expect(admissionPairs).toHaveLength(40);
    expect(FAILURE_LIMITS).toEqual({ bytes: 4096, depth: 2, tokens: 32, string: 128 });
    expect(result).not.toHaveProperty("nativeAccepted"); expect(result).not.toHaveProperty("cases");
  });
  const admitted = constructorContexts.flatMap(([caseId, stage]) => admissionPairs.map(([check, guard]) => [caseId, stage, check, guard] as const));
  it.each(admitted)("admits constructor pair %s/%s/%s/%s", (caseId, stage, admissionCheck, admissionGuard) => {
    const input = { ...taggedD2Record(), case: caseId, stage, admissionCheck, admissionGuard };
    expect(parseD2(input)).toEqual(input);
  });
  const deniedPairs = Object.entries(admissionPairsByCheck).flatMap(([check, validGuards]) =>
    admissionGuards.filter(guard => !validGuards.includes(guard)).map(guard => [check, guard] as const));
  it.each(deniedPairs)("rejects independently known disallowed pair %s/%s", (admissionCheck, admissionGuard) => {
    expect(() => parseD2({ ...taggedD2Record(), admissionCheck, admissionGuard })).toThrow(refused);
  });
  it.each(Object.keys(admissionPairsByCheck))("rejects mixed null %s/null", admissionCheck => {
    expect(() => parseD2({ ...taggedD2Record(), admissionCheck, admissionGuard: null })).toThrow(refused);
  });
  it.each(admissionGuards)("rejects mixed null null/%s", admissionGuard => {
    expect(() => parseD2({ ...taggedD2Record(), admissionCheck: null, admissionGuard })).toThrow(refused);
  });
  const invalidDiagnosticValues = ["", "__proto__", "constructor", "toString", "subject_token", "SubjectToken",
    "token-open\n", "desktop-name", "secret-provider-exception", 0, true, false, [], {}, ["token-open"]];
  it.each(invalidDiagnosticValues.map(value => [value]))("rejects unreviewed check/guard vector %#", value => {
    expect(() => parseD2({ ...taggedD2Record(), admissionCheck: value })).toThrow(refused);
    expect(() => parseD2({ ...taggedD2Record(), admissionGuard: value })).toThrow(refused);
  });
  const wrongContexts = [...FAILURE_CASES.filter(id => id !== "process-restart").map(caseId => ({ case: caseId, stage: "startup" })),
    ...["bootstrap", "process-restart", ...FAILURE_CASES.filter(id => !["process-restart", "window-replacement"].includes(id))]
      .map(caseId => ({ case: caseId, stage: "setup" })),
    ...["output", "capture", "publication", "report", "cleanup"].map(stage => ({ stage })),
    { case: "window-replacement", stage: "capture", site: "capture-call" },
    { case: "process-restart", stage: "cleanup", site: "owned-stop" },
    { case: "window-replacement", stage: "setup", site: "is-enabled" },
    { site: null }, { site: "fixture-start" }, { site: "fixture-ready" }, { site: "collector-start" }, { site: "record-read" }];
  it.each(wrongContexts)("rejects constructor diagnostics outside the exact context %j", changes => {
    expect(() => parseD2({ ...taggedD2Record(), ...changes })).toThrow(refused);
  });
  const otherClassificationCodes = [
    ["guard-refused", "InvalidObservation"], ["guard-refused", "AmbiguousSubject"], ["guard-refused", "ResourceExceeded"],
    ["guard-refused", "Timeout"], ["guard-refused", "Unexpected"], ["not-supported", "InvalidObservation"],
    ["malformed-property", "InvalidObservation"], ["sdk-fault", "Unexpected"], ["timeout", "Timeout"], ["unexpected", "Unexpected"],
  ];
  it.each(otherClassificationCodes)("rejects tagged coarse %s/%s", (classification, code) => {
    expect(() => parseD2({ ...taggedD2Record(), classification, code })).toThrow(refused);
    if (["not-supported", "malformed-property"].includes(classification))
      expect(() => parseD2({ ...taggedD2Record(), case: "window-replacement", stage: "setup", site: "is-enabled", classification, code })).toThrow(refused);
  });
  it.each(FAILURE_CODES)("retains an admitted primary pair with later cleanup %s", cleanupCode => {
    const input = { ...taggedD2Record(), cleanupCode }; expect(parseD2(input)).toEqual(input);
  });
  const stageVectors = Object.entries(FAILURE_STAGE_SITES).flatMap(([stage, sites]) => [null, ...sites].map(site => [stage, site] as const));
  it.each(stageVectors)("preserves original %s/%s grammar with both fields null", (stage, site) => {
    const input = { ...d2Record(), stage, site, case: ["output", "startup"].includes(stage) ? "bootstrap" : "initial" };
    expect(parseD2(input)).toEqual(input);
  });
  it.each(FAILURE_CASES)("preserves original case %s with a null pair", caseId => {
    expect(parseD2({ ...d2Record(), case: caseId }).case).toBe(caseId);
  });
  it.each(FAILURE_PROPERTY_SITES)("preserves null unsupported/malformed pair at %s", site => {
    for (const classification of ["not-supported", "malformed-property"])
      expect(parseD2({ ...d2Record(), site, classification }).classification).toBe(classification);
  });
  it.each([["guard-refused", "InvalidObservation"], ["guard-refused", "AmbiguousSubject"], ["guard-refused", "ResourceExceeded"],
    ["guard-refused", "Unavailable"], ["sdk-fault", "Unexpected"], ["timeout", "Timeout"], ["unexpected", "Unexpected"]])
    ("preserves original null-pair classification %s/%s", (classification, code) => {
      expect(parseD2({ ...d2Record(), classification, code }).classification).toBe(classification);
    });
  it.each(d2Keys)("requires D2 key %s explicitly", key => {
    const input: Record<string, unknown> = d2Record(); delete input[key]; expect(() => parseD2(input)).toThrow(refused);
  });
  it.each(["PID", "HWND", "runtimeId", "providerName", "value", "text", "helpText", "rawException", "stack", "status", "nativeAccepted"])
    ("rejects D2 unreviewed channel %s", key => { expect(() => parseD2({ ...d2Record(), [key]: "secret" })).toThrow(refused); });
  const invalidOriginalFields: [string, unknown][] = [["schemaVersion", "0.2"], ["schemaVersion", null],
    ["kind", "p4.3-native-capture-suite-failure"], ["kind", "p4.3-native-capture-suite"], ["kind", null],
    ["case", "initial-repeat"], ["case", null], ["stage", "__proto__"], ["stage", "entry"], ["stage", null],
    ["site", "Name"], ["site", false], ["classification", "passed"], ["classification", null],
    ["code", "InvalidOperation"], ["code", null], ["cleanupCode", "cleanup_succeeded"], ["cleanupCode", false], ["recordedAt", null]];
  it.each(invalidOriginalFields)("rejects D2 original field %s=%s", (key, value) => {
    expect(() => parseD2({ ...d2Record(), [key]: value })).toThrow(refused);
  });
  const originalContradictions = [
    { stage: "output", case: "initial" }, { stage: "output", case: "bootstrap", site: "fixture-start" },
    { stage: "startup", case: "initial", site: "fixture-start" }, { stage: "startup", case: "bootstrap", site: "sdk-mutation" },
    { stage: "setup", case: "bootstrap" }, { stage: "capture", case: "bootstrap" },
    { stage: "publication", case: "bootstrap" }, { stage: "report", case: "bootstrap" },
    { stage: "capture", site: "is-enabled" }, { stage: "setup", site: "capture-call" },
    { stage: "publication", site: "report-write" }, { stage: "report", site: "artifact-write" },
    { stage: "cleanup", site: "owned-stop", cleanupCode: "Unexpected" },
    { classification: "not-supported", site: null }, { classification: "malformed-property", site: "runtime-id" },
    { classification: "not-supported", site: "control-type", code: "ResourceExceeded" },
    { classification: "malformed-property", site: "is-enabled", code: "Unavailable" },
    { classification: "guard-refused", code: "Timeout" }, { classification: "guard-refused", code: "Unexpected" },
    { classification: "sdk-fault", code: "InvalidObservation" }, { classification: "sdk-fault", code: "Timeout" },
    { classification: "timeout", code: "ResourceExceeded" }, { classification: "unexpected", code: "Unavailable" },
  ];
  it.each(originalContradictions)("preserves original refusal with null pair %j", changes => {
    expect(() => parseD2({ ...d2Record(), ...changes })).toThrow(refused);
  });
  it.each(["sourceDigest", "collectorBinaryDigest", "fixtureBinaryDigest"])("requires D2 authority pin %s exactly", key => {
    expect(() => parseD2({ ...d2Record(), [key]: "sha256:" + "4".repeat(64) })).toThrow(refused);
    for (const malformed of ["SHA256:" + "1".repeat(64), "sha256:" + "A".repeat(64), "sha256:" + "1".repeat(63),
      d2Pins.sourceDigest + "\n", d2Pins.sourceDigest + "\r\n", d2Pins.sourceDigest + "x", null, false, 71])
      expect(() => parseD2(d2Record(), { ...d2Pins, [key]: malformed } as any)).toThrow(refused);
  });
  it("rejects D2 caller authority with extra/missing/null/array and stale D1 pins", () => {
    for (const authority of [{ ...d2Pins, status: "approved" }, { sourceDigest: d2Pins.sourceDigest }, null, [], pins])
      expect(() => parseD2(d2Record(), authority as any)).toThrow(refused);
  });
  it.each(["0001-01-01T00:00:00.000Z", "2000-02-29T23:59:59.999Z", "2024-02-29T00:00:00.001Z", "9999-12-31T23:59:59.999Z"])
    ("preserves canonical D2 UTC timestamp %s", recordedAt => { expect(parseD2({ ...d2Record(), recordedAt }).recordedAt).toBe(recordedAt); });
  it.each(["0000-01-01T00:00:00.000Z", "1900-02-29T00:00:00.000Z", "2026-02-29T00:00:00.000Z", "2026-04-31T00:00:00.000Z",
    "2026-00-04T08:00:00.000Z", "2026-13-04T08:00:00.000Z", "2026-10-00T08:00:00.000Z", "2026-10-04T24:00:00.000Z",
    "2026-10-04T08:60:00.000Z", "2026-10-04T08:00:60.000Z", "2026-10-04T08:00:00Z", "2026-10-04T08:00:00.0Z",
    "2026-10-04T08:00:00.000+00:00", "2026-10-04t08:00:00.000z", " 2026-10-04T08:00:00.000Z", "2026-10-04T08:00:00.000Z\n"])
    ("rejects noncanonical D2 timestamp %s", recordedAt => { expect(() => parseD2({ ...d2Record(), recordedAt })).toThrow(refused); });
  it("keeps D1 and D2 kinds/key sets noninterchangeable under the same valid pins", () => {
    const d1 = { ...record(), ...d2Pins }, d2 = d2Record();
    expect(parseNativeSuiteFailure(bytes(d1), d2Pins)).toEqual(d1); expect(parseD2(d2)).toEqual(d2);
    for (const input of [d1, { ...d1, kind: d2.kind }, { ...d2, kind: d1.kind }])
      expect(() => parseD2(input)).toThrow(refused);
    for (const input of [d2, { ...d2, kind: d1.kind }, { ...d1, kind: d2.kind }])
      expect(() => parseNativeSuiteFailure(bytes(input), d2Pins)).toThrow(refused);
  });
  it("admits decoded keys/closed literals and surrounding JSON whitespace", () => {
    const input = taggedD2Record(), escaped = JSON.stringify(input).replace('"admissionCheck"', '"admission\\u0043heck"')
      .replace('"admissionGuard"', '"admission\\u0047uard"').replace('"subject-token"', '"subject\\u002dtoken"')
      .replace('"token-open"', '"token\\u002dopen"');
    expect(parseNativeSuiteD2Failure(Buffer.from("\t\r\n" + escaped + "\n "), d2Pins)).toEqual(input);
  });
  it.each(d2Keys)("rejects literal and decoded escaped duplicate D2 key %s", key => {
    const input = d2Record(), value = JSON.stringify(input[key as keyof typeof input]);
    for (const name of [key, "\\u" + key.charCodeAt(0).toString(16).padStart(4, "0") + key.slice(1)]) {
      const duplicate = JSON.stringify(input).slice(0, -1) + ',"' + name + '":' + value + "}";
      expect(() => parseNativeSuiteD2Failure(Buffer.from(duplicate), d2Pins)).toThrow(refused);
    }
  });
  const invalidD2Json = ["", "{}", "null", "[]", JSON.stringify(d2Record()) + "{}", JSON.stringify(d2Record()) + "true",
    JSON.stringify(d2Record()).replace('"admissionCheck":null', '"admissionCheck":nullx'),
    JSON.stringify(d2Record()).replace('"admissionCheck":null', '"admissionCheck":{}'),
    JSON.stringify(d2Record()).replace('"admissionCheck":null', '"admissionCheck":[[[null]]]'),
    JSON.stringify(d2Record()).replace('"admissionCheck":null', '"admissionCheck":0'),
    JSON.stringify(d2Record()).replace('"admissionGuard":null', '"admissionGuard":true'),
    JSON.stringify(d2Record()).replace('"admissionCheck":null', '"admissionCheck":"\\ud800"'),
    JSON.stringify(d2Record()).replace('"admissionGuard":null', '"admissionGuard":"\\udc00"'),
    JSON.stringify(d2Record()).replace('"admissionGuard":null', '"admissionGuard":"\\x41"'),
    JSON.stringify(d2Record()).replace('"admissionGuard":null', '"admissionGuard":"raw\ncontrol"'),
    JSON.stringify(d2Record()).slice(0, -1) + ",}", JSON.stringify(d2Record()).slice(0, -1),
    JSON.stringify(d2Record()).replace('"admissionCheck":null', '"admissionCheck":"' + "x".repeat(129) + '"'),
    '{"' + "k".repeat(129) + '":null}',
    ...[15, 16, 17].map(count => "{" + Array.from({ length: count }, (_, i) => '"key' + i + '":null').join(",") + "}"),
    "[".repeat(32) + "null" + "]".repeat(32), JSON.stringify(d2Record()) + "\u00a0"];
  it.each(invalidD2Json)("rejects D2 malformed/depth/token/string/UTF16/trailing vector %#", value => {
    expect(() => parseNativeSuiteD2Failure(Buffer.from(value), d2Pins)).toThrow(refused);
  });
  it("rejects malformed original UTF8, BOM, incomplete escapes and non-byte D2 input", () => {
    const input = bytes(d2Record());
    for (const malformed of [Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), input]), Buffer.concat([input, Buffer.from([0xff])]),
      Buffer.from([0xc0, 0xaf]), Buffer.from([0xed, 0xa0, 0x80]), Buffer.from([0xf4, 0x90, 0x80, 0x80]), Buffer.from([0xe2, 0x82]),
      Buffer.from('{"admissionCheck":"\\'), input.toString(), null, [], new DataView(input.buffer)])
      expect(() => parseNativeSuiteD2Failure(malformed, d2Pins)).toThrow(refused);
  });
  it("admits14 fields/30 tokens at exactly4096 original bytes and rejects4097", () => {
    const input = bytes(taggedD2Record()), exact = Buffer.concat([input, Buffer.alloc(4096 - input.length, 0x20)]);
    expect(parseNativeSuiteD2Failure(exact, d2Pins)).toEqual(taggedD2Record());
    expect(() => parseNativeSuiteD2Failure(Buffer.concat([exact, Buffer.from(" ")]), d2Pins)).toThrow(refused);
  });
  it("withholds diagnostic/native/provider text and exception details on refusal", () => {
    let caught: any;
    try { parseD2({ ...taggedD2Record(), admissionCheck: "secret-native-ID", admissionGuard: "secret-provider-exception" }); }
    catch (error) { caught = error; }
    expect(caught?.message).toBe(refused); expect(String(caught)).not.toContain("secret");
  });
});

describe("P4.3 D2 fixed failure-file reader (isolated synthetic IO, no fixture launch)", () => {
  it("reads only the original failure bytes and emits frozen negative-only evidence", async () => {
    const input = taggedD2Record(), owned = await fixture(input), original = bytes(input);
    const result = await readNativeSuiteD2Failure(owned.directory, d2Pins, owned.temporaryRoot);
    expect(result).toEqual({ record: input, failureDigest: "sha256:" + createHash("sha256").update(original).digest("hex"), nativeAccepted: false });
    expect(Object.keys(result)).toEqual(["record", "failureDigest", "nativeAccepted"]);
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.record)).toBe(true);
    expect(result).not.toHaveProperty("cases");
  });
  it("admits only the fixed repeat lane or the trusted Temp root's canonical spelling", async () => {
    const owned = await fixture(d2Record()), repeat = join(owned.directory, "..", "repeat");
    await fs.mkdir(repeat); await fs.writeFile(join(repeat, "failure.json"), bytes(d2Record()), { flag: "wx" });
    const canonical = await fs.realpath(repeat);
    expect((await readNativeSuiteD2Failure(canonical, d2Pins, owned.temporaryRoot)).nativeAccepted).toBe(false);
  });
  it.each(["", "{", '{"status":"passed"}', '{"cases":["initial"]}'])
    ("ignores coexisting D2 partial/complete report and recorder vector %#", async report => {
      const owned = await fixture(d2Record());
      await fs.writeFile(join(owned.directory, "suite-report.json"), report, { flag: "wx" });
      await fs.mkdir(join(owned.directory, "fixture-records"));
      await fs.writeFile(join(owned.directory, "fixture-records", "state-private.json"), "secret-private-content", { flag: "wx" });
      const opened: string[] = [];
      vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
        opened.push(String(args[0])); return actualFs.open(...args);
      });
      const result = await readNativeSuiteD2Failure(owned.directory, d2Pins, owned.temporaryRoot);
      expect(result.nativeAccepted).toBe(false); expect(opened).toEqual([owned.file]);
      expect(fs.opendir).not.toHaveBeenCalled(); expect(fs.readdir).not.toHaveBeenCalled(); expect(fs.readFile).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain("secret");
    });
  it("hashes the original whitespace and escaped bytes without reserialization", async () => {
    const owned = await fixture(d2Record()), original = Buffer.from("\n" + JSON.stringify(d2Record(), null, 2)
      .replace('"admissionCheck"', '"admission\\u0043heck"') + "\t");
    await fs.writeFile(owned.file, original);
    const result = await readNativeSuiteD2Failure(owned.directory, d2Pins, owned.temporaryRoot);
    expect(result.failureDigest).toBe("sha256:" + createHash("sha256").update(original).digest("hex"));
    expect(result.failureDigest).not.toBe("sha256:" + createHash("sha256").update(bytes(d2Record())).digest("hex"));
  });
  it("rejects malformed authority before observing any D2 output path", async () => {
    const owned = await fixture(d2Record()), observed = vi.spyOn(fs, "lstat"), opened = vi.spyOn(fs, "open");
    observed.mockClear(); opened.mockClear();
    for (const authority of [{ ...d2Pins, sourceDigest: "wrong" }, { ...d2Pins, status: "approved" }, {}, null, []])
      await expect(readNativeSuiteD2Failure(owned.directory, authority, owned.temporaryRoot)).rejects.toThrow(refused);
    expect(observed).not.toHaveBeenCalled(); expect(opened).not.toHaveBeenCalled();
  });
  it("rejects arbitrary paths, aliases, invalid Temp seams and topology spelling", async () => {
    const owned = await fixture(d2Record());
    for (const path of [join(owned.directory, "failure.json"), join(owned.directory, ".."), join(owned.directory, "..", "third"),
      owned.directory + sep + ".", owned.directory + "\0", "first", join(owned.temporaryRoot, "first"),
      owned.directory.replace("p4.3-capture-", "p4.3-capture-XYZ"), owned.directory.replace("p4.3-capture-", "p4.3-capture-" + "a"),
      owned.directory.replace("dual-surface-ui-native-evidence", "arbitrary-evidence")])
      await expect(readNativeSuiteD2Failure(path, d2Pins, owned.temporaryRoot)).rejects.toThrow(refused);
    for (const temporaryRoot of ["", "relative-temp", owned.temporaryRoot + sep + ".", owned.temporaryRoot + "\0", null, 123])
      await expect(readNativeSuiteD2Failure(owned.directory, d2Pins, temporaryRoot)).rejects.toThrow(refused);
  });
  it.each(["empty", "truncated", "oversize", "malformed-UTF8", "unknown-kind", "D1-kind", "mixed-null", "wrong-pair", "stale-pins"])
    ("rejects D2 admitted-path %s bytes and retains the original file", async kind => {
      const input = d2Record(), owned = await fixture(input);
      const content = kind === "empty" ? Buffer.alloc(0) : kind === "truncated" ? bytes(input).subarray(0, 120) :
        kind === "oversize" ? Buffer.alloc(4097, 0x20) : kind === "malformed-UTF8" ? Buffer.from([0xff]) :
        kind === "unknown-kind" ? bytes({ ...input, kind: "unknown" }) : kind === "D1-kind" ? bytes(record()) :
        kind === "mixed-null" ? bytes({ ...taggedD2Record(), admissionGuard: null }) :
        kind === "wrong-pair" ? bytes({ ...taggedD2Record(), admissionGuard: "window-boundary" }) : bytes({ ...input, ...pins });
      await fs.writeFile(owned.file, content);
      await expect(readNativeSuiteD2Failure(owned.directory, d2Pins, owned.temporaryRoot)).rejects.toThrow(refused);
      expect(await fs.readFile(owned.file)).toEqual(content);
    });
  it("keeps both readers noninterchangeable without guessing or falling back", async () => {
    const d1 = { ...record(), ...d2Pins }, d2 = d2Record(), owned = await fixture(d1);
    expect((await readNativeSuiteFailure(owned.directory, d2Pins, owned.temporaryRoot)).record).toEqual(d1);
    await expect(readNativeSuiteD2Failure(owned.directory, d2Pins, owned.temporaryRoot)).rejects.toThrow(refused);
    await fs.writeFile(owned.file, bytes(d2));
    expect((await readNativeSuiteD2Failure(owned.directory, d2Pins, owned.temporaryRoot)).record).toEqual(d2);
    await expect(readNativeSuiteFailure(owned.directory, d2Pins, owned.temporaryRoot)).rejects.toThrow(refused);
  });
  it("uses only the unchanged cap+1 buffer with exact4096 bytes", async () => {
    const input = bytes(taggedD2Record()), owned = await fixture(taggedD2Record()), allocations: number[] = [];
    await fs.writeFile(owned.file, Buffer.concat([input, Buffer.alloc(4096 - input.length, 0x20)]));
    vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await actualFs.open(...args), originalRead = handle.read.bind(handle);
      vi.spyOn(handle, "read").mockImplementation(async (...readArgs: any[]) => {
        allocations.push(readArgs[0].length); return originalRead(...readArgs as [any, any, any, any]);
      });
      return handle;
    });
    expect((await readNativeSuiteD2Failure(owned.directory, d2Pins, owned.temporaryRoot)).nativeAccepted).toBe(false);
    expect(allocations.length).toBeGreaterThan(0); expect(allocations.every(size => size === 4097)).toBe(true);
  });
  it("rejects a D2 hardlinked file with both original links retained", async () => {
    const owned = await fixture(d2Record()), extra = join(owned.directory, "unit-hardlink.json");
    await fs.link(owned.file, extra);
    const opened = vi.spyOn(fs, "open"); opened.mockClear();
    await expect(readNativeSuiteD2Failure(owned.directory, d2Pins, owned.temporaryRoot)).rejects.toThrow(refused);
    expect(opened).not.toHaveBeenCalled();
    expect(await fs.readFile(owned.file)).toEqual(bytes(d2Record())); expect(await fs.readFile(extra)).toEqual(bytes(d2Record()));
  });
  it("rejects the file-symbolic-link guard before opening the named file", async () => {
    const owned = await fixture(d2Record()), opened = vi.spyOn(fs, "open"); opened.mockClear();
    vi.spyOn(fs, "lstat").mockImplementation(async (...args: Parameters<typeof fs.lstat>) => {
      const info: any = await actualFs.lstat(...args);
      return String(args[0]) !== owned.file ? info : new Proxy(info, {
        get(target, property) { if (property === "isSymbolicLink") return () => true;
          const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value; },
      });
    });
    await expect(readNativeSuiteD2Failure(owned.directory, d2Pins, owned.temporaryRoot)).rejects.toThrow(refused);
    expect(opened).not.toHaveBeenCalled();
  });
  it("rejects a real junction in the owned D2 lane before opening its file", async () => {
    const owned = await fixture(d2Record()), target = join(owned.temporaryRoot, "unit-junction-target"), saved = join(owned.temporaryRoot, "unit-original-lane");
    await fs.mkdir(target); await fs.writeFile(join(target, "failure.json"), bytes(d2Record()), { flag: "wx" });
    await fs.rename(owned.directory, saved); await fs.symlink(target, owned.directory, process.platform === "win32" ? "junction" : "dir");
    const opened = vi.spyOn(fs, "open"); opened.mockClear();
    await expect(readNativeSuiteD2Failure(owned.directory, d2Pins, owned.temporaryRoot)).rejects.toThrow(refused);
    expect(opened).not.toHaveBeenCalled(); expect(await fs.readFile(join(saved, "failure.json"))).toEqual(bytes(d2Record()));
  });
  it("rejects a real linked ancestor above the isolated D2 Temp root", async () => {
    const owned = await fixture(d2Record()), target = join(owned.temporaryRoot, "unit-ancestor-target"), alias = join(owned.temporaryRoot, "unit-ancestor-alias");
    const nestedTemporary = join(target, "nested-temp");
    const lane = join(nestedTemporary, "dual-surface-ui-native-evidence", "p4.3-capture-" + "a".repeat(32), "first");
    await fs.mkdir(lane, { recursive: true }); await fs.writeFile(join(lane, "failure.json"), bytes(d2Record()), { flag: "wx" });
    await fs.symlink(target, alias, process.platform === "win32" ? "junction" : "dir");
    const aliasedTemporary = join(alias, "nested-temp"), aliasedLane = join(aliasedTemporary, "dual-surface-ui-native-evidence", "p4.3-capture-" + "a".repeat(32), "first");
    const opened = vi.spyOn(fs, "open"); opened.mockClear();
    await expect(readNativeSuiteD2Failure(aliasedLane, d2Pins, aliasedTemporary)).rejects.toThrow(refused);
    expect(opened).not.toHaveBeenCalled();
  });
  it("rejects a canonical file alias before opening it", async () => {
    const owned = await fixture(d2Record()), opened = vi.spyOn(fs, "open"); opened.mockClear();
    vi.spyOn(fs, "realpath").mockImplementation(async (...args: Parameters<typeof fs.realpath>) => {
      const canonical = await actualFs.realpath(...args);
      return String(args[0]) === owned.file ? String(canonical) + ".alias" : canonical;
    });
    await expect(readNativeSuiteD2Failure(owned.directory, d2Pins, owned.temporaryRoot)).rejects.toThrow(refused);
    expect(opened).not.toHaveBeenCalled();
  });
  const identityFields = ["dev", "ino", "mode", "size", "nlink", "mtimeNs", "ctimeNs"];
  it.each(identityFields)("rejects changed opened D2 file %s and closes the handle before reading", async field => {
    const owned = await fixture(d2Record()); let opened = 0, read = 0, closed = 0;
    vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      opened++; const handle = await actualFs.open(...args), originalStat = handle.stat.bind(handle), originalClose = handle.close.bind(handle);
      vi.spyOn(handle, "stat").mockImplementation(async (...statArgs: any[]) => {
        const info: any = await originalStat(statArgs[0]);
        return new Proxy(info, { get(target, property) { if (property === field) return target[property] + 1n;
          const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value; } });
      });
      vi.spyOn(handle, "read").mockImplementation(async () => { read++; throw new Error("unit_read_unexpected"); });
      vi.spyOn(handle, "close").mockImplementation(async () => { closed++; return originalClose(); });
      return handle;
    });
    await expect(readNativeSuiteD2Failure(owned.directory, d2Pins, owned.temporaryRoot)).rejects.toThrow(refused);
    expect(opened).toBe(1); expect(read).toBe(0); expect(closed).toBe(1);
  });
  it.each(identityFields)("rejects changed post-read D2 file %s and closes the handle", async field => {
    const owned = await fixture(d2Record()); let stats = 0, read = 0, closed = 0;
    vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await actualFs.open(...args), originalStat = handle.stat.bind(handle), originalRead = handle.read.bind(handle), originalClose = handle.close.bind(handle);
      vi.spyOn(handle, "stat").mockImplementation(async (...statArgs: any[]) => {
        const info: any = await originalStat(statArgs[0]);
        if (++stats !== 2) return info;
        return new Proxy(info, { get(target, property) { if (property === field) return target[property] + 1n;
          const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value; } });
      });
      vi.spyOn(handle, "read").mockImplementation(async (...readArgs: any[]) => { read++; return originalRead(...readArgs as [any, any, any, any]); });
      vi.spyOn(handle, "close").mockImplementation(async () => { closed++; return originalClose(); }); return handle;
    });
    await expect(readNativeSuiteD2Failure(owned.directory, d2Pins, owned.temporaryRoot)).rejects.toThrow(refused);
    expect(stats).toBe(2); expect(read).toBeGreaterThan(0); expect(closed).toBe(1);
  });
  it("rejects replacement of the named D2 file during an opened read", async () => {
    const owned = await fixture(d2Record()), moved = join(owned.directory, "unit-retained-original.json"); let changed = false, closed = 0;
    vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await actualFs.open(...args), originalRead = handle.read.bind(handle), originalClose = handle.close.bind(handle);
      vi.spyOn(handle, "read").mockImplementation(async (...readArgs: any[]) => {
        const result = await originalRead(...readArgs as [any, any, any, any]);
        if (!changed) { changed = true; await fs.rename(owned.file, moved); await fs.writeFile(owned.file, bytes(d2Record()), { flag: "wx" }); }
        return result;
      });
      vi.spyOn(handle, "close").mockImplementation(async () => { closed++; return originalClose(); }); return handle;
    });
    await expect(readNativeSuiteD2Failure(owned.directory, d2Pins, owned.temporaryRoot)).rejects.toThrow(refused);
    expect(changed).toBe(true); expect(closed).toBe(1); expect(await fs.readFile(moved)).toEqual(bytes(d2Record()));
  });
  it("rejects same-file D2 mutation during the opened read", async () => {
    const owned = await fixture(d2Record()); let changed = false;
    vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await actualFs.open(...args), originalRead = handle.read.bind(handle);
      vi.spyOn(handle, "read").mockImplementation(async (...readArgs: any[]) => {
        const result = await originalRead(...readArgs as [any, any, any, any]);
        if (!changed) { changed = true; await fs.appendFile(owned.file, " "); } return result;
      }); return handle;
    });
    await expect(readNativeSuiteD2Failure(owned.directory, d2Pins, owned.temporaryRoot)).rejects.toThrow(refused);
    expect(changed).toBe(true);
  });
  it("rejects changed D2 lane identity in the post-read ancestor check", async () => {
    const owned = await fixture(d2Record()); let laneReads = 0;
    vi.spyOn(fs, "lstat").mockImplementation(async (...args: Parameters<typeof fs.lstat>) => {
      const info: any = await actualFs.lstat(...args);
      if (String(args[0]) !== owned.directory || ++laneReads !== 2) return info;
      return new Proxy(info, { get(target, property) { if (property === "ino") return target.ino + 1n;
        const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value; } });
    });
    await expect(readNativeSuiteD2Failure(owned.directory, d2Pins, owned.temporaryRoot)).rejects.toThrow(refused);
    expect(laneReads).toBe(2);
  });
  it("closes the sole owned D2 handle after read failure without publishing or retrying", async () => {
    const owned = await fixture(d2Record()); let opened = 0, closed = 0;
    vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      opened++; const handle = await actualFs.open(...args), originalClose = handle.close.bind(handle);
      vi.spyOn(handle, "read").mockRejectedValue(new Error("secret-native-exception-message"));
      vi.spyOn(handle, "close").mockImplementation(async () => { closed++; return originalClose(); }); return handle;
    });
    await expect(readNativeSuiteD2Failure(owned.directory, d2Pins, owned.temporaryRoot)).rejects.toThrow(refused);
    expect(opened).toBe(1); expect(closed).toBe(1);
  });
  it("withholds paths if the fixed freeze supplies malformed pins", async () => {
    vi.mocked(admitNativeSuiteFreeze).mockResolvedValue({ ...d2Pins, sourceDigest: "wrong" });
    const observed = vi.spyOn(fs, "lstat"), canonical = vi.spyOn(fs, "realpath"), opened = vi.spyOn(fs, "open");
    await expect(inspectOwnedNativeSuiteFailure("unit-repo-root", "raw-unadmitted-output")).rejects.toThrow(refused);
    expect(admitNativeSuiteFreeze).toHaveBeenCalledWith("unit-repo-root");
    expect(observed).not.toHaveBeenCalled(); expect(canonical).not.toHaveBeenCalled(); expect(opened).not.toHaveBeenCalled();
  });
  it("dispatches production explicitly to D2 after authority and never falls back to D1", async () => {
    const owned = await fixture(d2Record()), canonicalTemporary = String(await actualFs.realpath(tmpdir()));
    // Redirect only this synthetic production-shaped lane into the private
    // isolated Temp seam. No real native output or fixed governance file is read.
    const productionParent = join(canonicalTemporary, "dual-surface-ui-native-evidence"),
      productionDirectory = join(productionParent, "p4.3-capture-" + randomUUID().replaceAll("-", ""), "first"),
      productionRun = join(productionDirectory, ".."), productionFile = join(productionDirectory, "failure.json"),
      isolatedRun = join(owned.directory, ".."), isolatedParent = join(isolatedRun, ".."),
      canonicalIsolatedParent = String(await actualFs.realpath(isolatedParent)), canonicalIsolatedRun = String(await actualFs.realpath(isolatedRun));
    const redirect = (path: unknown) => {
      const value = String(path);
      if (value === productionParent) return isolatedParent;
      if (value === productionRun || value.startsWith(productionRun + sep)) return join(isolatedRun, relative(productionRun, value));
      return value;
    };
    vi.mocked(admitNativeSuiteFreeze).mockResolvedValue(d2Pins);
    vi.spyOn(fs, "lstat").mockImplementation(async (...args: Parameters<typeof fs.lstat>) => {
      expect(admitNativeSuiteFreeze).toHaveBeenCalledWith("unit-repo-root");
      return actualFs.lstat(redirect(args[0]), args[1] as any);
    });
    vi.spyOn(fs, "realpath").mockImplementation(async (...args: Parameters<typeof fs.realpath>) => {
      const canonical = String(await actualFs.realpath(redirect(args[0]), args[1] as any));
      if (canonical === canonicalIsolatedParent) return productionParent;
      return canonical === canonicalIsolatedRun || canonical.startsWith(canonicalIsolatedRun + sep) ?
        join(productionRun, relative(canonicalIsolatedRun, canonical)) : canonical;
    });
    const opened: string[] = [];
    vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      opened.push(String(args[0])); return actualFs.open(redirect(args[0]), args[1], args[2]);
    });
    expect((await inspectOwnedNativeSuiteFailure("unit-repo-root", productionDirectory)).record).toEqual(d2Record());
    for (const input of [{ ...record(), ...d2Pins }, { ...record(), ...d2Pins, kind: d2Record().kind }, { ...d2Record(), kind: record().kind }]) {
      await fs.writeFile(owned.file, bytes(input));
      await expect(inspectOwnedNativeSuiteFailure("unit-repo-root", productionDirectory)).rejects.toThrow(refused);
    }
    expect(admitNativeSuiteFreeze).toHaveBeenCalledTimes(4); expect(opened).toEqual(Array(4).fill(productionFile));
    expect(fs.readdir).not.toHaveBeenCalled(); expect(fs.opendir).not.toHaveBeenCalled(); expect(fs.readFile).not.toHaveBeenCalled();
  });
});
