import { createAgentSnapshotDelta } from "../delta/index.js";
import {
  descriptorSafeCaptureJson,
  type CanonicalJson,
} from "../delta/canonical.js";
import { containsSecretSentinel } from "../internal/secret-detection.js";
import { replayAgentFixture } from "../replay/index.js";
import { createAgentTraceRecorder } from "../trace/index.js";
import { parseAgentCliArgs, type AgentCliCommand, type AgentCliFormat } from "./args.js";
import {
  AgentCliArtifactError,
  captureAndValidateCliArtifact,
  digestCliArtifact,
  inspectCliArtifact,
} from "./artifacts.js";
import { scoreAgentEvaluation } from "./evaluation.js";
import {
  CliJsonInputError,
  MAX_CLI_INPUT_BYTES,
  parseCliJsonInput,
} from "./json-input.js";
import {
  createAgentCliError,
  serializeAgentCliOutput,
  type AgentCliCommandResult,
  type AgentCliErrorCode,
  type AgentCliEvent,
  type AgentCliResultEnvelope,
  type AgentCliSingleResult,
} from "./output.js";
import type {
  AgentCliExitCode,
  AgentCliHost,
  AgentCliJson,
  AgentCliTrustedExecutionResult,
  AgentEvaluationCaseObservation,
  AgentEvaluationDefinition,
} from "./types.js";
import { AgentCliHostError } from "./types.js";

export const AGENT_CLI_VERSION = "0.1.0";

const COMMAND_USAGE: Readonly<Record<AgentCliCommand, string>> = Object.freeze({
  inspect: "dual-surface-ui inspect --input <path|-> [--type <type>] [--format json|ndjson]",
  validate: "dual-surface-ui validate --input <path|-> [--type <type>] [--format json|ndjson]",
  diff: "dual-surface-ui diff --base <path|-> --target <path|-> [--format json|ndjson]",
  record: "dual-surface-ui record --driver <absolute-path|file-url> --trust-driver --source-id <id> --output <path> [--force] [--timeout-ms <ms>] [--format json|ndjson]",
  replay: "dual-surface-ui replay --input <path|-> [--format json|ndjson]",
  evaluate: "dual-surface-ui evaluate --definition <path|-> --driver <absolute-path|file-url> --trust-driver [--timeout-ms <ms>] [--format json|ndjson]",
});

export const AGENT_CLI_HELP = `${[
  "Usage:",
  ...Object.values(COMMAND_USAGE).map((line) => `  ${line}`),
  "",
  "Options:",
  "  --help     Show help.",
  "  --version  Show version.",
].join("\n")}\n`;

const helpFor = (command?: AgentCliCommand): string =>
  command === undefined ? AGENT_CLI_HELP : `Usage:\n  ${COMMAND_USAGE[command]}\n`;

const sourceFor = (path: string) => path === "-"
  ? { kind: "stdin" } as const
  : { kind: "file", path } as const;

const envelope = (result: AgentCliCommandResult): AgentCliResultEnvelope => ({
  schemaVersion: "0.1",
  kind: "agent-cli-result",
  ...result,
});

const resultEvent = (result: AgentCliSingleResult): AgentCliEvent => ({
  schemaVersion: "0.1",
  kind: "agent-cli-event",
  command: result.command,
  sequence: 0,
  type: "result",
  data: { status: result.status, data: result.data },
} as AgentCliEvent);

const safePlainText = (value: string): string => {
  if (containsSecretSentinel(value)) throw new TypeError("Unsafe CLI text");
  return value;
};

const emitError = async (
  host: AgentCliHost,
  code: AgentCliErrorCode,
  exitCode: AgentCliExitCode,
  command?: AgentCliCommand,
): Promise<AgentCliExitCode> => {
  try {
    await host.writeStderr(serializeAgentCliOutput(createAgentCliError(code, command)));
    return exitCode;
  } catch {
    return 70;
  }
};

