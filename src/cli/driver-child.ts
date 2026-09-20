/*
 * Fixed trusted-driver bootstrap. Keep this module self-contained: driver
 * source is delivered as pinned bytes over IPC and evaluated as a data URL.
 */

const PROTOCOL = "dual-surface-ui:trusted-driver:0.1";
const MAX_DRIVER_BYTES = 1_048_576;
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
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i,
  /-----BEGIN CERTIFICATE-----/i,
  /\b(?:bearer|basic)\s+[A-Za-z0-9+/._~=-]{8,}/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/i,
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9_-]{12,}\b/i,
  /\b(?:password|passcode|passwd|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|authorization|cookie|session|otp|totp|cvv|cvc|card(?:number)?|payment|webauthn|certificate|private[_-]?key)\s*[:=]\s*\S+/i,
  /\b(?:secret|password|passcode|credential|token|otp|session|api[_-]?key)[-_:][A-Za-z0-9_-]{6,}\b/i,
  /\bwebauthn[:_-][A-Za-z0-9_-]{12,}\b/i,
];
const SENSITIVE_KEY = /^(?:pass(?:word|code)?|passwd|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|authorization|cookie|session|otp|totp|cvv|cvc|card(?:number)?|payment|webauthn|certificate|private[_-]?key)$/i;

// Capture the only IPC capabilities before loading untrusted module bytes.
// The driver can return data solely through the bounded driver API below.
const ipcSend = process.send?.bind(process);
const ipcDisconnect = process.disconnect?.bind(process);

// Node/Windows may synthesize ambient variables even when spawn receives an
// exact env object. Remove them before any trusted driver byte is evaluated.
const ALLOWED_ENVIRONMENT = new Set([
  "DUAL_SURFACE_CLI_CHILD", "TZ", "LANG", "LC_ALL",
  ...(process.platform === "win32" ? ["SystemRoot"] : []),
]);
for (const key of Object.keys(process.env)) {
  if (!ALLOWED_ENVIRONMENT.has(key)) delete process.env[key];
}

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };
type ChildRequest = {
  readonly protocol: typeof PROTOCOL;
  readonly mode: "record" | "evaluate";
  readonly driverBytes: Uint8Array;
  readonly caseId?: string;
  readonly input?: unknown;
};

const fail = (): never => { throw new TypeError("Invalid trusted driver"); };

const hasLuhnPaymentNumber = (value: string): boolean => {
  const candidates = value.match(/(?:\d[ -]?){13,19}/g) ?? [];
  return candidates.some((candidate) => {
    const digits = candidate.replaceAll(/[ -]/g, "");
    if (digits.length < 13 || digits.length > 19) return false;
    let sum = 0;
    let alternate = false;
    for (let index = digits.length - 1; index >= 0; index -= 1) {
      let digit = Number(digits[index]);
      if (alternate && (digit *= 2) > 9) digit -= 9;
      sum += digit;
      alternate = !alternate;
    }
    return sum % 10 === 0;
  });
};

const containsSecret = (value: string): boolean =>
  !/^sha256:[a-f0-9]{64}$/.test(value) &&
  (SECRET_PATTERNS.some((pattern) => pattern.test(value)) ||
    /^\d{6}$/.test(value) || hasLuhnPaymentNumber(value));

const captureJson = (value: unknown): Json => {
  let nodes = 0;
  let characters = 0;
  let properties = 0;
  const ancestors = new Set<object>();
  const capture = (current: unknown, depth: number): Json => {
    if (depth > 32 || ++nodes > 65_536) fail();
    if (current === null || typeof current === "boolean") return current;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) fail();
      return Object.is(current, -0) ? 0 : current;
    }
    if (typeof current === "string") {
      if (current.length > 32_768 || (characters += current.length) > 1_048_576) fail();
      if (containsSecret(current)) fail();
      return current;
    }
    if (typeof current !== "object" || current === null) fail();
    const object = current as object;
    if (ancestors.has(object)) fail();
    ancestors.add(object);
    try {
      const keys = Reflect.ownKeys(object);
      if (keys.some((key) => typeof key === "symbol")) fail();
      if (Array.isArray(object)) {
        const length = Object.getOwnPropertyDescriptor(object, "length");
        if (!length || !("value" in length) || keys.length !== length.value + 1) fail();
        const arrayLength = (length as PropertyDescriptor & { value: number }).value;
        return Object.freeze(Array.from({ length: arrayLength }, (_, index) => {
          const descriptor = Object.getOwnPropertyDescriptor(object, String(index));
          if (!descriptor || !("value" in descriptor)) fail();
          return capture((descriptor as PropertyDescriptor & { value: unknown }).value, depth + 1);
        }));
      }
      if ((properties += keys.length) > 65_536 || keys.length > 4_096) fail();
      const result: Record<string, Json> = Object.create(null) as Record<string, Json>;
      for (const key of (keys as string[]).sort()) {
        if (SENSITIVE_KEY.test(key)) fail();
        const descriptor = Object.getOwnPropertyDescriptor(object, key);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) fail();
        Object.defineProperty(result, key, {
          value: capture((descriptor as PropertyDescriptor & { value: unknown }).value, depth + 1), enumerable: true,
          writable: false, configurable: false,
        });
      }
      return Object.freeze(result);
    } finally {
      ancestors.delete(object);
    }
  };
  const captured = capture(value, 0);
  if (Buffer.byteLength(JSON.stringify(captured), "utf8") > MAX_RESULT_BYTES) fail();
  return captured;
};

