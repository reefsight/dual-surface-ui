import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { FAILURE_CASES, FAILURE_CODES, FAILURE_KEYS, FAILURE_LIMITS, FAILURE_PROPERTY_SITES, FAILURE_STAGE_SITES,
  inspectOwnedNativeSuiteFailure, parseNativeSuiteFailure, readNativeSuiteFailure } from "../scripts/p4.3-native-failure-diagnostics.mjs";
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

async function fixture() {
  const temporaryRoot = await fs.mkdtemp(join(tmpdir(), "p4.3-failure-unit-"));
  temporaryRoots.push(temporaryRoot);
  const directory = join(temporaryRoot, "dual-surface-ui-native-evidence", "p4.3-capture-" + randomUUID().replaceAll("-", ""), "first");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(join(directory, "failure.json"), bytes(record()), { flag: "wx" });
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
  it("admits the actual fixed D1 freeze before any failure-directory observation", async () => {
    vi.mocked(admitNativeSuiteFreeze).mockRejectedValue(new Error("fixed-d1-freeze-refused"));
    const observed = vi.spyOn(fs, "lstat"), opened = vi.spyOn(fs, "open");
    await expect(inspectOwnedNativeSuiteFailure("unit-repo-root", "raw-unadmitted-output")).rejects.toThrow("fixed-d1-freeze-refused");
    expect(admitNativeSuiteFreeze).toHaveBeenCalledWith("unit-repo-root");
    expect(observed).not.toHaveBeenCalled(); expect(opened).not.toHaveBeenCalled();
  });
});