const emitHostError = async (
  host: AgentCliHost,
  error: AgentCliHostError,
  command?: AgentCliCommand,
): Promise<AgentCliExitCode> => {
  switch (error.reason) {
    case "input_io": return emitError(host, "input_io", 3, command);
    case "output_io": return emitError(host, "output_io", 4, command);
    case "driver_error": return emitError(host, "driver_error", 5, command);
    case "cancelled": return emitError(host, "cancelled", 6, command);
  }
};

const emitResult = async (
  host: AgentCliHost,
  format: AgentCliFormat,
  result: AgentCliCommandResult,
  exitCode: AgentCliExitCode,
): Promise<AgentCliExitCode> => {
  const committedRecord = result.command === "record" && result.status === "complete";
  if (host.signal.aborted && !committedRecord) {
    return emitError(host, "cancelled", 6, result.command);
  }
  let serialized: string;
  try {
    const value = format === "json"
      ? envelope(result)
      : result.command === "evaluate" && result.status !== "invalid"
        ? undefined
        : resultEvent(result as AgentCliSingleResult);
    if (value === undefined) throw new TypeError("Evaluation uses ordered events");
    serialized = serializeAgentCliOutput(value);
  } catch {
    return emitError(host, "internal_error", 70, result.command);
  }
  try {
    await host.writeStdout(serialized);
    return exitCode;
  } catch (error) {
    return error instanceof AgentCliHostError
      ? emitHostError(host, error, result.command)
      : emitError(host, "internal_error", 70, result.command);
  }
};

const readJson = async (host: AgentCliHost, path: string): Promise<CanonicalJson> => {
  const bytes = await host.readInput({
    source: sourceFor(path),
    maxBytes: MAX_CLI_INPUT_BYTES,
  });
  return parseCliJsonInput(bytes);
};

const captureTrustedResult = (value: unknown): AgentCliTrustedExecutionResult =>
  descriptorSafeCaptureJson(value, {
    maxDepth: 64,
    maxNodes: 250_000,
    maxCharacters: MAX_CLI_INPUT_BYTES,
    maxStringLength: 32_768,
    maxPropertiesPerObject: 4_096,
  }) as unknown as AgentCliTrustedExecutionResult;

const validIdentifier = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) &&
  !containsSecretSentinel(value);

const exactKeys = (value: object, keys: readonly string[]): boolean => {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
};

const captureRecordExecution = (value: unknown): Extract<AgentCliTrustedExecutionResult, { mode: "record" }> => {
  const captured = captureTrustedResult(value);
  if (
    captured.mode !== "record" || !exactKeys(captured, ["mode", "driverId", "auditEvents"]) ||
    !validIdentifier(captured.driverId) || !Array.isArray(captured.auditEvents)
  ) throw new TypeError("Invalid driver result");
  return captured;
};

const captureEvaluationExecution = (value: unknown): Extract<AgentCliTrustedExecutionResult, { mode: "evaluate" }> => {
  const captured = captureTrustedResult(value);
  if (
    captured.mode !== "evaluate" || !exactKeys(captured, ["mode", "driverId", "result"]) ||
    !validIdentifier(captured.driverId) || typeof captured.result !== "object" ||
    captured.result === null || Array.isArray(captured.result)
  ) throw new TypeError("Invalid driver result");
  if (captured.result.status === "environment_unavailable") {
    if (!exactKeys(captured.result, ["status"])) throw new TypeError("Invalid driver result");
  } else if (
    captured.result.status !== "observed" ||
    !exactKeys(captured.result, ["status", "observations"]) ||
    typeof captured.result.observations !== "object" ||
    captured.result.observations === null || Array.isArray(captured.result.observations)
  ) throw new TypeError("Invalid driver result");
  return captured;
};

const canonicalArtifactBytes = (value: unknown): Uint8Array => {
  const captured = descriptorSafeCaptureJson(value, {
    maxDepth: 64,
    maxNodes: 250_000,
    maxCharacters: MAX_CLI_INPUT_BYTES,
    maxStringLength: 32_768,
    maxPropertiesPerObject: 4_096,
  });
  return new TextEncoder().encode(`${JSON.stringify(captured)}\n`);
};

const cancelled = (host: AgentCliHost): boolean => host.signal.aborted;

