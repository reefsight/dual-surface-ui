import { describe, expect, it } from "vitest";

import {
  MAX_CLI_ARGUMENTS,
  MAX_CLI_ARGUMENT_CHARACTERS,
  MAX_CLI_ARGUMENT_LENGTH,
  parseAgentCliArgs,
} from "../src/cli/args.js";

describe("CLI argument grammar", () => {
  it("parses inspect and validate with deterministic defaults", () => {
    expect(parseAgentCliArgs(["inspect", "--input", "-"])).toEqual({
      status: "parsed",
      value: {
        command: "inspect",
        input: "-",
        artifactType: "auto",
        format: "json",
      },
    });
    expect(parseAgentCliArgs([
      "validate",
      "--format", "ndjson",
      "--type", "replay-fixture",
      "--input", "fixture.json",
    ])).toEqual({
      status: "parsed",
      value: {
        command: "validate",
        input: "fixture.json",
        artifactType: "replay-fixture",
        format: "ndjson",
      },
    });
  });

  it("parses diff while allowing stdin for exactly one side", () => {
    expect(parseAgentCliArgs([
      "diff", "--target", "target.json", "--base", "-",
    ])).toEqual({
      status: "parsed",
      value: {
        command: "diff",
        base: "-",
        target: "target.json",
        format: "json",
      },
    });
    expect(parseAgentCliArgs([
      "diff", "--base", "-", "--target", "-",
    ])).toEqual({ status: "invalid" });
  });

  it("requires explicit trusted absolute drivers for record and evaluate", () => {
    expect(parseAgentCliArgs([
      "record",
      "--driver", "C:\\drivers\\record.mjs",
      "--trust-driver",
      "--source-id", "ci-source",
      "--output", "trace.json",
      "--force",
    ])).toEqual({
      status: "parsed",
      value: {
        command: "record",
        driver: "C:\\drivers\\record.mjs",
        trustDriver: true,
        sourceId: "ci-source",
        output: "trace.json",
        force: true,
        timeoutMs: 30_000,
        format: "json",
      },
    });
    expect(parseAgentCliArgs([
      "evaluate",
      "--definition", "-",
      "--driver", "file:///C:/drivers/evaluate.mjs",
      "--trust-driver",
      "--timeout-ms", "600000",
      "--format", "ndjson",
    ])).toEqual({
      status: "parsed",
      value: {
        command: "evaluate",
        definition: "-",
        driver: "file:///C:/drivers/evaluate.mjs",
        trustDriver: true,
        timeoutMs: 600_000,
        format: "ndjson",
      },
    });
  });

  it("parses replay without exposing any live-target or driver option", () => {
    expect(parseAgentCliArgs(["replay", "--input", "fixture.json"])).toEqual({
      status: "parsed",
      value: { command: "replay", input: "fixture.json", format: "json" },
    });
    expect(parseAgentCliArgs([
      "replay", "--input", "fixture.json", "--driver", "C:\\driver.mjs",
    ])).toEqual({ status: "invalid" });
  });

  it("recognizes only standalone version and exact help forms", () => {
    expect(parseAgentCliArgs(["--help"])).toEqual({ status: "help" });
    expect(parseAgentCliArgs(["--version"])).toEqual({ status: "version" });
    expect(parseAgentCliArgs(["diff", "--help"])).toEqual({
      status: "help",
      command: "diff",
    });
    expect(parseAgentCliArgs(["inspect", "--help", "--input", "x"])).toEqual({
      status: "invalid",
    });
    expect(parseAgentCliArgs(["inspect", "--version"])).toEqual({ status: "invalid" });
  });

  it.each([
    [],
    ["unknown"],
    ["inspect"],
    ["inspect", "artifact.json"],
    ["inspect", "--input=artifact.json"],
    ["inspect", "--input", "artifact.json", "--input", "other.json"],
    ["inspect", "--input", "artifact.json", "--type", "unknown"],
    ["inspect", "--input", "artifact.json", "--format", "text"],
    ["record", "--driver", "relative.mjs", "--trust-driver", "--source-id", "x", "--output", "out.json"],
    ["record", "--driver", "\\\\server\\share\\driver.mjs", "--trust-driver", "--source-id", "x", "--output", "out.json"],
    ["record", "--driver", "file://server/share/driver.mjs", "--trust-driver", "--source-id", "x", "--output", "out.json"],
    ["record", "--driver", "file:///C:/driver.mjs?x=1", "--trust-driver", "--source-id", "x", "--output", "out.json"],
    ["record", "--driver", "C:\\driver.mjs", "--source-id", "x", "--output", "out.json"],
    ["record", "--driver", "C:\\driver.mjs", "--trust-driver", "--source-id", "bad:id", "--output", "out.json"],
    ["record", "--driver", "C:\\driver.mjs", "--trust-driver", "--source-id", "x", "--output", "-"],
    ["evaluate", "--definition", "suite.json", "--driver", "C:\\driver.mjs"],
    ["evaluate", "--definition", "suite.json", "--driver", "C:\\driver.mjs", "--trust-driver", "--timeout-ms", "0"],
    ["evaluate", "--definition", "suite.json", "--driver", "C:\\driver.mjs", "--trust-driver", "--timeout-ms", "600001"],
    ["evaluate", "--definition", "suite.json", "--driver", "C:\\driver.mjs", "--trust-driver", "--timeout-ms", "1.5"],
  ].map((argv) => ({ argv })))("rejects malformed or unauthorized argv %#", ({ argv }) => {
    expect(parseAgentCliArgs(argv)).toEqual({ status: "invalid" });
  });

  it("returns detached frozen parse results", () => {
    const argv = ["inspect", "--input", "artifact.json"];
    const result = parseAgentCliArgs(argv);
    argv[2] = "changed.json";
    expect(result).toMatchObject({
      status: "parsed",
      value: { input: "artifact.json" },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.status === "parsed" && Object.isFrozen(result.value)).toBe(true);
  });

  it("rejects accessors without invoking them", () => {
    let calls = 0;
    const argv = ["inspect", "--input", "artifact.json"];
    Object.defineProperty(argv, "2", {
      get() {
        calls += 1;
        return "artifact.json";
      },
      enumerable: true,
      configurable: true,
    });
    expect(parseAgentCliArgs(argv)).toEqual({ status: "invalid" });
    expect(calls).toBe(0);
  });

  it("rejects proxies, including revoked and throwing proxies, without throwing", () => {
    const transparent = new Proxy(["inspect", "--input", "artifact.json"], {});
    const throwing = new Proxy(["inspect"], {
      getOwnPropertyDescriptor() {
        throw new Error("must not escape");
      },
    });
    const revoked = Proxy.revocable(["inspect"], {});
    revoked.revoke();

    expect(parseAgentCliArgs(transparent)).toEqual({ status: "invalid" });
    expect(parseAgentCliArgs(throwing)).toEqual({ status: "invalid" });
    expect(parseAgentCliArgs(revoked.proxy)).toEqual({ status: "invalid" });
  });

  it("rejects sparse, symbolic, non-string, and extended argv shapes", () => {
    const sparse = ["inspect", "--input", "artifact.json"];
    delete sparse[1];
    const symbolicValue = ["inspect", Symbol("option")] as unknown as string[];
    const numericValue = ["inspect", "--input", 7] as unknown as string[];
    const symbolicProperty = ["inspect", "--input", "artifact.json"];
    symbolicProperty[Symbol("metadata") as unknown as number] = "untrusted";
    const extended = ["inspect", "--input", "artifact.json"] as string[] & {
      metadata?: string;
    };
    extended.metadata = "untrusted";

    for (const argv of [sparse, symbolicValue, numericValue, symbolicProperty, extended]) {
      expect(parseAgentCliArgs(argv)).toEqual({ status: "invalid" });
    }
  });

  it("rejects argv beyond fixed count and token-length budgets", () => {
    expect(parseAgentCliArgs(Array(MAX_CLI_ARGUMENTS + 1).fill("x"))).toEqual({
      status: "invalid",
    });
    expect(parseAgentCliArgs(["inspect", "--input", "x".repeat(MAX_CLI_ARGUMENT_LENGTH + 1)]))
      .toEqual({ status: "invalid" });
    const boundedToken = "x".repeat(MAX_CLI_ARGUMENT_LENGTH);
    const excessiveCharacters = Array(
      Math.floor(MAX_CLI_ARGUMENT_CHARACTERS / boundedToken.length) + 1,
    ).fill(boundedToken);
    expect(parseAgentCliArgs(excessiveCharacters)).toEqual({ status: "invalid" });
  });
});
