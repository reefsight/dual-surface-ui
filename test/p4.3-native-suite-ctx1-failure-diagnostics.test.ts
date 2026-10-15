import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { FAILURE_CASES, FAILURE_CODES, FAILURE_KEYS, FAILURE_LIMITS, FAILURE_PROPERTY_SITES, FAILURE_STAGE_SITES,
  inspectOwnedNativeSuiteCtx1Failure as inspectOwnedNativeSuiteFailure,
  parseNativeSuiteCtx1Failure as parseNativeSuiteFailure, readNativeSuiteCtx1Failure as readNativeSuiteFailure,
  WINDOW_HANDLE_READ_CONTEXTS } from "../scripts/p4.3-native-suite-ctx1-failure-diagnostics.mjs";
import { parseNativeSuiteFailure as parseLegacyD1, parseNativeSuiteD2Failure as parseLegacyD2 }
  from "../scripts/p4.3-native-failure-diagnostics.mjs";
import { CASE_IDS } from "../scripts/p4.2-fixture-contracts.mjs";
import { admitNativeSuiteCtx1Freeze } from "../scripts/p4.3-native-suite-ctx1-source.mjs";

vi.mock("node:fs/promises", { spy: true });
vi.mock("../scripts/p4.3-native-suite-ctx1-source.mjs", () => ({ admitNativeSuiteCtx1Freeze: vi.fn() }));
const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");

const pins = { sourceDigest: "sha256:" + "1".repeat(64), collectorBinaryDigest: "sha256:" + "2".repeat(64),
  fixtureBinaryDigest: "sha256:" + "3".repeat(64) };
const record = () => ({ schemaVersion: "0.1", kind: "p4.3-native-capture-suite-ctx1-failure", ...pins, case: "initial",
  stage: "setup", site: null as string | null, classification: "guard-refused", code: "InvalidObservation",
  cleanupCode: null as string | null, recordedAt: "2026-10-04T08:00:00.000Z",
  admissionCheck: null as string | null, admissionGuard: null as string | null, readContext: null as string | null });
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8");
const parse = (value: unknown, authority = pins) => parseNativeSuiteFailure(bytes(value), authority);
const refused = "native_suite_ctx1_failure_refused";
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
    if (root !== resolve(root) || !root.startsWith(resolve(tmpdir()) + sep) || !/^p4\.3-ctx1-failure-unit-[^\\/]+$/.test(root.slice(resolve(tmpdir()).length + 1)))
      throw new Error("unit_cleanup_target_refused");
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function fixture(content: unknown = record()) {
  const temporaryRoot = await fs.mkdtemp(join(tmpdir(), "p4.3-ctx1-failure-unit-"));
  temporaryRoots.push(temporaryRoot);
  const directory = join(temporaryRoot, "dual-surface-ui-native-evidence", "p4.3-capture-" + randomUUID().replaceAll("-", ""), "first");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(join(directory, "failure.json"), bytes(content), { flag: "wx" });
  return { temporaryRoot, directory, file: join(directory, "failure.json") };
}

