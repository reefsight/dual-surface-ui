export const AGENT_CLI_COMMANDS = Object.freeze([
  "inspect",
  "validate",
  "diff",
  "record",
  "replay",
  "evaluate",
] as const);

export type AgentCliCommand = (typeof AGENT_CLI_COMMANDS)[number];
export type AgentCliFormat = "json" | "ndjson";
export type AgentCliArtifactTypeOption =
  | "auto"
  | "snapshot"
  | "delta"
  | "trace"
  | "replay-fixture"
  | "evaluation-definition"
  | "evaluation-result";

interface AgentCliCommonOptions {
  readonly format: AgentCliFormat;
}

export type AgentCliParsedCommand =
  | (AgentCliCommonOptions & {
      readonly command: "inspect" | "validate";
      readonly input: string;
      readonly artifactType: AgentCliArtifactTypeOption;
    })
  | (AgentCliCommonOptions & {
      readonly command: "diff";
      readonly base: string;
      readonly target: string;
    })
  | (AgentCliCommonOptions & {
      readonly command: "record";
      readonly driver: string;
      readonly trustDriver: true;
      readonly sourceId: string;
      readonly output: string;
      readonly force: boolean;
      readonly timeoutMs: number;
    })
  | (AgentCliCommonOptions & {
      readonly command: "replay";
      readonly input: string;
    })
  | (AgentCliCommonOptions & {
      readonly command: "evaluate";
      readonly definition: string;
      readonly driver: string;
      readonly trustDriver: true;
      readonly timeoutMs: number;
    });

export type AgentCliArgumentResult =
  | { readonly status: "parsed"; readonly value: AgentCliParsedCommand }
  | { readonly status: "help"; readonly command?: AgentCliCommand }
  | { readonly status: "version" }
  | { readonly status: "invalid" };

const COMMANDS = new Set<string>(AGENT_CLI_COMMANDS);
const FORMATS = new Set<AgentCliFormat>(["json", "ndjson"]);
const ARTIFACT_TYPES = new Set<AgentCliArtifactTypeOption>([
  "auto",
  "snapshot",
  "delta",
  "trace",
  "replay-fixture",
  "evaluation-definition",
  "evaluation-result",
]);
const SOURCE_ID = /^[A-Za-z0-9._~-]{1,128}$/;
const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/](?![\\/])/;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 600_000;
export const MAX_CLI_ARGUMENTS = 64;
export const MAX_CLI_ARGUMENT_LENGTH = 32_768;
export const MAX_CLI_ARGUMENT_CHARACTERS = 131_072;

const invalid = (): AgentCliArgumentResult => Object.freeze({ status: "invalid" });

const captureArgv = (argv: readonly string[]): readonly string[] | undefined => {
  try {
    if (!Array.isArray(argv) || Object.getPrototypeOf(argv) !== Array.prototype) {
      return undefined;
    }
    const descriptors = Object.getOwnPropertyDescriptors(argv) as unknown as Record<
      PropertyKey,
      PropertyDescriptor
    >;
    const ownKeys = Reflect.ownKeys(descriptors);
    if (ownKeys.some((key) => typeof key === "symbol")) return undefined;

    const lengthDescriptor = descriptors.length;
    const lengthValue = lengthDescriptor?.value as unknown;
    if (
      !lengthDescriptor || !("value" in lengthDescriptor) ||
      typeof lengthValue !== "number" ||
      !Number.isSafeInteger(lengthValue) ||
      lengthValue < 0 ||
      lengthValue > MAX_CLI_ARGUMENTS ||
      ownKeys.length !== lengthValue + 1
    ) {
      return undefined;
    }

    const captured: string[] = [];
    let characters = 0;
    for (let index = 0; index < lengthValue; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string") {
        return undefined;
      }
      if (descriptor.value.length > MAX_CLI_ARGUMENT_LENGTH) return undefined;
      characters += descriptor.value.length;
      if (characters > MAX_CLI_ARGUMENT_CHARACTERS) return undefined;
      captured.push(descriptor.value);
    }

    // A transparent Proxy can reproduce ordinary array descriptors. The
    // platform clone algorithm rejects Proxy objects without reading values.
    structuredClone(argv);
    return Object.freeze(captured);
  } catch {
    return undefined;
  }
};

const isCommand = (value: string): value is AgentCliCommand =>
  COMMANDS.has(value);

const isAbsoluteDriverPath = (value: string): boolean => {
  if (value.length === 0 || value.includes("\0")) return false;
  if (value.startsWith("\\\\") || value.startsWith("//")) return false;
  if (value.startsWith("/")) return true;
  if (WINDOWS_ABSOLUTE_PATH.test(value)) return true;
  if (!value.startsWith("file:")) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "file:" &&
      url.username === "" &&
      url.password === "" &&
      url.hostname === "" &&
      url.search === "" &&
      url.hash === "" &&
      url.href === value
    );
  } catch {
    return false;
  }
};

const timeoutValue = (value: string | undefined): number | undefined => {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= MAX_TIMEOUT_MS
    ? parsed
    : undefined;
};

interface ParsedTokens {
  readonly values: ReadonlyMap<string, string>;
  readonly switches: ReadonlySet<string>;
}

