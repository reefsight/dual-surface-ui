import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, parse, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Stats } from "node:fs";
import type { AgentAuditEvent } from "../audit.js";
import { descriptorSafeCaptureJson, type CanonicalJson } from "../delta/canonical.js";
import { containsSecretSentinel, isSensitiveKey } from "../internal/secret-detection.js";
import type { AgentCliJson, AgentEvaluationDriverCaseResult } from "./types.js";

const PROTOCOL = "dual-surface-ui:trusted-driver:0.1";
const MAX_DRIVER_BYTES = 1_048_576;
const MAX_CHILD_OUTPUT_BYTES = 65_536;
const MAX_RESULT_BYTES = 1_048_576;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const AUDIT_IDENTIFIER = /^[A-Za-z0-9._~-]{1,128}$/;
const EVENT_NAMES = new Set([
  "surface_observed", "action_requested", "policy_decided",
  "confirmation_requested", "action_started", "action_verified", "action_failed",
]);
const OUTCOMES = new Set([
  "observed", "requested", "allow", "deny", "require_confirmation", "started",
  "succeeded", "replayed", "element_not_found", "action_not_found",
  "authorization_required", "duplicate_element_id", "surface_mismatch",
  "stale_revision", "invalid_input", "confirmation_required",
  "invalid_policy_decision", "precondition_failed", "verification_failed",
  "invalid_output", "idempotency_key_required", "invalid_idempotency_key",
  "idempotency_conflict", "idempotency_unavailable", "internal_error",
]);

export type TrustedDriverRequest =
  | Readonly<{ mode: "record"; driver: string; timeoutMs: number }>
  | Readonly<{ mode: "evaluate"; driver: string; timeoutMs: number; caseId: string; input: AgentCliJson }>;

export type TrustedDriverResult =
  | { readonly mode: "record"; readonly driverId: string; readonly auditEvents: readonly AgentAuditEvent[] }
  | { readonly mode: "evaluate"; readonly driverId: string; readonly result: AgentEvaluationDriverCaseResult };

export class TrustedDriverExecutionError extends Error {
  readonly reason: "driver_error" | "cancelled";
  constructor(reason: "driver_error" | "cancelled") {
    super(reason === "cancelled" ? "Trusted driver cancelled" : "Trusted driver failed");
    this.name = "TrustedDriverExecutionError";
    this.reason = reason;
  }
}

type Pin = Readonly<{ path: string; bytes: Uint8Array; digest: string; dev: bigint; ino: bigint }>;

const driverError = (): never => { throw new TrustedDriverExecutionError("driver_error"); };
const cancelled = (): never => { throw new TrustedDriverExecutionError("cancelled"); };
const samePath = (left: string, right: string): boolean =>
  process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;

const parseDriverPath = (value: string): string => {
  if (value.startsWith("\\\\") || value.startsWith("//")) return driverError();
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) && !/^[A-Za-z]:[\\/]/.test(value)) {
    let url: URL;
    try { url = new URL(value); } catch { return driverError(); }
    if (url.protocol !== "file:" || url.hostname !== "" || url.username !== "" ||
        url.password !== "" || url.port !== "" || url.search !== "" || url.hash !== "") return driverError();
    let path: string;
    try { path = fileURLToPath(url); } catch { return driverError(); }
    if (!isAbsolute(path) || path.startsWith("\\\\") || path.startsWith("//")) return driverError();
    if (pathToFileURL(path).href !== url.href) return driverError();
    return resolve(path);
  }
  if (!isAbsolute(value)) return driverError();
  return resolve(value);
};

const components = (absolutePath: string): readonly string[] => {
  const root = parse(absolutePath).root;
  const relative = absolutePath.slice(root.length).split(sep).filter(Boolean);
  const result = [root];
  for (const component of relative) result.push(resolve(result[result.length - 1]!, component));
  return result;
};

const assertSafeChain = async (absolutePath: string): Promise<void> => {
  const chain = components(absolutePath);
  for (let index = 0; index < chain.length; index += 1) {
    const path = chain[index]!;
    let stats: Stats;
    try { stats = await lstat(path, { bigint: true }) as unknown as Stats; } catch { return driverError(); }
    if (stats.isSymbolicLink() || (index < chain.length - 1 ? !stats.isDirectory() : !stats.isFile())) return driverError();
    let canonical: string;
    try { canonical = await realpath(path); } catch { return driverError(); }
    if (!samePath(resolve(canonical), resolve(path))) return driverError();
  }
};