describe("P4.3 CTX1 closed original-byte failure parser (pure; no native proof)", () => {
  it("freezes exactly15 private keys and retains no native success tag", () => {
    const input = record(), result = parse(input);
    expect(result).toEqual(input); expect(Object.keys(result)).toEqual(FAILURE_KEYS);
    expect(Object.isFrozen(result)).toBe(true);
    expect(FAILURE_LIMITS).toEqual({ bytes: 4096, depth: 2, tokens: 32, string: 128 });
    expect(FAILURE_CASES).toEqual(CASE_IDS);
    expect(result).not.toHaveProperty("nativeAccepted"); expect(result).not.toHaveProperty("cases");
  });
  const stageVectors = Object.entries(FAILURE_STAGE_SITES).flatMap(([stage, sites]) => [null, ...sites].map(site => [stage, site] as const));
  it.each(stageVectors)("admits closed %s/%s locations with their fixed case rule", (stage, site) => {
    const input = record(); input.stage = stage; input.site = site; input.readContext = site === "window-handle" ? "root-guard" : null;
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
      expect(parse({ ...record(), site, classification, readContext: site === "window-handle" ? "root-guard" : null }).classification).toBe(classification);
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

describe("P4.3 CTX1 fixed failure-file reader (isolated synthetic IO, no fixture launch)", () => {
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
  it("admits the actual fixed CTX1 freeze before any failure-directory observation", async () => {
    vi.mocked(admitNativeSuiteCtx1Freeze).mockRejectedValue(new Error("fixed-ctx1-freeze-refused"));
    const observed = vi.spyOn(fs, "lstat"), opened = vi.spyOn(fs, "open");
    await expect(inspectOwnedNativeSuiteFailure("unit-repo-root", "raw-unadmitted-output")).rejects.toThrow("fixed-ctx1-freeze-refused");
    expect(admitNativeSuiteCtx1Freeze).toHaveBeenCalledWith("unit-repo-root");
    expect(observed).not.toHaveBeenCalled(); expect(opened).not.toHaveBeenCalled();
  });
});

// Independent design-derived vectors: no parser table is imported as its own
// expected oracle. These are synthetic bytes and isolated IO, never OS proof.

// Exact original bytes shared with managed pure UnitCases. Never native proof.
const sharedCorpus: { name: string; accept: boolean; base64: string }[] =
// CTX1_CORPUS_BEGIN
[
  {
    "name": "coarse-null",
    "accept": true,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJpbml0aWFsIiwic3RhZ2UiOiJzZXR1cCIsInNpdGUiOm51bGwsImNsYXNzaWZpY2F0aW9uIjoiZ3VhcmQtcmVmdXNlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOm51bGx9"
  },
  {
    "name": "constructor-pair",
    "accept": true,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJib290c3RyYXAiLCJzdGFnZSI6InN0YXJ0dXAiLCJzaXRlIjoic2V0dXAtYWRtaXNzaW9uIiwiY2xhc3NpZmljYXRpb24iOiJndWFyZC1yZWZ1c2VkIiwiY29kZSI6IlVuYXZhaWxhYmxlIiwiY2xlYW51cENvZGUiOm51bGwsInJlY29yZGVkQXQiOiIyMDI2LTEwLTA0VDA4OjAwOjAwLjAwMFoiLCJhZG1pc3Npb25DaGVjayI6Indvcmtlci1kZXNrdG9wIiwiYWRtaXNzaW9uR3VhcmQiOiJkZXNrdG9wLWlucHV0IiwicmVhZENvbnRleHQiOm51bGx9"
  },
  {
    "name": "context-root-guard",
    "accept": true,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOiJyb290LWd1YXJkIn0="
  },
  {
    "name": "context-root-proof",
    "accept": true,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOiJyb290LXByb29mIn0="
  },
  {
    "name": "context-root-identity",
    "accept": true,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOiJyb290LWlkZW50aXR5In0="
  },
  {
    "name": "context-walk-node-guard",
    "accept": true,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOiJ3YWxrLW5vZGUtZ3VhcmQifQ=="
  },
  {
    "name": "context-walk-node-identity",
    "accept": true,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOiJ3YWxrLW5vZGUtaWRlbnRpdHkifQ=="
  },
  {
    "name": "context-walk-child-guard",
    "accept": true,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOiJ3YWxrLWNoaWxkLWd1YXJkIn0="
  },
  {
    "name": "context-walk-child-identity",
    "accept": true,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOiJ3YWxrLWNoaWxkLWlkZW50aXR5In0="
  },
  {
    "name": "context-walk-cross-root-left",
    "accept": true,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOiJ3YWxrLWNyb3NzLXJvb3QtbGVmdCJ9"
  },
  {
    "name": "context-walk-cross-root-right",
    "accept": true,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOiJ3YWxrLWNyb3NzLXJvb3QtcmlnaHQifQ=="
  },
  {
    "name": "context-walk-parent-left",
    "accept": true,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOiJ3YWxrLXBhcmVudC1sZWZ0In0="
  },
  {
    "name": "context-walk-parent-right",
    "accept": true,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOiJ3YWxrLXBhcmVudC1yaWdodCJ9"
  },
  {
    "name": "context-fence-root-guard",
    "accept": true,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOiJmZW5jZS1yb290LWd1YXJkIn0="
  },
  {
    "name": "context-fence-root-proof",
    "accept": true,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOiJmZW5jZS1yb290LXByb29mIn0="
  },
  {
    "name": "context-fence-root-left",
    "accept": true,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOiJmZW5jZS1yb290LWxlZnQifQ=="
  },
  {
    "name": "context-fence-root-right",
    "accept": true,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOiJmZW5jZS1yb290LXJpZ2h0In0="
  },
  {
    "name": "context-target-guard",
    "accept": true,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOiJ0YXJnZXQtZ3VhcmQifQ=="
  },
  {
    "name": "context-target-identity",
    "accept": true,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOiJ0YXJnZXQtaWRlbnRpdHkifQ=="
  },
  {
    "name": "context-container-guard",
    "accept": true,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOiJjb250YWluZXItZ3VhcmQifQ=="
  },
  {
    "name": "context-container-identity",
    "accept": true,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOiJjb250YWluZXItaWRlbnRpdHkifQ=="
  },
  {
    "name": "context-target-chain-left",
    "accept": true,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOiJ0YXJnZXQtY2hhaW4tbGVmdCJ9"
  },
  {
    "name": "context-target-chain-right",
    "accept": true,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOiJ0YXJnZXQtY2hhaW4tcmlnaHQifQ=="
  },
  {
    "name": "context-target-chain-parent",
    "accept": true,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOiJ0YXJnZXQtY2hhaW4tcGFyZW50In0="
  },
  {
    "name": "context-container-chain-left",
    "accept": true,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOiJjb250YWluZXItY2hhaW4tbGVmdCJ9"
  },
  {
    "name": "context-container-chain-right",
    "accept": true,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOiJjb250YWluZXItY2hhaW4tcmlnaHQifQ=="
  },
  {
    "name": "context-container-chain-parent",
    "accept": true,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOiJjb250YWluZXItY2hhaW4tcGFyZW50In0="
  },
  {
    "name": "context-selection-container-guard",
    "accept": true,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOiJzZWxlY3Rpb24tY29udGFpbmVyLWd1YXJkIn0="
  },
  {
    "name": "context-selection-container-left",
    "accept": true,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOiJzZWxlY3Rpb24tY29udGFpbmVyLWxlZnQifQ=="
  },
  {
    "name": "context-selection-container-right",
    "accept": true,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOiJzZWxlY3Rpb24tY29udGFpbmVyLXJpZ2h0In0="
  },
  {
    "name": "impossible-case-walk-cross-root-left",
    "accept": false,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJpbml0aWFsIiwic3RhZ2UiOiJzZXR1cCIsInNpdGUiOiJ3aW5kb3ctaGFuZGxlIiwiY2xhc3NpZmljYXRpb24iOiJub3Qtc3VwcG9ydGVkIiwiY29kZSI6IkludmFsaWRPYnNlcnZhdGlvbiIsImNsZWFudXBDb2RlIjpudWxsLCJyZWNvcmRlZEF0IjoiMjAyNi0xMC0wNFQwODowMDowMC4wMDBaIiwiYWRtaXNzaW9uQ2hlY2siOm51bGwsImFkbWlzc2lvbkd1YXJkIjpudWxsLCJyZWFkQ29udGV4dCI6IndhbGstY3Jvc3Mtcm9vdC1sZWZ0In0="
  },
  {
    "name": "impossible-case-walk-cross-root-right",
    "accept": false,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJpbml0aWFsIiwic3RhZ2UiOiJzZXR1cCIsInNpdGUiOiJ3aW5kb3ctaGFuZGxlIiwiY2xhc3NpZmljYXRpb24iOiJub3Qtc3VwcG9ydGVkIiwiY29kZSI6IkludmFsaWRPYnNlcnZhdGlvbiIsImNsZWFudXBDb2RlIjpudWxsLCJyZWNvcmRlZEF0IjoiMjAyNi0xMC0wNFQwODowMDowMC4wMDBaIiwiYWRtaXNzaW9uQ2hlY2siOm51bGwsImFkbWlzc2lvbkd1YXJkIjpudWxsLCJyZWFkQ29udGV4dCI6IndhbGstY3Jvc3Mtcm9vdC1yaWdodCJ9"
  },
  {
    "name": "impossible-case-container-guard",
    "accept": false,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJpbml0aWFsIiwic3RhZ2UiOiJzZXR1cCIsInNpdGUiOiJ3aW5kb3ctaGFuZGxlIiwiY2xhc3NpZmljYXRpb24iOiJub3Qtc3VwcG9ydGVkIiwiY29kZSI6IkludmFsaWRPYnNlcnZhdGlvbiIsImNsZWFudXBDb2RlIjpudWxsLCJyZWNvcmRlZEF0IjoiMjAyNi0xMC0wNFQwODowMDowMC4wMDBaIiwiYWRtaXNzaW9uQ2hlY2siOm51bGwsImFkbWlzc2lvbkd1YXJkIjpudWxsLCJyZWFkQ29udGV4dCI6ImNvbnRhaW5lci1ndWFyZCJ9"
  },
  {
    "name": "impossible-case-container-identity",
    "accept": false,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJpbml0aWFsIiwic3RhZ2UiOiJzZXR1cCIsInNpdGUiOiJ3aW5kb3ctaGFuZGxlIiwiY2xhc3NpZmljYXRpb24iOiJub3Qtc3VwcG9ydGVkIiwiY29kZSI6IkludmFsaWRPYnNlcnZhdGlvbiIsImNsZWFudXBDb2RlIjpudWxsLCJyZWNvcmRlZEF0IjoiMjAyNi0xMC0wNFQwODowMDowMC4wMDBaIiwiYWRtaXNzaW9uQ2hlY2siOm51bGwsImFkbWlzc2lvbkd1YXJkIjpudWxsLCJyZWFkQ29udGV4dCI6ImNvbnRhaW5lci1pZGVudGl0eSJ9"
  },
  {
    "name": "impossible-case-container-chain-left",
    "accept": false,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJpbml0aWFsIiwic3RhZ2UiOiJzZXR1cCIsInNpdGUiOiJ3aW5kb3ctaGFuZGxlIiwiY2xhc3NpZmljYXRpb24iOiJub3Qtc3VwcG9ydGVkIiwiY29kZSI6IkludmFsaWRPYnNlcnZhdGlvbiIsImNsZWFudXBDb2RlIjpudWxsLCJyZWNvcmRlZEF0IjoiMjAyNi0xMC0wNFQwODowMDowMC4wMDBaIiwiYWRtaXNzaW9uQ2hlY2siOm51bGwsImFkbWlzc2lvbkd1YXJkIjpudWxsLCJyZWFkQ29udGV4dCI6ImNvbnRhaW5lci1jaGFpbi1sZWZ0In0="
  },
  {
    "name": "impossible-case-container-chain-right",
    "accept": false,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJpbml0aWFsIiwic3RhZ2UiOiJzZXR1cCIsInNpdGUiOiJ3aW5kb3ctaGFuZGxlIiwiY2xhc3NpZmljYXRpb24iOiJub3Qtc3VwcG9ydGVkIiwiY29kZSI6IkludmFsaWRPYnNlcnZhdGlvbiIsImNsZWFudXBDb2RlIjpudWxsLCJyZWNvcmRlZEF0IjoiMjAyNi0xMC0wNFQwODowMDowMC4wMDBaIiwiYWRtaXNzaW9uQ2hlY2siOm51bGwsImFkbWlzc2lvbkd1YXJkIjpudWxsLCJyZWFkQ29udGV4dCI6ImNvbnRhaW5lci1jaGFpbi1yaWdodCJ9"
  },
  {
    "name": "impossible-case-container-chain-parent",
    "accept": false,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJpbml0aWFsIiwic3RhZ2UiOiJzZXR1cCIsInNpdGUiOiJ3aW5kb3ctaGFuZGxlIiwiY2xhc3NpZmljYXRpb24iOiJub3Qtc3VwcG9ydGVkIiwiY29kZSI6IkludmFsaWRPYnNlcnZhdGlvbiIsImNsZWFudXBDb2RlIjpudWxsLCJyZWNvcmRlZEF0IjoiMjAyNi0xMC0wNFQwODowMDowMC4wMDBaIiwiYWRtaXNzaW9uQ2hlY2siOm51bGwsImFkbWlzc2lvbkd1YXJkIjpudWxsLCJyZWFkQ29udGV4dCI6ImNvbnRhaW5lci1jaGFpbi1wYXJlbnQifQ=="
  },
  {
    "name": "impossible-case-selection-container-guard",
    "accept": false,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJpbml0aWFsIiwic3RhZ2UiOiJzZXR1cCIsInNpdGUiOiJ3aW5kb3ctaGFuZGxlIiwiY2xhc3NpZmljYXRpb24iOiJub3Qtc3VwcG9ydGVkIiwiY29kZSI6IkludmFsaWRPYnNlcnZhdGlvbiIsImNsZWFudXBDb2RlIjpudWxsLCJyZWNvcmRlZEF0IjoiMjAyNi0xMC0wNFQwODowMDowMC4wMDBaIiwiYWRtaXNzaW9uQ2hlY2siOm51bGwsImFkbWlzc2lvbkd1YXJkIjpudWxsLCJyZWFkQ29udGV4dCI6InNlbGVjdGlvbi1jb250YWluZXItZ3VhcmQifQ=="
  },
  {
    "name": "impossible-case-selection-container-left",
    "accept": false,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJpbml0aWFsIiwic3RhZ2UiOiJzZXR1cCIsInNpdGUiOiJ3aW5kb3ctaGFuZGxlIiwiY2xhc3NpZmljYXRpb24iOiJub3Qtc3VwcG9ydGVkIiwiY29kZSI6IkludmFsaWRPYnNlcnZhdGlvbiIsImNsZWFudXBDb2RlIjpudWxsLCJyZWNvcmRlZEF0IjoiMjAyNi0xMC0wNFQwODowMDowMC4wMDBaIiwiYWRtaXNzaW9uQ2hlY2siOm51bGwsImFkbWlzc2lvbkd1YXJkIjpudWxsLCJyZWFkQ29udGV4dCI6InNlbGVjdGlvbi1jb250YWluZXItbGVmdCJ9"
  },
  {
    "name": "impossible-case-selection-container-right",
    "accept": false,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJpbml0aWFsIiwic3RhZ2UiOiJzZXR1cCIsInNpdGUiOiJ3aW5kb3ctaGFuZGxlIiwiY2xhc3NpZmljYXRpb24iOiJub3Qtc3VwcG9ydGVkIiwiY29kZSI6IkludmFsaWRPYnNlcnZhdGlvbiIsImNsZWFudXBDb2RlIjpudWxsLCJyZWNvcmRlZEF0IjoiMjAyNi0xMC0wNFQwODowMDowMC4wMDBaIiwiYWRtaXNzaW9uQ2hlY2siOm51bGwsImFkbWlzc2lvbkd1YXJkIjpudWxsLCJyZWFkQ29udGV4dCI6InNlbGVjdGlvbi1jb250YWluZXItcmlnaHQifQ=="
  },
  {
    "name": "missing-context",
    "accept": false,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbH0="
  },
  {
    "name": "invalid-context-null",
    "accept": false,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOm51bGx9"
  },
  {
    "name": "invalid-context-\"unknown\"",
    "accept": false,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOiJ1bmtub3duIn0="
  },
  {
    "name": "invalid-context-0",
    "accept": false,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOjB9"
  },
  {
    "name": "invalid-context-false",
    "accept": false,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOmZhbHNlfQ=="
  },
  {
    "name": "invalid-context-{}",
    "accept": false,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOnt9fQ=="
  },
  {
    "name": "invalid-context-[]",
    "accept": false,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOltdfQ=="
  },
  {
    "name": "context-nonwindow",
    "accept": false,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoicHJvY2Vzcy1pZCIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOiJyb290LWd1YXJkIn0="
  },
  {
    "name": "context-stage-startup",
    "accept": false,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic3RhcnR1cCIsInNpdGUiOiJ3aW5kb3ctaGFuZGxlIiwiY2xhc3NpZmljYXRpb24iOiJub3Qtc3VwcG9ydGVkIiwiY29kZSI6IkludmFsaWRPYnNlcnZhdGlvbiIsImNsZWFudXBDb2RlIjpudWxsLCJyZWNvcmRlZEF0IjoiMjAyNi0xMC0wNFQwODowMDowMC4wMDBaIiwiYWRtaXNzaW9uQ2hlY2siOm51bGwsImFkbWlzc2lvbkd1YXJkIjpudWxsLCJyZWFkQ29udGV4dCI6InJvb3QtZ3VhcmQifQ=="
  },
  {
    "name": "context-stage-capture",
    "accept": false,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoiY2FwdHVyZSIsInNpdGUiOiJ3aW5kb3ctaGFuZGxlIiwiY2xhc3NpZmljYXRpb24iOiJub3Qtc3VwcG9ydGVkIiwiY29kZSI6IkludmFsaWRPYnNlcnZhdGlvbiIsImNsZWFudXBDb2RlIjpudWxsLCJyZWNvcmRlZEF0IjoiMjAyNi0xMC0wNFQwODowMDowMC4wMDBaIiwiYWRtaXNzaW9uQ2hlY2siOm51bGwsImFkbWlzc2lvbkd1YXJkIjpudWxsLCJyZWFkQ29udGV4dCI6InJvb3QtZ3VhcmQifQ=="
  },
  {
    "name": "context-stage-publication",
    "accept": false,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoicHVibGljYXRpb24iLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOiJyb290LWd1YXJkIn0="
  },
  {
    "name": "context-stage-report",
    "accept": false,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoicmVwb3J0Iiwic2l0ZSI6IndpbmRvdy1oYW5kbGUiLCJjbGFzc2lmaWNhdGlvbiI6Im5vdC1zdXBwb3J0ZWQiLCJjb2RlIjoiSW52YWxpZE9ic2VydmF0aW9uIiwiY2xlYW51cENvZGUiOm51bGwsInJlY29yZGVkQXQiOiIyMDI2LTEwLTA0VDA4OjAwOjAwLjAwMFoiLCJhZG1pc3Npb25DaGVjayI6bnVsbCwiYWRtaXNzaW9uR3VhcmQiOm51bGwsInJlYWRDb250ZXh0Ijoicm9vdC1ndWFyZCJ9"
  },
  {
    "name": "context-stage-cleanup",
    "accept": false,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoiY2xlYW51cCIsInNpdGUiOiJ3aW5kb3ctaGFuZGxlIiwiY2xhc3NpZmljYXRpb24iOiJub3Qtc3VwcG9ydGVkIiwiY29kZSI6IkludmFsaWRPYnNlcnZhdGlvbiIsImNsZWFudXBDb2RlIjpudWxsLCJyZWNvcmRlZEF0IjoiMjAyNi0xMC0wNFQwODowMDowMC4wMDBaIiwiYWRtaXNzaW9uQ2hlY2siOm51bGwsImFkbWlzc2lvbkd1YXJkIjpudWxsLCJyZWFkQ29udGV4dCI6InJvb3QtZ3VhcmQifQ=="
  },
  {
    "name": "context-stage-output",
    "accept": false,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoib3V0cHV0Iiwic2l0ZSI6IndpbmRvdy1oYW5kbGUiLCJjbGFzc2lmaWNhdGlvbiI6Im5vdC1zdXBwb3J0ZWQiLCJjb2RlIjoiSW52YWxpZE9ic2VydmF0aW9uIiwiY2xlYW51cENvZGUiOm51bGwsInJlY29yZGVkQXQiOiIyMDI2LTEwLTA0VDA4OjAwOjAwLjAwMFoiLCJhZG1pc3Npb25DaGVjayI6bnVsbCwiYWRtaXNzaW9uR3VhcmQiOm51bGwsInJlYWRDb250ZXh0Ijoicm9vdC1ndWFyZCJ9"
  },
  {
    "name": "context-bootstrap",
    "accept": false,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJib290c3RyYXAiLCJzdGFnZSI6InNldHVwIiwic2l0ZSI6IndpbmRvdy1oYW5kbGUiLCJjbGFzc2lmaWNhdGlvbiI6Im5vdC1zdXBwb3J0ZWQiLCJjb2RlIjoiSW52YWxpZE9ic2VydmF0aW9uIiwiY2xlYW51cENvZGUiOm51bGwsInJlY29yZGVkQXQiOiIyMDI2LTEwLTA0VDA4OjAwOjAwLjAwMFoiLCJhZG1pc3Npb25DaGVjayI6bnVsbCwiYWRtaXNzaW9uR3VhcmQiOm51bGwsInJlYWRDb250ZXh0Ijoicm9vdC1ndWFyZCJ9"
  },
  {
    "name": "context-admission",
    "accept": false,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjoid29ya2VyLWRlc2t0b3AiLCJhZG1pc3Npb25HdWFyZCI6ImRlc2t0b3AtaW5wdXQiLCJyZWFkQ29udGV4dCI6InJvb3QtZ3VhcmQifQ=="
  },
  {
    "name": "escaped-valid-key-label",
    "accept": true,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRcdTAwNjV4dCI6InJvb3QtXHUwMDY3dWFyZCJ9"
  },
  {
    "name": "duplicate-key",
    "accept": false,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOiJyb290LWd1YXJkIiwicmVhZENvbnRleHQiOiJyb290LXByb29mIn0="
  },
  {
    "name": "escaped-duplicate-key",
    "accept": false,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOiJyb290LWd1YXJkIiwicmVhZENvbnRcdTAwNjV4dCI6InJvb3QtcHJvb2YifQ=="
  },
  {
    "name": "extra-field-tokens34",
    "accept": false,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOiJyb290LWd1YXJkIiwiZXh0cmEiOm51bGx9"
  },
  {
    "name": "nested-depth",
    "accept": false,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOnsidmFsdWUiOiJyb290LWd1YXJkIn19"
  },
  {
    "name": "string128-unknown",
    "accept": false,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOiJ4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eCJ9"
  },
  {
    "name": "string129-overcap",
    "accept": false,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOiJ4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHgifQ=="
  },
  {
    "name": "bad-utf8",
    "accept": false,
    "base64": "wK8="
  },
  {
    "name": "bom",
    "accept": false,
    "base64": "77u/eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOiJyb290LWd1YXJkIn0="
  },
  {
    "name": "escaped-surrogate",
    "accept": false,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOiJcdWQ4MDAifQ=="
  },
  {
    "name": "invalid-calendar",
    "accept": false,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMDItMzBUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOiJyb290LWd1YXJkIn0="
  },
  {
    "name": "wrong-pin",
    "accept": false,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOiJyb290LWd1YXJkIn0="
  },
  {
    "name": "exact4096",
    "accept": true,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOiJyb290LWd1YXJkIn0gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIA=="
  },
  {
    "name": "over4097",
    "accept": false,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtY3R4MS1mYWlsdXJlIiwic291cmNlRGlnZXN0Ijoic2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTEiLCJjb2xsZWN0b3JCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImZpeHR1cmVCaW5hcnlEaWdlc3QiOiJzaGEyNTY6MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMyIsImNhc2UiOiJjb21ibyIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjoid2luZG93LWhhbmRsZSIsImNsYXNzaWZpY2F0aW9uIjoibm90LXN1cHBvcnRlZCIsImNvZGUiOiJJbnZhbGlkT2JzZXJ2YXRpb24iLCJjbGVhbnVwQ29kZSI6bnVsbCwicmVjb3JkZWRBdCI6IjIwMjYtMTAtMDRUMDg6MDA6MDAuMDAwWiIsImFkbWlzc2lvbkNoZWNrIjpudWxsLCJhZG1pc3Npb25HdWFyZCI6bnVsbCwicmVhZENvbnRleHQiOiJyb290LWd1YXJkIn0gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA="
  },
  {
    "name": "legacy-d1",
    "accept": false,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtZmFpbHVyZSIsInNvdXJjZURpZ2VzdCI6InNoYTI1NjoxMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExIiwiY29sbGVjdG9yQmluYXJ5RGlnZXN0Ijoic2hhMjU2OjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIiLCJmaXh0dXJlQmluYXJ5RGlnZXN0Ijoic2hhMjU2OjMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMiLCJjYXNlIjoiaW5pdGlhbCIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjpudWxsLCJjbGFzc2lmaWNhdGlvbiI6Imd1YXJkLXJlZnVzZWQiLCJjb2RlIjoiSW52YWxpZE9ic2VydmF0aW9uIiwiY2xlYW51cENvZGUiOm51bGwsInJlY29yZGVkQXQiOiIyMDI2LTEwLTA0VDA4OjAwOjAwLjAwMFoifQ=="
  },
  {
    "name": "legacy-d2",
    "accept": false,
    "base64": "eyJzY2hlbWFWZXJzaW9uIjoiMC4xIiwia2luZCI6InA0LjMtbmF0aXZlLWNhcHR1cmUtc3VpdGUtZDItZmFpbHVyZSIsInNvdXJjZURpZ2VzdCI6InNoYTI1NjoxMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExIiwiY29sbGVjdG9yQmluYXJ5RGlnZXN0Ijoic2hhMjU2OjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIiLCJmaXh0dXJlQmluYXJ5RGlnZXN0Ijoic2hhMjU2OjMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMiLCJjYXNlIjoiaW5pdGlhbCIsInN0YWdlIjoic2V0dXAiLCJzaXRlIjpudWxsLCJjbGFzc2lmaWNhdGlvbiI6Imd1YXJkLXJlZnVzZWQiLCJjb2RlIjoiSW52YWxpZE9ic2VydmF0aW9uIiwiY2xlYW51cENvZGUiOm51bGwsInJlY29yZGVkQXQiOiIyMDI2LTEwLTA0VDA4OjAwOjAwLjAwMFoiLCJhZG1pc3Npb25DaGVjayI6bnVsbCwiYWRtaXNzaW9uR3VhcmQiOm51bGx9"
  }
]
// CTX1_CORPUS_END
;

describe("P4.3 CTX1 shared original-byte contract and source contexts", () => {
  it("retains the fixed corpus count, unique names, canonical base64 and bounded bytes", () => {
    expect(sharedCorpus).toHaveLength(72);
    expect(new Set(sharedCorpus.map(row => row.name)).size).toBe(sharedCorpus.length);
    for (const row of sharedCorpus) {
      const original = Buffer.from(row.base64, "base64");
      expect(original.length).toBeLessThanOrEqual(4097);
      expect(original.toString("base64")).toBe(row.base64);
    }
  });
  it.each(sharedCorpus)("consumes original shared bytes: $name", row => {
    const original = Buffer.from(row.base64, "base64");
    if (row.accept) expect(parseNativeSuiteFailure(original, pins).kind).toBe("p4.3-native-capture-suite-ctx1-failure");
    else expect(() => parseNativeSuiteFailure(original, pins)).toThrow(refused);
  });
  it("closes the exact28 context names", () => {
    expect(WINDOW_HANDLE_READ_CONTEXTS).toEqual(["root-guard","root-proof","root-identity","walk-node-guard","walk-node-identity","walk-child-guard","walk-child-identity","walk-cross-root-left","walk-cross-root-right","walk-parent-left","walk-parent-right","fence-root-guard","fence-root-proof","fence-root-left","fence-root-right","target-guard","target-identity","container-guard","container-identity","target-chain-left","target-chain-right","target-chain-parent","container-chain-left","container-chain-right","container-chain-parent","selection-container-guard","selection-container-left","selection-container-right"]);
    expect(Object.isFrozen(WINDOW_HANDLE_READ_CONTEXTS)).toBe(true);
  });
  it.each(WINDOW_HANDLE_READ_CONTEXTS)("enforces every fixed case for %s", readContext => {
    const container = readContext.startsWith("container-") || readContext.startsWith("selection-container-");
    const crossRoot = readContext.startsWith("walk-cross-root-");
    for (const caseId of ["bootstrap", ...FAILURE_CASES]) {
      const input = { ...record(), case: caseId, site: "window-handle", readContext };
      const allowed = caseId !== "bootstrap" && (!container || ["selection", "tab", "combo"].includes(caseId)) &&
        (!crossRoot || ["combo", "modal-cancel", "modal-confirm"].includes(caseId));
      if (allowed) expect(parse(input)).toEqual(input);
      else expect(() => parse(input)).toThrow(refused);
    }
    for (const stage of Object.keys(FAILURE_STAGE_SITES).filter(value => value !== "setup"))
      expect(() => parse({ ...record(), case: "combo", stage, site: "window-handle", readContext })).toThrow(refused);
    for (const site of [null, ...FAILURE_PROPERTY_SITES.filter(value => value !== "window-handle")])
      expect(() => parse({ ...record(), case: "combo", site, readContext })).toThrow(refused);
  });
  it("requires null context outside window property and rejects legacy formats both ways", () => {
    const input = record();
    expect(() => parse({ ...input, site: "window-handle" })).toThrow(refused);
    expect(() => parseLegacyD1(bytes(input), pins)).toThrow("native_suite_failure_refused");
    expect(() => parseLegacyD2(bytes(input), pins)).toThrow("native_suite_failure_refused");
    for (const row of sharedCorpus.filter(value => value.name.startsWith("legacy-")))
      expect(() => parseNativeSuiteFailure(Buffer.from(row.base64, "base64"), pins)).toThrow(refused);
  });
  it("retains all forty constructor pairs only in their three original locations", () => {
    const token = ["token-open", "token-elevation-uiaccess", "token-buffer-bound", "token-buffer-result",
      "token-integer-shape", "token-sid-size", "token-sid-pointer", "token-sid-body"];
    const desktop = ["name-query", "desktop-name-or-null", "desktop-input"];
    const pairs: Record<string, string[]> = { "subject-token": token, "worker-token": token, "current-subject-token": token,
      "process-liveness": ["liveness"], "token-context": ["identity-session"], "session-active": ["session-query-state"],
      "window-station": ["name-query", "name-value"], "worker-desktop": desktop, "input-desktop-open": ["input-open"],
      "input-desktop": desktop, "anchored-main": ["window-boundary"], "main-desktop": desktop };
    expect(Object.values(pairs).flat()).toHaveLength(40);
    for (const [admissionCheck, guards] of Object.entries(pairs)) for (const admissionGuard of guards)
      for (const [caseId, stage] of [["bootstrap", "startup"], ["process-restart", "startup"], ["window-replacement", "setup"]]) {
        const input = { ...record(), case: caseId, stage, site: "setup-admission", code: "Unavailable", admissionCheck, admissionGuard };
        expect(parse(input)).toEqual(input);
        expect(() => parse({ ...input, readContext: "root-guard" })).toThrow(refused);
        expect(() => parse({ ...input, admissionGuard: null })).toThrow(refused);
      }
  });
});