const parseTokens = (
  tokens: readonly string[],
  valueOptions: ReadonlySet<string>,
  switchOptions: ReadonlySet<string>,
): ParsedTokens | undefined => {
  const values = new Map<string, string>();
  const switches = new Set<string>();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (!token.startsWith("--") || token.includes("=")) return undefined;
    if (valueOptions.has(token)) {
      if (values.has(token) || switches.has(token)) return undefined;
      const value = tokens[index + 1];
      if (value === undefined || value.length === 0 || value.startsWith("--")) {
        return undefined;
      }
      values.set(token, value);
      index += 1;
      continue;
    }
    if (switchOptions.has(token)) {
      if (values.has(token) || switches.has(token)) return undefined;
      switches.add(token);
      continue;
    }
    return undefined;
  }
  return { values, switches };
};

const formatFrom = (tokens: ParsedTokens): AgentCliFormat | undefined => {
  const value = tokens.values.get("--format") ?? "json";
  return FORMATS.has(value as AgentCliFormat)
    ? value as AgentCliFormat
    : undefined;
};

const hasAtMostOneStdin = (...values: readonly string[]): boolean =>
  values.filter((value) => value === "-").length <= 1;

export const parseAgentCliArgs = (
  argv: readonly string[],
): AgentCliArgumentResult => {
  const captured = captureArgv(argv);
  if (!captured) return invalid();
  if (captured.length === 1 && captured[0] === "--help") {
    return Object.freeze({ status: "help" });
  }
  if (captured.length === 1 && captured[0] === "--version") {
    return Object.freeze({ status: "version" });
  }
  const commandValue = captured[0];
  if (commandValue === undefined || !isCommand(commandValue)) return invalid();
  if (captured.length === 2 && captured[1] === "--help") {
    return Object.freeze({ status: "help", command: commandValue });
  }
  const command = commandValue;
  const args = captured.slice(1);

  if (command === "inspect" || command === "validate") {
    const tokens = parseTokens(
      args,
      new Set(["--input", "--type", "--format"]),
      new Set(),
    );
    if (!tokens || tokens.values.size < 1 || !tokens.values.has("--input")) return invalid();
    const input = tokens.values.get("--input")!;
    const artifactType = tokens.values.get("--type") ?? "auto";
    const format = formatFrom(tokens);
    if (!ARTIFACT_TYPES.has(artifactType as AgentCliArtifactTypeOption) || !format) {
      return invalid();
    }
    return Object.freeze({
      status: "parsed",
      value: Object.freeze({
        command,
        input,
        artifactType: artifactType as AgentCliArtifactTypeOption,
        format,
      }),
    });
  }

  if (command === "diff") {
    const tokens = parseTokens(
      args,
      new Set(["--base", "--target", "--format"]),
      new Set(),
    );
    if (!tokens || !tokens.values.has("--base") || !tokens.values.has("--target")) {
      return invalid();
    }
    const base = tokens.values.get("--base")!;
    const target = tokens.values.get("--target")!;
    const format = formatFrom(tokens);
    if (!format || !hasAtMostOneStdin(base, target)) return invalid();
    return Object.freeze({
      status: "parsed",
      value: Object.freeze({ command, base, target, format }),
    });
  }

  if (command === "record") {
    const tokens = parseTokens(
      args,
      new Set(["--driver", "--source-id", "--output", "--timeout-ms", "--format"]),
      new Set(["--trust-driver", "--force"]),
    );
    const driver = tokens?.values.get("--driver");
    const sourceId = tokens?.values.get("--source-id");
    const output = tokens?.values.get("--output");
    const format = tokens ? formatFrom(tokens) : undefined;
    const timeout = tokens?.values.has("--timeout-ms")
      ? timeoutValue(tokens.values.get("--timeout-ms"))
      : DEFAULT_TIMEOUT_MS;
    if (
      !tokens || !driver || !sourceId || !output || output === "-" || !format ||
      timeout === undefined || !tokens.switches.has("--trust-driver") ||
      !isAbsoluteDriverPath(driver) || !SOURCE_ID.test(sourceId)
    ) return invalid();
    return Object.freeze({
      status: "parsed",
      value: Object.freeze({
        command,
        driver,
        trustDriver: true,
        sourceId,
        output,
        force: tokens.switches.has("--force"),
        timeoutMs: timeout,
        format,
      }),
    });
  }

  if (command === "replay") {
    const tokens = parseTokens(
      args,
      new Set(["--input", "--format"]),
      new Set(),
    );
    const input = tokens?.values.get("--input");
    const format = tokens ? formatFrom(tokens) : undefined;
    if (!tokens || !input || !format) return invalid();
    return Object.freeze({
      status: "parsed",
      value: Object.freeze({ command, input, format }),
    });
  }

  const tokens = parseTokens(
    args,
    new Set(["--definition", "--driver", "--timeout-ms", "--format"]),
    new Set(["--trust-driver"]),
  );
  const definition = tokens?.values.get("--definition");
  const driver = tokens?.values.get("--driver");
  const format = tokens ? formatFrom(tokens) : undefined;
  const timeout = tokens?.values.has("--timeout-ms")
    ? timeoutValue(tokens.values.get("--timeout-ms"))
    : DEFAULT_TIMEOUT_MS;
  if (
    !tokens || !definition || !driver || !format || timeout === undefined ||
    !tokens.switches.has("--trust-driver") || !isAbsoluteDriverPath(driver)
  ) return invalid();
  return Object.freeze({
    status: "parsed",
    value: Object.freeze({
      command,
      definition,
      driver,
      trustDriver: true,
      timeoutMs: timeout,
      format,
    }),
  });
};
