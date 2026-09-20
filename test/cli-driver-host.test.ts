import { mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  executeNodeTrustedDriver,
  TrustedDriverExecutionError,
} from "../src/cli/driver-host.js";

const cwd = resolve(".");
const fixture = (name: string): string => resolve("fixtures", "cli-drivers", name);
const activeSignal = (): AbortSignal => new AbortController().signal;

describe("P3.5 trusted driver child execution", () => {
  it("loads pinned bytes and returns validated record events without forwarding output", async () => {
    await expect(executeNodeTrustedDriver({
      mode: "record", driver: pathToFileURL(fixture("valid.mjs")).href, timeoutMs: 5_000,
    }, cwd, activeSignal())).resolves.toMatchObject({
      mode: "record",
      driverId: "fixture-driver",
      auditEvents: [{ event: "surface_observed", outcome: "observed" }],
    });
  });

  it("uses a fresh child for every evaluation case", async () => {
    const first = await executeNodeTrustedDriver({
      mode: "evaluate", driver: fixture("valid.mjs"), timeoutMs: 5_000,
      caseId: "case-1", input: { value: 1 },
    }, cwd, activeSignal());
    const second = await executeNodeTrustedDriver({
      mode: "evaluate", driver: fixture("valid.mjs"), timeoutMs: 5_000,
      caseId: "case-2", input: { value: 2 },
    }, cwd, activeSignal());
    expect(first).toMatchObject({ result: { observations: { calls: 1 } } });
    expect(second).toMatchObject({ result: { observations: { calls: 1 } } });
  });

  it.each([
    "relative-import.mjs",
    "malformed-result.mjs",
    "secret-output.mjs",
    "oversized-output.mjs",
    "direct-ipc.mjs",
  ])("fails closed for %s", async (name) => {
    await expect(executeNodeTrustedDriver({
      mode: "evaluate", driver: fixture(name), timeoutMs: 5_000,
      caseId: "case-1", input: null,
    }, cwd, activeSignal())).rejects.toMatchObject({ reason: "driver_error" });
  });

  it("terminates and waits for a timed-out direct child", async () => {
    await expect(executeNodeTrustedDriver({
      mode: "evaluate", driver: fixture("timeout.mjs"), timeoutMs: 50,
      caseId: "case-1", input: null,
    }, cwd, activeSignal())).rejects.toEqual(expect.objectContaining({
      name: "TrustedDriverExecutionError", reason: "cancelled",
    } satisfies Partial<TrustedDriverExecutionError>));
  });

  it("escalates termination when a timed-out driver ignores SIGTERM", async () => {
    const started = Date.now();
    await expect(executeNodeTrustedDriver({
      mode: "evaluate", driver: fixture("ignore-sigterm.mjs"), timeoutMs: 50,
      caseId: "case-1", input: null,
    }, cwd, activeSignal())).rejects.toMatchObject({ reason: "cancelled" });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("terminates and waits for the direct child when cancelled", async () => {
    const controller = new AbortController();
    const execution = executeNodeTrustedDriver({
      mode: "evaluate", driver: fixture("timeout.mjs"), timeoutMs: 5_000,
      caseId: "case-1", input: null,
    }, cwd, controller.signal);
    controller.abort();
    await expect(execution).rejects.toMatchObject({ reason: "cancelled" });
  });

  it.each([
    "relative.mjs",
    "https://example.test/driver.mjs",
    "file://server/share/driver.mjs",
    `${pathToFileURL(fixture("valid.mjs")).href}?query=1`,
    `${pathToFileURL(fixture("valid.mjs")).href}#fragment`,
  ])("rejects unsafe driver location %s", async (driver) => {
    await expect(executeNodeTrustedDriver({
      mode: "record", driver, timeoutMs: 5_000,
    }, cwd, activeSignal())).rejects.toMatchObject({ reason: "driver_error" });
  });

  it("rejects a symlinked driver parent chain", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "dual-surface-driver-"));
    const link = resolve(directory, "linked");
    try {
      await symlink(resolve("fixtures", "cli-drivers"), link, "junction");
    } catch {
      return;
    }
    await expect(executeNodeTrustedDriver({
      mode: "record", driver: resolve(link, "valid.mjs"), timeoutMs: 5_000,
    }, cwd, activeSignal())).rejects.toMatchObject({ reason: "driver_error" });
  });
});
