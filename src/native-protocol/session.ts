import { deepFreeze } from "../delta/canonical.js";
import { captureAndValidateNativeProtocolMessage } from "./message-validation.js";
import type {
  NativeProtocolCapability,
  NativeProtocolClientHello,
  NativeProtocolDataMessage,
  NativeProtocolExecutionMessage,
  NativeProtocolMessage,
  NativeProtocolRequestErrorCode,
  NativeProtocolServerHello,
  NativeProtocolSessionPhase,
  NativeProtocolSessionState,
} from "./types.js";

const MAX_ACTIVE_REQUESTS = 128;
const MAX_COMPLETED_REQUESTS = 4_096;

type RequestMessage = Extract<
  NativeProtocolDataMessage | NativeProtocolExecutionMessage,
  { readonly kind:
      | "surface-list-request"
      | "snapshot-request"
      | "delta-request"
      | "action-request"
      | "cancel-request" }
>;
type ResponseMessage = Extract<
  NativeProtocolDataMessage | NativeProtocolExecutionMessage,
  { readonly kind:
      | "surface-list-response"
      | "snapshot-response"
      | "delta-response"
      | "action-response"
      | "cancel-response"
      | "request-error" }
>;

interface PendingRequest {
  readonly kind: RequestMessage["kind"];
  readonly fingerprint: string;
  readonly message: RequestMessage;
  readonly surfaceRevision?: string;
  readonly replayResponseFingerprint?: string;
}

interface CompletedRequest {
  readonly requestFingerprint: string;
  readonly responseFingerprint: string;
}

const REQUEST_CAPABILITY = {
  "surface-list-request": "surface-catalog",
  "snapshot-request": "snapshots",
  "delta-request": "deltas",
  "action-request": "actions",
  "cancel-request": "cancellation",
} as const satisfies Record<RequestMessage["kind"], NativeProtocolCapability>;

const RESPONSE_REQUEST = {
  "surface-list-response": "surface-list-request",
  "snapshot-response": "snapshot-request",
  "delta-response": "delta-request",
  "action-response": "action-request",
  "cancel-response": "cancel-request",
} as const;

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`
  ).join(",")}}`;
};

export class NativeProtocolSessionError extends TypeError {
  readonly code: NativeProtocolRequestErrorCode;

  constructor(code: NativeProtocolRequestErrorCode) {
    super("Native protocol session verification failed");
    this.name = "NativeProtocolSessionError";
    this.code = code;
  }
}

export class NativeProtocolSessionVerifier {
  #phase: NativeProtocolSessionPhase = "awaiting-client-hello";
  #clientHello: NativeProtocolClientHello | null = null;
  #sessionRef: string | null = null;
  #capabilities = new Set<NativeProtocolCapability>();
  #pending = new Map<string, PendingRequest>();
  #completed = new Map<string, CompletedRequest>();
  #surfaces = new Map<string, string>();
  #lastEventSequence = 0;
  #catalogStale = false;

