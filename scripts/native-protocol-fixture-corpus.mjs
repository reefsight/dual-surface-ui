const LIMITS = {
  frameBytes: 1_048_576,
  snapshotBytes: 1_048_576,
  deltaBytes: 524_288,
  actionResultBytes: 262_144,
  errorMessageCharacters: 500,
  surfaces: 128,
  actionsPerSurface: 128,
};
const digest = (character) => `sha256:${character.repeat(64)}`;
const encode = (message) => JSON.stringify(message);
const toHex = (text) => Array.from(
  new TextEncoder().encode(text),
  (byte) => byte.toString(16).padStart(2, "0"),
).join("");
const accept = (id, message, code) => ({
  id,
  encoding: "utf8",
  payload: encode(message),
  expected: {
    status: "accepted",
    kind: message.kind,
    ...(code ? { code } : {}),
  },
});
const reject = (id, payload) => ({
  id,
  encoding: "utf8",
  payload,
  expected: { status: "rejected", error: "Invalid native protocol frame" },
});

const node = {
  id: "button-1",
  role: "button",
  name: "Save",
  state: {},
  actions: [{ name: "click", risk: "write", idempotency: "keyed" }],
};
const snapshot = {
  schemaVersion: "0.1",
  surfaceId: "surface-1",
  revision: "revision-1",
  title: "Fixture",
  url: "app://fixture",
  generatedAt: "2026-09-22T00:00:00.000Z",
  capabilities: ["actions"],
  nodes: [node],
};
const delta = {
  schemaVersion: "0.1",
  kind: "agent-snapshot-delta",
  surfaceId: "surface-1",
  baseRevision: "revision-1",
  revision: "revision-2",
  baseDigest: digest("a"),
  targetDigest: digest("b"),
  target: {
    title: "Fixture",
    url: "app://fixture",
    generatedAt: "2026-09-22T00:00:01.000Z",
    focusedElementId: null,
    capabilities: ["actions"],
  },
  nodeUpserts: [node],
  removedNodeIds: [],
};

const handshakeErrors = {
  invalid_message: "Invalid native protocol message",
  missing_required_capability: "Required native protocol capability is unavailable",
  no_compatible_version: "No compatible native protocol version",
};
const requestErrors = {
  capability_not_negotiated: "Capability was not negotiated for this session",
  internal_error: "Native protocol request failed",
  invalid_message: "Invalid native protocol message",
  invalid_session: "Native protocol session is invalid",
  permission_denied: "Native accessibility permission is unavailable",
  request_cancelled: "Native protocol request was cancelled",
  request_conflict: "Native protocol request conflicts with prior state",
  resource_limit: "Native protocol resource limit exceeded",
  resync_required: "Native protocol state resynchronization is required",
  stale_revision: "Native surface revision is stale",
  surface_unavailable: "Native surface is unavailable",
};
const actionFailures = {
  action_not_found: "The requested action is unavailable",
  authorization_required: "The action is not authorized",
  confirmation_required: "The action requires trusted confirmation",
  duplicate_element_id: "The surface contains duplicate element identifiers",
  element_not_found: "The target element was not found",
  idempotency_conflict: "The idempotency key conflicts with an earlier request",
  idempotency_key_required: "The action requires an idempotency key",
  idempotency_unavailable: "Secure idempotency protection is unavailable",
  internal_error: "The action failed unexpectedly",
  invalid_idempotency_key: "The idempotency key is invalid",
  invalid_input: "The action input is invalid",
  invalid_output: "The action output is invalid",
  invalid_policy_decision: "The policy decision is invalid",
  precondition_failed: "An action precondition was not satisfied",
  stale_revision: "The observed surface revision is stale",
  surface_mismatch: "The request targets a different surface",
  verification_failed: "The action effects could not be verified",
};

