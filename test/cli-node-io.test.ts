import { createHash } from "node:crypto";
import { link, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_NODE_OUTPUT_BYTES,
  NodeIoError,
  captureNodeCwd,
  createNodeAtomicWriter,
  createNodeReadInput,
} from "../src/cli/node-io.js";

const roots: string[] = [];

const workspace = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "dual-surface-cli-io-"));
  roots.push(root);
  return root;
};

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("P3.5 Node input host", () => {
  it("captures cwd and resolves later relative reads against that value", async () => {
    const root = await workspace();
    const other = await workspace();
    await writeFile(join(root, "input.json"), "{\"safe\":true}");
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(root);
    const readInput = createNodeReadInput(captureNodeCwd());
    cwd.mockReturnValue(other);
    try {
      await expect(readInput({ source: { kind: "file", path: "input.json" }, maxBytes: 64 }))
        .resolves.toEqual(new TextEncoder().encode('{"safe":true}'));
    } finally {
      cwd.mockRestore();
    }
  });

  it("bounds file and stdin bytes before returning them", async () => {
    const root = await workspace();
    await writeFile(join(root, "input"), "12345");
    const readFileInput = createNodeReadInput(root);
    await expect(readFileInput({ source: { kind: "file", path: "input" }, maxBytes: 4 }))
      .rejects.toMatchObject({ kind: "input", message: "Unable to read input." });

    const readStdin = createNodeReadInput(root, Readable.from([Buffer.from("12"), Buffer.from("345")]));
    await expect(readStdin({ source: { kind: "stdin" }, maxBytes: 4 }))
      .rejects.toMatchObject({ kind: "input", message: "Unable to read input." });
  });

  it("interrupts a blocked stdin read when the host signal is aborted", async () => {
    const root = await workspace();
    const stdin = new PassThrough();
    const controller = new AbortController();
    const reading = createNodeReadInput(root, stdin, controller.signal)({
      source: { kind: "stdin" },
      maxBytes: 64,
    });
    controller.abort();
    await expect(reading).rejects.toMatchObject({ kind: "cancelled" });
  });

  it("rejects URL, UNC, non-file, and symlink paths without reflecting them", async () => {
    const root = await workspace();
    await mkdir(join(root, "directory"));
    await writeFile(join(root, "real"), "safe");
    if (process.platform !== "win32") {
      await symlink(join(root, "real"), join(root, "alias"), "file");
    }
    const readInput = createNodeReadInput(root);
    const paths = ["https://example.invalid/a", "\\\\server\\share\\a", "directory"];
    if (process.platform !== "win32") paths.push("alias");
    for (const path of paths) {
      try {
        await readInput({ source: { kind: "file", path }, maxBytes: 64 });
        throw new Error("expected rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(NodeIoError);
        expect(String(error)).not.toContain(path);
      }
    }
  });

  it("rejects a symlink in the parent chain", async () => {
    const root = await workspace();
    await mkdir(join(root, "real"));
    await writeFile(join(root, "real", "input"), "safe");
    await symlink(join(root, "real"), join(root, "alias"), process.platform === "win32" ? "junction" : "dir");
    const readInput = createNodeReadInput(root);
    await expect(readInput({ source: { kind: "file", path: "alias/input" }, maxBytes: 64 }))
      .rejects.toMatchObject({ kind: "input" });
  });
});

describe("P3.5 Node atomic output host", () => {
  it("commits with a hard link without clobbering an existing target", async () => {
    const root = await workspace();
    const writeAtomic = createNodeAtomicWriter(root);
    const signal = new AbortController().signal;
    await writeAtomic({ path: "result.json", bytes: new TextEncoder().encode("first"), force: false, signal });
    await expect(readFile(join(root, "result.json"), "utf8")).resolves.toBe("first");
    await expect(writeAtomic({
      path: "result.json",
      bytes: new TextEncoder().encode("second"),
      force: false,
      signal,
    })).rejects.toMatchObject({ kind: "output", message: "Unable to write output." });
    await expect(readFile(join(root, "result.json"), "utf8")).resolves.toBe("first");
    expect((await lstat(root)).isDirectory()).toBe(true);
    await expect((await import("node:fs/promises")).readdir(root)).resolves.toEqual(["result.json"]);
  });

  it("creates the temporary file with mode 0600 and removes its hard-link name", async () => {
    const root = await workspace();
    const writeAtomic = createNodeAtomicWriter(root);
    await writeAtomic({
      path: "secure.json",
      bytes: new TextEncoder().encode("safe"),
      force: false,
      signal: new AbortController().signal,
    });
    const info = await lstat(join(root, "secure.json"));
    if (process.platform !== "win32") expect(info.mode & 0o777).toBe(0o600);
    expect(info.nlink).toBe(1);
  });

  it("allows force for a missing target by retaining atomic no-clobber semantics", async () => {
    const root = await workspace();
    await expect(createNodeAtomicWriter(root)({
      path: "new.json",
      bytes: new TextEncoder().encode("new"),
      force: true,
      signal: new AbortController().signal,
    })).resolves.toBeUndefined();
    await expect(readFile(join(root, "new.json"), "utf8")).resolves.toBe("new");
  });

  it("refuses unsafe targets and symlinked parent chains", async () => {
    const root = await workspace();
    await mkdir(join(root, "real"));
    await symlink(join(root, "real"), join(root, "alias"), process.platform === "win32" ? "junction" : "dir");
    if (process.platform !== "win32") {
      await symlink(join(root, "real", "missing"), join(root, "target-link"), "file");
    }
    const writeAtomic = createNodeAtomicWriter(root);
    const signal = new AbortController().signal;
    await expect(writeAtomic({ path: "alias/out", bytes: new Uint8Array(), force: false, signal }))
      .rejects.toMatchObject({ kind: "output" });
    if (process.platform !== "win32") {
      await expect(writeAtomic({ path: "target-link", bytes: new Uint8Array(), force: true, signal }))
        .rejects.toMatchObject({ kind: "output" });
    }
  });

  it("leaves no final artifact or owned temp when cancelled before commit", async () => {
    const root = await workspace();
    const controller = new AbortController();
    controller.abort();
    await expect(createNodeAtomicWriter(root)({
      path: "cancelled.json",
      bytes: new TextEncoder().encode("not published"),
      force: false,
      signal: controller.signal,
    })).rejects.toMatchObject({ kind: "cancelled", message: "Operation cancelled." });
    await expect((await import("node:fs/promises")).readdir(root)).resolves.toEqual([]);
  });

  it("removes only its owned temporary file when cancellation arrives during staging", async () => {
    const root = await workspace();
    await writeFile(join(root, "unrelated"), "keep");
    const controller = new AbortController();
    const timer = setInterval(() => {
      void readdir(root).then((names) => {
        if (names.some((name) => name.includes("dual-surface-ui"))) controller.abort();
      });
    }, 1);
    try {
      const bytes = new Uint8Array(MAX_NODE_OUTPUT_BYTES);
      bytes.fill(0x61);
      await expect(createNodeAtomicWriter(root)({
        path: "cancelled.bin",
        bytes,
        force: false,
        signal: controller.signal,
      })).rejects.toMatchObject({ kind: "cancelled" });
    } finally {
      clearInterval(timer);
    }
    await expect((await import("node:fs/promises")).readdir(root)).resolves.toEqual(["unrelated"]);
    await expect(readFile(join(root, "unrelated"), "utf8")).resolves.toBe("keep");
  });

  it("treats a completed commit as winning later cancellation", async () => {
    const root = await workspace();
    const controller = new AbortController();
    const bytes = new Uint8Array(MAX_NODE_OUTPUT_BYTES);
    bytes.fill(0x61);
    const writing = createNodeAtomicWriter(root)({
      path: "committed.bin",
      bytes,
      force: false,
      signal: controller.signal,
    });
    await writing;
    controller.abort();
    const actual = await readFile(join(root, "committed.bin"));
    expect(actual.byteLength).toBe(MAX_NODE_OUTPUT_BYTES);
    expect(createHash("sha256").update(actual).digest("hex"))
      .toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  it("replaces atomically only on platforms with supported rename semantics", async () => {
    const root = await workspace();
    const target = join(root, "replace.json");
    await writeFile(target, "old");
    const operation = createNodeAtomicWriter(root)({
      path: "replace.json",
      bytes: new TextEncoder().encode("new"),
      force: true,
      signal: new AbortController().signal,
    });
    if (process.platform === "win32") {
      await expect(operation).rejects.toMatchObject({ kind: "output" });
      await expect(readFile(target, "utf8")).resolves.toBe("old");
    } else {
      await expect(operation).resolves.toBeUndefined();
      await expect(readFile(target, "utf8")).resolves.toBe("new");
    }
  });

  it("never overwrites a protected file or one of its hard-link aliases", async () => {
    const root = await workspace();
    const driver = join(root, "driver.mjs");
    const alias = join(root, "driver-alias.mjs");
    await writeFile(driver, "protected");
    await link(driver, alias);
    const writer = createNodeAtomicWriter(root);
    const common = {
      bytes: new TextEncoder().encode("replacement"),
      force: true,
      signal: new AbortController().signal,
      forbidPaths: [driver],
    } as const;
    await expect(writer({ ...common, path: driver })).rejects.toMatchObject({ kind: "output" });
    await expect(writer({ ...common, path: alias })).rejects.toMatchObject({ kind: "output" });
    await expect(readFile(driver, "utf8")).resolves.toBe("protected");
    await expect(readFile(alias, "utf8")).resolves.toBe("protected");
  });

});