  get state(): NativeProtocolSessionState {
    return deepFreeze({
      phase: this.#phase,
      sessionRef: this.#sessionRef,
      capabilities: [...this.#capabilities].sort(),
      activeRequests: this.#pending.size,
      completedRequests: this.#completed.size,
      surfaces: this.#surfaces.size,
      lastEventSequence: this.#lastEventSequence,
      catalogStale: this.#catalogStale,
    });
  }

  accept(value: unknown): NativeProtocolSessionState {
    let message: NativeProtocolMessage;
    try {
      message = captureAndValidateNativeProtocolMessage(value);
    } catch {
      return this.#fail("invalid_message");
    }
    if (this.#phase === "closed") return this.#fail("invalid_session");
    if (this.#phase === "awaiting-client-hello") {
      if (message.kind !== "client-hello") return this.#fail("invalid_message");
      this.#clientHello = message;
      this.#phase = "awaiting-server-hello";
      return this.state;
    }
    if (this.#phase === "awaiting-server-hello") {
      if (message.kind === "protocol-error") {
        if (message.requestId !== this.#clientHello?.requestId) {
          return this.#fail("invalid_message");
        }
        this.#close();
        return this.state;
      }
      if (message.kind !== "server-hello") return this.#fail("invalid_message");
      this.#activate(message);
      return this.state;
    }
    return this.#acceptActive(message);
  }

  #activate(message: NativeProtocolServerHello): void {
    const hello = this.#clientHello;
    if (
      !hello ||
      message.requestId !== hello.requestId ||
      message.capabilities.some((capability) => !hello.capabilities.includes(capability)) ||
      hello.requiredCapabilities.some(
        (capability) => !message.capabilities.includes(capability),
      )
    ) this.#fail("invalid_message");
    this.#sessionRef = message.sessionRef;
    this.#capabilities = new Set(message.capabilities);
    this.#phase = "active";
  }

  #acceptActive(message: NativeProtocolMessage): NativeProtocolSessionState {
    if (
      message.kind === "client-hello" ||
      message.kind === "server-hello" ||
      message.kind === "protocol-error"
    ) return this.#fail("invalid_message");
    if (message.sessionRef !== this.#sessionRef) return this.#fail("invalid_session");
    if (message.kind === "event") {
      this.#acceptEvent(message);
      return this.state;
    }
    if (message.kind.endsWith("-request")) {
      this.#acceptRequest(message as RequestMessage);
      return this.state;
    }
    this.#acceptResponse(message as ResponseMessage);
    return this.state;
  }

  #acceptRequest(message: RequestMessage): void {
    const capability = REQUEST_CAPABILITY[message.kind];
    if (!this.#capabilities.has(capability)) this.#fail("capability_not_negotiated");
    if (
      this.#catalogStale &&
      message.kind !== "surface-list-request" &&
      message.kind !== "cancel-request"
    ) this.#fail("resync_required");
    if (this.#pending.has(message.requestId)) this.#fail("request_conflict");
    const fingerprint = canonicalJson(message);
    const completed = this.#completed.get(message.requestId);
    let replayResponseFingerprint: string | undefined;
    if (completed) {
      if (
        message.kind !== "action-request" ||
        message.idempotencyKey === undefined ||
        completed.requestFingerprint !== fingerprint
      ) this.#fail("request_conflict");
      replayResponseFingerprint = completed.responseFingerprint;
    }
    if (this.#pending.size >= MAX_ACTIVE_REQUESTS) this.#fail("resource_limit");
    if (this.#completed.size >= MAX_COMPLETED_REQUESTS && !completed) {
      this.#fail("resource_limit");
    }
    if (
      message.kind === "snapshot-request" ||
      message.kind === "delta-request" ||
      message.kind === "action-request"
    ) {
      const revision = this.#surfaces.get(message.surfaceRef);
      if (revision === undefined) this.#fail("surface_unavailable");
      const requestedRevision = message.kind === "delta-request"
        ? message.baseRevision
        : message.kind === "action-request"
          ? message.revision
          : undefined;
      if (
        !completed &&
        requestedRevision !== undefined &&
        requestedRevision !== revision
      ) {
        this.#fail("stale_revision");
      }
    }
    if (message.kind === "cancel-request") {
      if (message.targetRequestId === message.requestId) this.#fail("invalid_message");
      if (!this.#pending.has(message.targetRequestId)) this.#fail("request_conflict");
    }
    const surfaceRevision = message.kind === "snapshot-request" ||
      message.kind === "delta-request" ||
      message.kind === "action-request"
      ? this.#surfaces.get(message.surfaceRef)
      : undefined;
    this.#pending.set(message.requestId, {
      kind: message.kind,
      fingerprint,
      message,
      ...(surfaceRevision === undefined ? {} : { surfaceRevision }),
      ...(replayResponseFingerprint ? { replayResponseFingerprint } : {}),
    });
  }

  #acceptResponse(message: ResponseMessage): void {
    const pending = this.#pending.get(message.requestId);
    if (!pending) this.#fail("request_conflict");
    if (
      message.kind !== "request-error" &&
      RESPONSE_REQUEST[message.kind] !== pending.kind
    ) this.#fail("invalid_message");
    const responseFingerprint = canonicalJson(message);
    if (
      pending.replayResponseFingerprint !== undefined &&
      pending.replayResponseFingerprint !== responseFingerprint
    ) this.#fail("request_conflict");
    this.#applyResponse(message, pending);
    this.#pending.delete(message.requestId);
    this.#completed.set(message.requestId, {
      requestFingerprint: pending.fingerprint,
      responseFingerprint,
    });
  }

  #applyResponse(message: ResponseMessage, pending: PendingRequest): void {
    const request = pending.message;
    if (message.kind === "request-error") return;
    if (message.kind === "surface-list-response") {
      if (
        this.#catalogStale &&
        [...this.#pending.entries()].some(([requestId, candidate]) =>
          requestId !== message.requestId &&
          (candidate.kind === "snapshot-request" ||
            candidate.kind === "delta-request" ||
            candidate.kind === "action-request")
        )
      ) this.#fail("resync_required");
      this.#surfaces = new Map(
        message.surfaces.map((surface) => [surface.surfaceRef, surface.revision]),
      );
      this.#catalogStale = false;
      return;
    }
    if (message.kind === "snapshot-response") {
      if (request.kind !== "snapshot-request" || message.surfaceRef !== request.surfaceRef) {
        this.#fail("invalid_message");
      }
      const currentRevision = this.#surfaces.get(message.surfaceRef);
      if (
        currentRevision !== pending.surfaceRevision &&
        currentRevision !== message.snapshot.revision
      ) this.#fail("resync_required");
      this.#surfaces.set(message.surfaceRef, message.snapshot.revision);
      return;
    }
    if (message.kind === "delta-response") {
      if (
        request.kind !== "delta-request" ||
        message.surfaceRef !== request.surfaceRef ||
        message.delta.baseRevision !== request.baseRevision ||
        message.delta.baseDigest !== request.baseDigest
      ) this.#fail("resync_required");
      const currentRevision = this.#surfaces.get(message.surfaceRef);
      if (
        currentRevision !== pending.surfaceRevision &&
        currentRevision !== message.delta.revision
      ) this.#fail("resync_required");
      this.#surfaces.set(message.surfaceRef, message.delta.revision);
      return;
    }
    if (message.kind === "action-response") {
      if (request.kind !== "action-request" || message.surfaceRef !== request.surfaceRef) {
        this.#fail("invalid_message");
      }
      const currentRevision = this.#surfaces.get(message.surfaceRef);
      if (
        currentRevision !== pending.surfaceRevision &&
        currentRevision !== message.outcome.revision
      ) this.#fail("resync_required");
      if (
        message.outcome.status === "succeeded" &&
        message.outcome.previousRevision !== request.revision
      ) this.#fail("stale_revision");
      this.#surfaces.set(message.surfaceRef, message.outcome.revision);
      return;
    }
    if (
      request.kind !== "cancel-request" ||
      message.targetRequestId !== request.targetRequestId
    ) this.#fail("invalid_message");
  }

  #acceptEvent(message: Extract<NativeProtocolExecutionMessage, { kind: "event" }>): void {
    if (!this.#capabilities.has("events")) this.#fail("capability_not_negotiated");
    if (message.sequence !== this.#lastEventSequence + 1) this.#fail("resync_required");
    this.#lastEventSequence = message.sequence;
    if (message.event === "session-invalidated") {
      this.#close();
      return;
    }
    if (message.event === "catalog-changed") {
      this.#catalogStale = true;
      return;
    }
    if (!this.#surfaces.has(message.surfaceRef)) this.#fail("surface_unavailable");
    if (message.event === "surface-closed") {
      this.#surfaces.delete(message.surfaceRef);
    } else {
      this.#surfaces.set(message.surfaceRef, message.revision);
    }
  }

  #close(): void {
    this.#phase = "closed";
    this.#sessionRef = null;
    this.#capabilities.clear();
    this.#pending.clear();
    this.#completed.clear();
    this.#surfaces.clear();
    this.#lastEventSequence = 0;
    this.#catalogStale = false;
    this.#clientHello = null;
  }

  #fail(code: NativeProtocolRequestErrorCode): never {
    this.#close();
    throw new NativeProtocolSessionError(code);
  }
}