const exactObject = (value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail();
  const object = value as object;
  const keys = Reflect.ownKeys(object);
  if (keys.some((key) => typeof key !== "string")) fail();
  const allowed = new Set([...required, ...optional]);
  if (keys.some((key) => !allowed.has(key as string)) || required.some((key) => !keys.includes(key))) fail();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) fail();
    result[key] = (descriptor as PropertyDescriptor & { value: unknown }).value;
  }
  return result;
};

const captureAuditEvent = (value: unknown): Json => {
  const event = exactObject(value, [
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
      (event.action !== undefined && (typeof event.action !== "string" || event.action.length < 1 || event.action.length > 64))) fail();
  return captureJson(event);
};

const send = (value: unknown): void => {
  if (!ipcSend) process.exit(1);
  ipcSend(value, (error: Error | null) => {
    if (error) process.exitCode = 1;
    ipcDisconnect?.();
  });
};

const run = async (raw: unknown): Promise<void> => {
  const request = exactObject(raw, ["protocol", "mode", "driverBytes"], ["caseId", "input"]);
  if (request.protocol !== PROTOCOL || (request.mode !== "record" && request.mode !== "evaluate")) fail();
  if (!(request.driverBytes instanceof Uint8Array) || request.driverBytes.byteLength < 1 || request.driverBytes.byteLength > MAX_DRIVER_BYTES) fail();
  if (request.mode === "record" && (Object.hasOwn(request, "caseId") || Object.hasOwn(request, "input"))) fail();
  if (request.mode === "evaluate" && (typeof request.caseId !== "string" || !IDENTIFIER.test(request.caseId) || !Object.hasOwn(request, "input"))) fail();

  const driverBytes = request.driverBytes as Uint8Array;
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(driverBytes).toString("base64")}`;
  const namespace: object = await import(moduleUrl);
  const exports = Reflect.ownKeys(namespace).filter((key) => typeof key === "string");
  if (exports.length !== 1 || exports[0] !== "createDualSurfaceCliDriver") fail();
  const factoryDescriptor = Object.getOwnPropertyDescriptor(namespace, "createDualSurfaceCliDriver");
  if (!factoryDescriptor || !("value" in factoryDescriptor) || typeof factoryDescriptor.value !== "function") fail();
  const factory = (factoryDescriptor as PropertyDescriptor & { value: () => unknown }).value;
  const driver = exactObject(await factory(), ["schemaVersion", "kind", "driverId"], ["record", "evaluateCase"]);
  if (driver.schemaVersion !== "0.1" || driver.kind !== "agent-cli-driver" ||
      typeof driver.driverId !== "string" || !IDENTIFIER.test(driver.driverId) || containsSecret(driver.driverId)) fail();
  if (driver.record !== undefined && typeof driver.record !== "function") fail();
  if (driver.evaluateCase !== undefined && typeof driver.evaluateCase !== "function") fail();
  const signal = Object.freeze(new AbortController().signal);

  if (request.mode === "record") {
    if (typeof driver.record !== "function") fail();
    const auditEvents: Json[] = [];
    const context = Object.freeze({
      signal,
      emitAudit: (event: unknown): void => {
        if (auditEvents.length >= 4_096) fail();
        auditEvents.push(captureAuditEvent(event));
      },
    });
    const record = driver.record as (context: unknown) => unknown;
    await record(context);
    send({ protocol: PROTOCOL, ok: true, value: captureJson({ mode: "record", driverId: driver.driverId, auditEvents }) });
    return;
  }

  if (typeof driver.evaluateCase !== "function") fail();
  const input = captureJson(request.input);
  const evaluateCase = driver.evaluateCase as (request: unknown, context: unknown) => unknown;
  const result = exactObject(await evaluateCase(
    Object.freeze({ caseId: request.caseId as string, input }),
    Object.freeze({ signal }),
  ), ["status"], ["observations"]);
  let capturedResult: Json | undefined;
  if (result.status === "environment_unavailable" && !Object.hasOwn(result, "observations")) {
    capturedResult = Object.freeze({ status: "environment_unavailable" });
  } else if (result.status === "observed" && Object.hasOwn(result, "observations")) {
    capturedResult = captureJson({ status: "observed", observations: result.observations });
  } else fail();
  if (capturedResult === undefined) fail();
  send({ protocol: PROTOCOL, ok: true, value: captureJson({ mode: "evaluate", driverId: driver.driverId, result: capturedResult }) });
};

let received = false;
process.once("message", (message: unknown) => {
  if (received) process.exit(1);
  received = true;
  Object.defineProperties(process, {
    send: { value: undefined, writable: false, configurable: false },
    disconnect: { value: undefined, writable: false, configurable: false },
  });
  void run(message).catch(() => send({ protocol: PROTOCOL, ok: false }));
});
