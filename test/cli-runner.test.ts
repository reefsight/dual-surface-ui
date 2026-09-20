import { describe, expect, it } from "vitest";

import type { AgentSnapshot } from "../src/types.js";
import {
  AGENT_CLI_HELP,
  AgentCliHostError,
  digestAgentEvaluationDefinition,
  runAgentCli,
  type AgentCliHost,
  type AgentCliJson,
  type AgentCliTrustedExecutionRequest,
  type AgentCliTrustedExecutionResult,
  type AgentEvaluationDefinition,
} from "../src/cli/index.js";

const encoder = new TextEncoder();

const snapshot = (revision = "revision-1"): AgentSnapshot => ({
  schemaVersion: "0.1",
  surfaceId: "checkout",
  revision,
  title: "Checkout",
  url: "https://example.test/checkout",
  generatedAt: "2026-09-20T00:00:00.000Z",
  capabilities: ["semantic-actions"],
  nodes: [{
    id: "submit",
    role: "button",
    name: "Submit",
    state: {},
    actions: [{ name: "activate", risk: "write" }],
  }],
});

const jsonBytes = (value: unknown): Uint8Array => encoder.encode(JSON.stringify(value));

async function evaluationDefinition(): Promise<AgentEvaluationDefinition> {
  const unsigned = {
    schemaVersion: "0.1" as const,
    kind: "agent-evaluation-definition" as const,
    suiteId: "suite-1",
    dimensions: ["accuracy"],
    cases: [{
      caseId: "case-1",
      input: { prompt: "safe input" } as AgentCliJson,
      expected: { accuracy: true },
    }],
  };
  return { ...unsigned, definitionDigest: await digestAgentEvaluationDefinition(unsigned) };
}

function mockHost(options: {
  readonly inputs?: Readonly<Record<string, unknown>>;
  readonly execute?: (request: AgentCliTrustedExecutionRequest) => Promise<AgentCliTrustedExecutionResult>;
  readonly writeAtomic?: () => Promise<void>;
  readonly writeStdout?: (line: string) => Promise<void>;
} = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const writes: { path: string; bytes: Uint8Array; force: boolean }[] = [];
  const controller = new AbortController();
  const host: AgentCliHost = {
    cwd: "C:\\workspace",
    signal: controller.signal,
    readInput: async ({ source }) => {
      const key = source.kind === "stdin" ? "-" : source.path;
      if (!Object.hasOwn(options.inputs ?? {}, key)) throw new AgentCliHostError("input_io");
      return jsonBytes(options.inputs![key]);
    },
    writeAtomic: async ({ path, bytes, force }) => {
      writes.push({ path, bytes, force });
      await options.writeAtomic?.();
    },
    executeTrustedDriver: options.execute ?? (async () => {
      throw new Error("unexpected driver call");
    }),
    writeStdout: async (line) => {
      await options.writeStdout?.(line);
      stdout.push(line);
    },
    writeStderr: async (line) => { stderr.push(line); },
  };
  return { controller, host, stderr, stdout, writes };
}