/** Orchestrates the pure CLI contract against an explicit trusted host. */
export const runAgentCli = async (
  argv: readonly string[],
  host: AgentCliHost,
): Promise<AgentCliExitCode> => {
  const parsed = parseAgentCliArgs(argv);
  if (parsed.status === "invalid") return emitError(host, "usage", 2);
  if (parsed.status === "help" || parsed.status === "version") {
    let output: string;
    try {
      output = safePlainText(
        parsed.status === "version" ? `${AGENT_CLI_VERSION}\n` : helpFor(parsed.command),
      );
    } catch {
      return emitError(host, "internal_error", 70);
    }
    try {
      await host.writeStdout(output);
      return 0;
    } catch (error) {
      return error instanceof AgentCliHostError
        ? emitHostError(host, error)
        : emitError(host, "internal_error", 70);
    }
  }

  const options = parsed.value;
  if (cancelled(host)) return emitError(host, "cancelled", 6, options.command);

  try {
    if (options.command === "inspect" || options.command === "validate") {
      const value = await readJson(host, options.input);
      try {
        const artifact = await captureAndValidateCliArtifact(value, options.artifactType);
        const digest = await digestCliArtifact(artifact.artifact);
        const result: AgentCliCommandResult = options.command === "inspect"
          ? { command: "inspect", status: "completed", data: await inspectCliArtifact(value, options.artifactType) }
          : { command: "validate", status: "valid", data: { artifactType: artifact.artifactType, valid: true, digest } };
        return emitResult(host, options.format, result, 0);
      } catch (error) {
        if (!(error instanceof AgentCliArtifactError)) throw error;
        const artifactType = error.artifactType === undefined
          ? {}
          : { artifactType: error.artifactType };
        const result: AgentCliCommandResult = options.command === "inspect"
          ? {
              command: "inspect",
              status: "invalid",
              data: { ...artifactType, reason: error.reason },
            }
          : {
              command: "validate",
              status: "invalid",
              data: { ...artifactType, valid: false, reason: error.reason },
            };
        return emitResult(host, options.format, result, 1);
      }
    }

    if (options.command === "diff") {
      const base = await readJson(host, options.base);
      const target = await readJson(host, options.target);
      const diff = await createAgentSnapshotDelta(base, target);
      const result: AgentCliCommandResult = diff.status === "delta"
        ? { command: "diff", status: "delta", data: { delta: diff.delta } }
        : diff.status === "no_change"
          ? { command: "diff", status: "no_change", data: {} }
          : { command: "diff", status: "resync_required", data: { reason: diff.reason } };
      return emitResult(host, options.format, result, diff.status === "resync_required" ? 1 : 0);
    }

    if (options.command === "replay") {
      const fixture = await readJson(host, options.input);
      const replay = await replayAgentFixture(fixture);
      const result = { command: "replay", status: replay.status, data: replay } as AgentCliCommandResult;
      return emitResult(host, options.format, result, replay.status === "matched" ? 0 : 1);
    }

    if (options.command === "record") {
      let rawExecution: AgentCliTrustedExecutionResult;
      try {
        rawExecution = await host.executeTrustedDriver({
          mode: "record", driver: options.driver, timeoutMs: options.timeoutMs,
        });
      } catch (error) {
        return error instanceof AgentCliHostError
          ? emitHostError(host, error, "record")
          : emitError(host, "internal_error", 70, "record");
      }
      let execution: Extract<AgentCliTrustedExecutionResult, { mode: "record" }>;
      try {
        execution = captureRecordExecution(rawExecution);
      } catch {
        return emitError(host, "driver_error", 5, "record");
      }
      const recorder = createAgentTraceRecorder({ sourceId: options.sourceId });
      for (const event of execution.auditEvents) recorder.record(event);
      const finished = await recorder.finish();
      if (finished.status !== "complete") return emitError(host, "driver_error", 5, "record");
      const artifact = await captureAndValidateCliArtifact(finished.trace, "trace");
      const bytes = canonicalArtifactBytes(artifact.artifact);
      try {
        await host.writeAtomic({ path: options.output, bytes, force: options.force, signal: host.signal });
      } catch (error) {
        return error instanceof AgentCliHostError
          ? emitHostError(host, error, "record")
          : emitError(host, "internal_error", 70, "record");
      }
      const trace = artifact.artifactType === "trace" ? artifact.artifact : finished.trace;
      return emitResult(host, options.format, {
        command: "record",
        status: "complete",
        data: {
          artifactType: "trace",
          digest: await digestCliArtifact(trace),
          recordCount: trace.recordCount,
          operationCount: trace.operationCount,
          outputWritten: true,
        },
      }, 0);
    }

    if (options.command !== "evaluate") throw new TypeError("Unknown command");
    const definitionValue = await readJson(host, options.definition);
    let artifact;
    try {
      artifact = await captureAndValidateCliArtifact(definitionValue, "evaluation-definition");
    } catch (error) {
      if (error instanceof AgentCliArtifactError) {
        return emitResult(host, options.format, {
          command: "evaluate",
          status: "invalid",
          data: {
            ...(error.artifactType === undefined
              ? {}
              : { artifactType: error.artifactType }),
            reason: error.reason,
          },
        }, 1);
      }
      throw error;
    }
    if (artifact.artifactType !== "evaluation-definition") throw new TypeError("Invalid definition");
    const definition = artifact.artifact as AgentEvaluationDefinition;
    const observations: AgentEvaluationCaseObservation[] = [];
    let driverId: string | undefined;
    for (const item of definition.cases) {
      if (cancelled(host)) return emitError(host, "cancelled", 6, "evaluate");
      let rawExecution: AgentCliTrustedExecutionResult;
      try {
        rawExecution = await host.executeTrustedDriver({
          mode: "evaluate",
          driver: options.driver,
          timeoutMs: options.timeoutMs,
          caseId: item.caseId,
          input: item.input as AgentCliJson,
        });
      } catch (error) {
        return error instanceof AgentCliHostError
          ? emitHostError(host, error, "evaluate")
          : emitError(host, "internal_error", 70, "evaluate");
      }
      let execution: Extract<AgentCliTrustedExecutionResult, { mode: "evaluate" }>;
      try {
        execution = captureEvaluationExecution(rawExecution);
      } catch {
        return emitError(host, "driver_error", 5, "evaluate");
      }
      if (driverId !== undefined && execution.driverId !== driverId) {
        return emitError(host, "driver_error", 5, "evaluate");
      }
      driverId = execution.driverId;
      observations.push({ caseId: item.caseId, result: execution.result });
    }
    if (driverId === undefined) return emitError(host, "driver_error", 5, "evaluate");
    let scored;
    try {
      scored = await scoreAgentEvaluation(definition, driverId, observations);
    } catch {
      return emitError(host, "driver_error", 5, "evaluate");
    }
    const exit: AgentCliExitCode = scored.status === "incomplete" ? 5 : 0;
    if (options.format === "json") {
      return emitResult(host, "json", {
        command: "evaluate", status: scored.status, data: { result: scored },
      }, exit);
    }
    try {
      const lines: string[] = [];
      for (let index = 0; index < scored.cases.length; index += 1) {
        lines.push(serializeAgentCliOutput({
          schemaVersion: "0.1", kind: "agent-cli-event", command: "evaluate",
          sequence: index, type: "case", data: scored.cases[index]!,
        }));
      }
      const { cases: _cases, ...summary } = scored;
      lines.push(serializeAgentCliOutput({
        schemaVersion: "0.1", kind: "agent-cli-event", command: "evaluate",
        sequence: scored.cases.length, type: "summary", data: summary,
      }));
      if (cancelled(host)) return emitError(host, "cancelled", 6, "evaluate");
      await host.writeStdout(lines.join(""));
      return exit;
    } catch (error) {
      return error instanceof AgentCliHostError
        ? emitHostError(host, error, "evaluate")
        : emitError(host, "internal_error", 70, "evaluate");
    }
  } catch (error) {
    if (error instanceof AgentCliHostError) return emitHostError(host, error, options.command);
    if (error instanceof CliJsonInputError) {
      return emitError(host, "input_io", 3, options.command);
    }
    return emitError(host, "internal_error", 70, options.command);
  }
};