export function createNativeProtocolFixtureCorpus() {
  const cases = [
    accept("client-hello", {
      schemaVersion: "0.1",
      kind: "client-hello",
      requestId: "request-hello",
      supportedVersions: ["0.1"],
      capabilities: ["actions", "snapshots", "surface-catalog"],
      requiredCapabilities: ["snapshots"],
    }),
    accept("server-hello", {
      schemaVersion: "0.1",
      kind: "server-hello",
      requestId: "request-hello",
      sessionRef: "session-1",
      protocolVersion: "0.1",
      capabilities: ["actions", "snapshots", "surface-catalog"],
      limits: LIMITS,
    }),
    ...Object.entries(handshakeErrors).map(([code, message]) => accept(
      `protocol-error-${code.replaceAll("_", "-")}`,
      { schemaVersion: "0.1", kind: "protocol-error", requestId: "request-error", code, message },
      code,
    )),
    accept("surface-list-request", {
      schemaVersion: "0.1", kind: "surface-list-request", requestId: "request-list", sessionRef: "session-1",
    }),
    accept("surface-list-response", {
      schemaVersion: "0.1", kind: "surface-list-response", requestId: "request-list", sessionRef: "session-1",
      surfaces: [{ surfaceRef: "surface-1", revision: "revision-1", title: "Fixture", application: "Fixture App", capabilities: ["actions", "snapshots"], actionCount: 1 }],
    }),
    accept("snapshot-request", {
      schemaVersion: "0.1", kind: "snapshot-request", requestId: "request-snapshot", sessionRef: "session-1", surfaceRef: "surface-1",
    }),
    accept("snapshot-response", {
      schemaVersion: "0.1", kind: "snapshot-response", requestId: "request-snapshot", sessionRef: "session-1", surfaceRef: "surface-1", snapshot,
    }),
    accept("delta-request", {
      schemaVersion: "0.1", kind: "delta-request", requestId: "request-delta", sessionRef: "session-1", surfaceRef: "surface-1", baseRevision: "revision-1", baseDigest: digest("a"),
    }),
    accept("delta-response", {
      schemaVersion: "0.1", kind: "delta-response", requestId: "request-delta", sessionRef: "session-1", surfaceRef: "surface-1", delta,
    }),
    accept("action-request", {
      schemaVersion: "0.1", kind: "action-request", requestId: "request-action", sessionRef: "session-1", surfaceRef: "surface-1", revision: "revision-1", elementId: "button-1", action: "click", input: { confirmed: true }, idempotencyKey: "idem-1",
    }),
    accept("action-response-success", {
      schemaVersion: "0.1", kind: "action-response", requestId: "request-action", sessionRef: "session-1", surfaceRef: "surface-1",
      outcome: { schemaVersion: "0.1", surfaceId: "surface-1", previousRevision: "revision-1", revision: "revision-2", status: "succeeded", action: "click", targetId: "button-1", targetPresent: true, node, output: { saved: true } },
    }),
    ...Object.entries(actionFailures).map(([code, message], index) => accept(
      `action-response-failure-${code.replaceAll("_", "-")}`,
      { schemaVersion: "0.1", kind: "action-response", requestId: `request-failure-${index}`, sessionRef: "session-1", surfaceRef: "surface-1", outcome: { schemaVersion: "0.1", surfaceId: "surface-1", revision: "revision-1", status: "failed", error: { code, message } } },
      code,
    )),
    accept("cancel-request", {
      schemaVersion: "0.1", kind: "cancel-request", requestId: "request-cancel", sessionRef: "session-1", targetRequestId: "request-action",
    }),
    accept("cancel-response", {
      schemaVersion: "0.1", kind: "cancel-response", requestId: "request-cancel", sessionRef: "session-1", targetRequestId: "request-action", disposition: "accepted",
    }),
    ...Object.entries(requestErrors).map(([code, message]) => accept(
      `request-error-${code.replaceAll("_", "-")}`,
      { schemaVersion: "0.1", kind: "request-error", requestId: "request-error", sessionRef: "session-1", code, message },
      code,
    )),
    accept("event-catalog-changed", {
      schemaVersion: "0.1", kind: "event", sessionRef: "session-1", sequence: 1, event: "catalog-changed",
    }),
    accept("event-surface-changed", {
      schemaVersion: "0.1", kind: "event", sessionRef: "session-1", sequence: 2, event: "surface-changed", surfaceRef: "surface-1", revision: "revision-2",
    }),
    accept("event-surface-closed", {
      schemaVersion: "0.1", kind: "event", sessionRef: "session-1", sequence: 3, event: "surface-closed", surfaceRef: "surface-1",
    }),
    accept("event-session-invalidated", {
      schemaVersion: "0.1", kind: "event", sessionRef: "session-1", sequence: 4, event: "session-invalidated",
    }),
    reject("reject-duplicate-key", '{"schemaVersion":"0.1","kind":"surface-list-request","kind":"surface-list-request","requestId":"r1","sessionRef":"s1"}'),
    reject("reject-escaped-duplicate-key", '{"schemaVersion":"0.1","kind":"surface-list-request","\\u006bind":"surface-list-request","requestId":"r1","sessionRef":"s1"}'),
    reject("reject-trailing-json", '{"schemaVersion":"0.1"}{}'),
    reject("reject-comment", '{/*comment*/"schemaVersion":"0.1"}'),
    reject("reject-truncated", '{"schemaVersion":"0.1"'),
    reject("reject-non-finite", '{"schemaVersion":"0.1","kind":"action-request","requestId":"r1","sessionRef":"s1","surfaceRef":"s1","revision":"1","elementId":"e1","action":"read","input":1e400}'),
    reject("reject-lone-surrogate", '{"schemaVersion":"0.1","kind":"action-request","requestId":"r1","sessionRef":"s1","surfaceRef":"s1","revision":"1","elementId":"e1","action":"read","input":"\\uD800"}'),
    reject("reject-unknown-kind", encode({ schemaVersion: "0.1", kind: "shell-command", requestId: "r1", sessionRef: "s1" })),
    reject("reject-unknown-version", encode({ schemaVersion: "9.9", kind: "surface-list-request", requestId: "r1", sessionRef: "s1" })),
    reject("reject-unknown-capability", encode({ schemaVersion: "0.1", kind: "client-hello", requestId: "r1", supportedVersions: ["0.1"], capabilities: ["shell"], requiredCapabilities: [] })),
    reject("reject-required-capability-not-offered", encode({ schemaVersion: "0.1", kind: "client-hello", requestId: "r1", supportedVersions: ["0.1"], capabilities: [], requiredCapabilities: ["actions"] })),
    reject("reject-snapshot-surface-substitution", encode({ schemaVersion: "0.1", kind: "snapshot-response", requestId: "r1", sessionRef: "s1", surfaceRef: "surface-other", snapshot })),
    reject("reject-delta-surface-substitution", encode({ schemaVersion: "0.1", kind: "delta-response", requestId: "r1", sessionRef: "s1", surfaceRef: "surface-other", delta })),
    reject("reject-caller-authority", encode({ schemaVersion: "0.1", kind: "action-request", requestId: "r1", sessionRef: "s1", surfaceRef: "surface-1", revision: "1", elementId: "e1", action: "read", risk: "destructive", processId: 42 })),
    reject("reject-untrusted-error-text", encode({ schemaVersion: "0.1", kind: "request-error", requestId: "r1", sessionRef: "s1", code: "internal_error", message: "raw platform diagnostic" })),
    reject("reject-event-extra-field", encode({ schemaVersion: "0.1", kind: "event", sessionRef: "s1", sequence: 1, event: "surface-closed", surfaceRef: "surface-1", revision: "not-allowed" })),
    {
      id: "reject-malformed-utf8",
      encoding: "hex",
      payload: "c328",
      expected: { status: "rejected", error: "Invalid native protocol frame" },
    },
    {
      id: "reject-utf8-bom",
      encoding: "hex",
      payload: `efbbbf${toHex(encode({ schemaVersion: "0.1", kind: "surface-list-request", requestId: "r1", sessionRef: "s1" }))}`,
      expected: { status: "rejected", error: "Invalid native protocol frame" },
    },
    {
      id: "reject-oversized-frame",
      encoding: "repeat-utf8",
      prefix: "",
      unit: "x",
      count: 1_048_577,
      suffix: "",
      expected: { status: "rejected", error: "Invalid native protocol frame" },
    },
    reject("reject-excessive-depth", `${"[".repeat(66)}null${"]".repeat(66)}`),
  ];
  cases.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  return { schemaVersion: "0.1", kind: "native-protocol-fixture-corpus", cases };
}

export function decodeNativeProtocolFixtureCase(fixture) {
  if (fixture.encoding === "utf8") return new TextEncoder().encode(fixture.payload);
  if (fixture.encoding === "hex") {
    if (!/^(?:[a-f0-9]{2})+$/u.test(fixture.payload)) {
      throw new TypeError("Invalid native protocol hex fixture");
    }
    const bytes = fixture.payload.match(/[a-f0-9]{2}/gu) ?? [];
    return Uint8Array.from(bytes, (value) => Number.parseInt(value, 16));
  }
  if (fixture.encoding === "repeat-utf8") {
    return new TextEncoder().encode(
      `${fixture.prefix}${fixture.unit.repeat(fixture.count)}${fixture.suffix}`,
    );
  }
  throw new TypeError("Invalid native protocol fixture encoding");
}