describe("CLI library runner", () => {
  it("emits stable help and version without reading inputs", async () => {
    const first = mockHost();
    await expect(runAgentCli(["--help"], first.host)).resolves.toBe(0);
    expect(first.stdout).toEqual([AGENT_CLI_HELP]);

    const second = mockHost();
    await expect(runAgentCli(["--version"], second.host)).resolves.toBe(0);
    expect(second.stdout).toEqual(["0.1.0\n"]);
  });

  it("orchestrates inspect and semantic validation failures", async () => {
    const inspected = mockHost({ inputs: { "snapshot.json": snapshot() } });
    await expect(runAgentCli([
      "inspect", "--input", "snapshot.json", "--format", "ndjson",
    ], inspected.host)).resolves.toBe(0);
    expect(JSON.parse(inspected.stdout[0]!)).toMatchObject({
      command: "inspect", kind: "agent-cli-event", type: "result",
      data: { status: "completed", data: { artifactType: "snapshot" } },
    });

    const invalid = mockHost({ inputs: { "bad.json": { kind: "unknown" } } });
    await expect(runAgentCli(["validate", "--input", "bad.json"], invalid.host))
      .resolves.toBe(1);
    expect(JSON.parse(invalid.stdout[0]!)).toMatchObject({
      command: "validate", status: "invalid",
      data: { valid: false, reason: "invalid_artifact" },
    });
  });

  it("delegates diff and replay to their package-owned implementations", async () => {
    const diff = mockHost({ inputs: { base: snapshot(), target: snapshot() } });
    await expect(runAgentCli([
      "diff", "--base", "base", "--target", "target",
    ], diff.host)).resolves.toBe(0);
    expect(JSON.parse(diff.stdout[0]!)).toMatchObject({
      command: "diff", status: "no_change", data: {},
    });

    const replay = mockHost({ inputs: { fixture: { kind: "not-a-fixture" } } });
    await expect(runAgentCli(["replay", "--input", "fixture"], replay.host))
      .resolves.toBe(1);
    expect(JSON.parse(replay.stdout[0]!)).toMatchObject({
      command: "replay", status: "rejected",
      data: { status: "rejected" },
    });
  });

  it("revalidates record results and atomically publishes a completed trace", async () => {
    const state = mockHost({
      execute: async () => ({
        mode: "record",
        driverId: "driver-1",
        auditEvents: [{
          schemaVersion: "0.1",
          event: "surface_observed",
          correlationId: "observe-1",
          surfaceId: "checkout",
          revision: "revision-1",
          sequence: 1,
          timestamp: "2026-09-20T00:00:00.000Z",
          durationMs: 0,
          outcome: "observed",
        }],
      }),
    });
    await expect(runAgentCli([
      "record", "--driver", "C:\\drivers\\record.mjs", "--trust-driver",
      "--source-id", "source-1", "--output", "trace.json",
    ], state.host)).resolves.toBe(0);
    expect(state.writes).toHaveLength(1);
    expect(JSON.parse(new TextDecoder().decode(state.writes[0]!.bytes))).toMatchObject({
      kind: "agent-runtime-trace", sourceId: "source-1", recordCount: 1,
    });
    expect(JSON.parse(state.stdout[0]!)).toMatchObject({
      command: "record", status: "complete", data: { outputWritten: true },
    });
  });

  it("reports record completion when cancellation arrives after atomic commit", async () => {
    let state: ReturnType<typeof mockHost>;
    state = mockHost({
      execute: async () => ({
        mode: "record",
        driverId: "driver-1",
        auditEvents: [{
          schemaVersion: "0.1",
          event: "surface_observed",
          correlationId: "observe-1",
          surfaceId: "checkout",
          revision: "revision-1",
          sequence: 1,
          timestamp: "2026-09-20T00:00:00.000Z",
          durationMs: 0,
          outcome: "observed",
        }],
      }),
      writeAtomic: async () => { state.controller.abort(); },
    });
    await expect(runAgentCli([
      "record", "--driver", "C:\\drivers\\record.mjs", "--trust-driver",
      "--source-id", "source-1", "--output", "trace.json",
    ], state.host)).resolves.toBe(0);
    expect(JSON.parse(state.stdout[0]!)).toMatchObject({
      command: "record", status: "complete", data: { outputWritten: true },
    });
    expect(state.stderr).toEqual([]);
  });

  it("scores evaluation cases and emits ordered NDJSON case and summary events", async () => {
    const definition = await evaluationDefinition();
    const state = mockHost({
      inputs: { definition },
      execute: async (request) => {
        if (request.mode !== "evaluate") throw new Error("wrong mode");
        return {
          mode: "evaluate",
          driverId: "driver-1",
          result: { status: "observed", observations: { accuracy: true } },
        };
      },
    });
    await expect(runAgentCli([
      "evaluate", "--definition", "definition", "--driver",
      "C:\\drivers\\evaluate.mjs", "--trust-driver", "--format", "ndjson",
    ], state.host)).resolves.toBe(0);
    expect(state.stdout).toHaveLength(1);
    expect(state.stdout[0]!.trimEnd().split("\n").map((line) => JSON.parse(line))).toMatchObject([
      { command: "evaluate", sequence: 0, type: "case", data: { caseId: "case-1", status: "scored" } },
      { command: "evaluate", sequence: 1, type: "summary", data: { status: "complete", environmentErrors: 0 } },
    ]);
  });

  it.each([
    {
      name: "schema",
      format: "json",
      value: { schemaVersion: "0.1", kind: "agent-evaluation-definition" },
      reason: "invalid_artifact",
    },
    {
      name: "digest",
      format: "ndjson",
      value: async () => ({
        ...await evaluationDefinition(),
        definitionDigest: `sha256:${"0".repeat(64)}`,
      }),
      reason: "digest_mismatch",
    },
    {
      name: "secret",
      format: "json",
      value: async () => {
        const definition = await evaluationDefinition();
        return {
          ...definition,
          cases: [{
            ...definition.cases[0]!,
            input: { prompt: "password=do-not-reflect-123" },
          }],
        };
      },
      reason: "secret_detected",
    },
  ])("emits an exact semantic result for $name-invalid evaluation definitions", async ({
    format, value, reason,
  }) => {
    const definition = typeof value === "function" ? await value() : value;
    const state = mockHost({ inputs: { definition } });
    await expect(runAgentCli([
      "evaluate", "--definition", "definition", "--driver",
      "C:\\drivers\\evaluate.mjs", "--trust-driver", "--format", format,
    ], state.host)).resolves.toBe(1);
    expect(state.stderr).toEqual([]);
    expect(state.stdout).toHaveLength(1);
    const result = JSON.parse(state.stdout[0]!);
    expect(result).toMatchObject(format === "json"
      ? { command: "evaluate", status: "invalid", data: { reason } }
      : {
          command: "evaluate", sequence: 0, type: "result",
          data: { status: "invalid", data: { reason } },
        });
    expect(state.stdout[0]).not.toContain("do-not-reflect");
  });

  it("buffers evaluation NDJSON before one stdout sink write", async () => {
    const definition = await evaluationDefinition();
    let writes = 0;
    const state = mockHost({
      inputs: { definition },
      execute: async () => ({
        mode: "evaluate",
        driverId: "driver-1",
        result: { status: "observed", observations: { accuracy: true } },
      }),
      writeStdout: async () => {
        writes += 1;
        throw new AgentCliHostError("output_io");
      },
    });
    await expect(runAgentCli([
      "evaluate", "--definition", "definition", "--driver",
      "C:\\drivers\\evaluate.mjs", "--trust-driver", "--format", "ndjson",
    ], state.host)).resolves.toBe(4);
    expect(writes).toBe(1);
    expect(state.stdout).toEqual([]);
    expect(JSON.parse(state.stderr[0]!)).toMatchObject({
      command: "evaluate", code: "output_io",
    });
  });

  it("maps usage, input, malformed driver, and cancellation to stable exits", async () => {
    const usage = mockHost();
    await expect(runAgentCli(["unknown"], usage.host)).resolves.toBe(2);
    expect(JSON.parse(usage.stderr[0]!)).toMatchObject({ code: "usage" });

    const input = mockHost();
    await expect(runAgentCli(["inspect", "--input", "missing"], input.host)).resolves.toBe(3);
    expect(JSON.parse(input.stderr[0]!)).toMatchObject({ code: "input_io" });

    const malformed = mockHost({
      execute: async () => ({ mode: "record", driverId: "driver-1", auditEvents: [], extra: true }) as never,
    });
    await expect(runAgentCli([
      "record", "--driver", "C:\\drivers\\record.mjs", "--trust-driver",
      "--source-id", "source-1", "--output", "trace.json",
    ], malformed.host)).resolves.toBe(5);
    expect(JSON.parse(malformed.stderr[0]!)).toMatchObject({ code: "driver_error" });

    const timedOut = mockHost({
      execute: async () => { throw new AgentCliHostError("cancelled"); },
    });
    await expect(runAgentCli([
      "record", "--driver", "C:\\drivers\\record.mjs", "--trust-driver",
      "--source-id", "source-1", "--output", "trace.json",
    ], timedOut.host)).resolves.toBe(6);
    expect(JSON.parse(timedOut.stderr[0]!)).toMatchObject({ code: "cancelled" });

    const cancelled = mockHost({ inputs: { input: snapshot() } });
    cancelled.controller.abort();
    await expect(runAgentCli(["inspect", "--input", "input"], cancelled.host)).resolves.toBe(6);
    expect(JSON.parse(cancelled.stderr[0]!)).toMatchObject({ code: "cancelled" });
  });
});
