import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  parent: "",
  parentChecks: 0,
  simulateDrift: false,
}));

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return {
    ...actual,
    lstat: async (...args: Parameters<typeof actual.lstat>) => {
      const info = await actual.lstat(...args);
      if (state.simulateDrift && args[0] === state.parent) {
        state.parentChecks += 1;
        if (state.parentChecks === 2 && typeof info.dev === "bigint") {
          return new Proxy(info, {
            get(target, property, receiver) {
              return property === "dev" ? target.dev + 1n : Reflect.get(target, property, receiver);
            },
          });
        }
      }
      return info;
    },
  };
});

import { createNodeAtomicWriter } from "../src/cli/node-io.js";

const roots: string[] = [];

afterEach(async () => {
  state.parent = "";
  state.parentChecks = 0;
  state.simulateDrift = false;
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("P3.5 Node output commit recheck", () => {
  it("fails closed and cleans its temp when a parent identity changes before commit", async () => {
    const root = await mkdtemp(join(tmpdir(), "dual-surface-cli-recheck-"));
    roots.push(root);
    state.parent = root;
    state.simulateDrift = true;

    await expect(createNodeAtomicWriter(root)({
      path: "result.json",
      bytes: new TextEncoder().encode("safe"),
      force: false,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ kind: "output", message: "Unable to write output." });

    expect(state.parentChecks).toBe(2);
    await expect(readdir(root)).resolves.toEqual([]);
  });
});