const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const readPinned = async (path: string): Promise<Pin> => {
  await assertSafeChain(path);
  let handle;
  try {
    handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const stats = await handle.stat({ bigint: true });
    if (!stats.isFile() || stats.size < 1n || stats.size > BigInt(MAX_DRIVER_BYTES)) return driverError();
    const bytes = new Uint8Array(Number(stats.size));
    let offset = 0;
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (read.bytesRead < 1) return driverError();
      offset += read.bytesRead;
    }
    return Object.freeze({ path, bytes, digest: digest(bytes), dev: stats.dev, ino: stats.ino });
  } catch (error) {
    if (error instanceof TrustedDriverExecutionError) throw error;
    return driverError();
  } finally {
    await handle?.close().catch(() => undefined);
  }
};

const recheckPin = async (pin: Pin): Promise<void> => {
  const current = await readPinned(pin.path);
  if (current.dev !== pin.dev || current.ino !== pin.ino || current.digest !== pin.digest ||
      current.bytes.byteLength !== pin.bytes.byteLength) driverError();
};

const scan = (value: CanonicalJson): void => {
  if (typeof value === "string") {
    if (!/^sha256:[a-f0-9]{64}$/.test(value) && containsSecretSentinel(value)) driverError();
  } else if (Array.isArray(value)) {
    for (const item of value) scan(item);
  } else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (isSensitiveKey(key)) driverError();
      scan(item);
    }
  }
};

const capture = (value: unknown): CanonicalJson => {
  try {
    const result = descriptorSafeCaptureJson(value, {
      maxDepth: 32, maxNodes: 65_536, maxCharacters: MAX_RESULT_BYTES,
      maxStringLength: 32_768, maxPropertiesPerObject: 4_096,
    });
    if (Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_RESULT_BYTES) return driverError();
    scan(result);
    return result;
  } catch (error) {
    if (error instanceof TrustedDriverExecutionError) throw error;
    return driverError();
  }
};

const exact = (value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, CanonicalJson> => {
  const captured = capture(value);
  if (captured === null || typeof captured !== "object" || Array.isArray(captured)) return driverError();
  const keys = Object.keys(captured);
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !Object.hasOwn(captured, key)) || keys.some((key) => !allowed.has(key))) return driverError();
  return captured as Record<string, CanonicalJson>;
};

const validateAudit = (value: unknown): AgentAuditEvent => {
  const event = exact(value, [
    "schemaVersion", "event", "correlationId", "surfaceId", "revision",
    "sequence", "timestamp", "durationMs", "outcome",
  ], ["action"]);
  if (event.schemaVersion !== "0.1" || typeof event.event !== "string" || !EVENT_NAMES.has(event.event) ||
      typeof event.outcome !== "string" || !OUTCOMES.has(event.outcome) ||
      typeof event.correlationId !== "string" || !AUDIT_IDENTIFIER.test(event.correlationId) ||
      typeof event.surfaceId !== "string" || !AUDIT_IDENTIFIER.test(event.surfaceId) ||
      typeof event.revision !== "string" || event.revision.length < 1 || event.revision.length > 32_768 ||
      !Number.isSafeInteger(event.sequence) || (event.sequence as number) < 1 ||
      typeof event.timestamp !== "string" || event.timestamp.length > 64 || !Number.isFinite(Date.parse(event.timestamp)) ||
      typeof event.durationMs !== "number" || !Number.isFinite(event.durationMs) || event.durationMs < 0 ||
      (event.action !== undefined && (typeof event.action !== "string" || event.action.length < 1 || event.action.length > 64))) return driverError();
  return event as unknown as AgentAuditEvent;
};

const validateResponse = (raw: unknown, mode: TrustedDriverRequest["mode"]): TrustedDriverResult => {
  const envelope = exact(raw, ["protocol", "ok"], ["value"]);
  if (envelope.protocol !== PROTOCOL || envelope.ok !== true || !Object.hasOwn(envelope, "value")) return driverError();
  if (mode === "record") {
    const value = exact(envelope.value, ["mode", "driverId", "auditEvents"]);
    if (value.mode !== "record" || typeof value.driverId !== "string" || !IDENTIFIER.test(value.driverId) || !Array.isArray(value.auditEvents)) return driverError();
    return Object.freeze({ mode: "record", driverId: value.driverId, auditEvents: Object.freeze(value.auditEvents.map(validateAudit)) });
  }
  const value = exact(envelope.value, ["mode", "driverId", "result"]);
  if (value.mode !== "evaluate" || typeof value.driverId !== "string" || !IDENTIFIER.test(value.driverId)) return driverError();
  const result = exact(value.result, ["status"], ["observations"]);
  if (result.status === "environment_unavailable" && !Object.hasOwn(result, "observations")) {
    return Object.freeze({ mode: "evaluate", driverId: value.driverId, result: Object.freeze({ status: "environment_unavailable" }) });
  }
  if (result.status !== "observed" || !Object.hasOwn(result, "observations") || result.observations === null ||
      typeof result.observations !== "object" || Array.isArray(result.observations)) return driverError();
  return Object.freeze({ mode: "evaluate", driverId: value.driverId, result: Object.freeze({
    status: "observed", observations: result.observations as Readonly<Record<string, AgentCliJson>>,
  }) });
};

const bootstrapPath = (): string => {
  const ownPath = fileURLToPath(import.meta.url);
  const sibling = resolve(dirname(ownPath), "driver-child.js");
  if (ownPath.endsWith(".js")) return sibling;
  return resolve(dirname(ownPath), "../../dist/cli/driver-child.js");
};

/** Executes one pinned trusted-driver operation in a fresh, terminable process. */
export const executeNodeTrustedDriver = async (
  request: TrustedDriverRequest,
  cwd: string,
  signal: AbortSignal,
): Promise<TrustedDriverResult> => {
  if (signal.aborted) return cancelled();
  if (!isAbsolute(cwd) || !Number.isSafeInteger(request.timeoutMs) || request.timeoutMs < 1 || request.timeoutMs > 600_000) return driverError();
  if (request.mode === "evaluate" && (!IDENTIFIER.test(request.caseId) || capture(request.input) === undefined)) return driverError();
  const pin = await readPinned(parseDriverPath(request.driver));
  await recheckPin(pin);
  if (signal.aborted) return cancelled();

  return await new Promise<TrustedDriverResult>((resolvePromise, rejectPromise) => {
    const environment: NodeJS.ProcessEnv = { DUAL_SURFACE_CLI_CHILD: "1", TZ: "UTC", LANG: "C", LC_ALL: "C" };
    if (process.platform === "win32" && process.env.SystemRoot !== undefined) environment.SystemRoot = process.env.SystemRoot;
    const child = spawn(process.execPath, [bootstrapPath()], {
      cwd, env: environment, shell: false, windowsHide: true,
      stdio: ["ignore", "pipe", "pipe", "ipc"], serialization: "advanced",
    });
    let settled = false;
    let failure: "driver_error" | "cancelled" | undefined;
    let response: TrustedDriverResult | undefined;
    let messages = 0;
    const output: Buffer[] = [];
    let outputBytes = 0;
    let killTimer: NodeJS.Timeout | undefined;
    const terminate = (reason: "driver_error" | "cancelled"): void => {
      failure ??= reason;
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      killTimer ??= setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, 250);
      killTimer.unref();
    };
    const consume = (chunk: Buffer): void => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_CHILD_OUTPUT_BYTES) { terminate("driver_error"); return; }
      output.push(Buffer.from(chunk));
    };
    child.stdout!.on("data", consume);
    child.stderr!.on("data", consume);
    child.on("message", (message: unknown) => {
      messages += 1;
      if (messages !== 1) { terminate("driver_error"); return; }
      try { response = validateResponse(message, request.mode); } catch { terminate("driver_error"); }
    });
    child.on("error", () => terminate("driver_error"));
    const timer = setTimeout(() => terminate("cancelled"), request.timeoutMs);
    const abort = (): void => terminate("cancelled");
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer !== undefined) clearTimeout(killTimer);
      signal.removeEventListener("abort", abort);
      try {
        const text = Buffer.concat(output).toString("utf8");
        if (text.length > 0 && containsSecretSentinel(text)) failure = "driver_error";
      } catch { failure = "driver_error"; }
      if (failure === "cancelled") { rejectPromise(new TrustedDriverExecutionError("cancelled")); return; }
      if (failure || code !== 0 || messages !== 1 || !response) { rejectPromise(new TrustedDriverExecutionError("driver_error")); return; }
      resolvePromise(response);
    });
    const payload = request.mode === "record"
      ? { protocol: PROTOCOL, mode: "record", driverBytes: pin.bytes }
      : { protocol: PROTOCOL, mode: "evaluate", driverBytes: pin.bytes, caseId: request.caseId, input: capture(request.input) };
    child.send(payload, (error) => { if (error) terminate("driver_error"); });
  });
};
