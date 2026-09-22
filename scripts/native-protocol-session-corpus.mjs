const LIMITS = {
  frameBytes: 1_048_576,
  snapshotBytes: 1_048_576,
  deltaBytes: 524_288,
  actionResultBytes: 262_144,
  errorMessageCharacters: 500,
  surfaces: 128,
  actionsPerSurface: 128,
};

const ALL_CAPABILITIES = [
  "actions", "cancellation", "deltas", "events", "snapshots", "surface-catalog",
];
const digest = (character) => `sha256:${character.repeat(64)}`;
const hello = (capabilities = ALL_CAPABILITIES) => ({
  schemaVersion: "0.1",
  kind: "client-hello",
  requestId: "hello-1",
  supportedVersions: ["0.1"],
  capabilities,
  requiredCapabilities: capabilities,
});
const serverHello = (capabilities = ALL_CAPABILITIES) => ({
  schemaVersion: "0.1",
  kind: "server-hello",
  requestId: "hello-1",
  sessionRef: "session-1",
  protocolVersion: "0.1",
  capabilities,
  limits: LIMITS,
});
const handshake = (capabilities = ALL_CAPABILITIES) => [
  hello(capabilities), serverHello(capabilities),
];
const listRequest = (requestId = "list-1") => ({
  schemaVersion: "0.1", kind: "surface-list-request", requestId, sessionRef: "session-1",
});
const listResponse = (requestId = "list-1") => ({
  schemaVersion: "0.1",
  kind: "surface-list-response",
  requestId,
  sessionRef: "session-1",
  surfaces: [{
    surfaceRef: "surface-1",
    revision: "revision-1",
    title: "Fixture",
    application: "Fixture App",
    capabilities: ["actions", "deltas", "snapshots"],
    actionCount: 1,
  }],
});
const catalog = () => [listRequest(), listResponse()];
const actionRequest = (overrides = {}) => ({
  schemaVersion: "0.1",
  kind: "action-request",
  requestId: "action-1",
  sessionRef: "session-1",
  surfaceRef: "surface-1",
  revision: "revision-1",
  elementId: "button-1",
  action: "click",
  input: { confirmed: true },
  idempotencyKey: "idem-1",
  ...overrides,
});
const actionResponse = (output = { saved: true }) => ({
  schemaVersion: "0.1",
  kind: "action-response",
  requestId: "action-1",
  sessionRef: "session-1",
  surfaceRef: "surface-1",
  outcome: {
    schemaVersion: "0.1",
    surfaceId: "surface-1",
    previousRevision: "revision-1",
    revision: "revision-2",
    status: "succeeded",
    action: "click",
    targetId: "button-1",
    targetPresent: false,
    output,
  },
});
const deltaRequest = () => ({
  schemaVersion: "0.1",
  kind: "delta-request",
  requestId: "delta-1",
  sessionRef: "session-1",
  surfaceRef: "surface-1",
  baseRevision: "revision-1",
  baseDigest: digest("a"),
});
const deltaResponse = (baseDigest = digest("a")) => ({
  schemaVersion: "0.1",
  kind: "delta-response",
  requestId: "delta-1",
  sessionRef: "session-1",
  surfaceRef: "surface-1",
  delta: {
    schemaVersion: "0.1",
    kind: "agent-snapshot-delta",
    surfaceId: "surface-1",
    baseRevision: "revision-1",
    revision: "revision-2",
    baseDigest,
    targetDigest: digest("b"),
    target: {
      title: "Fixture",
      url: "app://fixture",
      generatedAt: "2026-09-22T00:00:01.000Z",
      focusedElementId: null,
      capabilities: [],
    },
    nodeUpserts: [],
    removedNodeIds: [],
  },
});

const activeState = (overrides = {}) => ({
  phase: "active",
  sessionRef: "session-1",
  capabilities: ALL_CAPABILITIES,
  activeRequests: 0,
  completedRequests: 0,
  surfaces: 0,
  lastEventSequence: 0,
  catalogStale: false,
  ...overrides,
});
const closedState = {
  phase: "closed",
  sessionRef: null,
  capabilities: [],
  activeRequests: 0,
  completedRequests: 0,
  surfaces: 0,
  lastEventSequence: 0,
  catalogStale: false,
};
const accept = (id, messages, state) => ({
  id, messages, expected: { status: "accepted", state },
});
const reject = (id, messages, code) => ({
  id,
  messages,
  expected: { status: "rejected", code, failedAt: messages.length - 1, state: closedState },
});

export const createNativeProtocolSessionFixtureCorpus = () => ({
  schemaVersion: "0.1",
  kind: "native-protocol-session-fixture-corpus",
  cases: [
    accept("accept-action", [...handshake(), ...catalog(), actionRequest(), actionResponse()], activeState({ completedRequests: 2, surfaces: 1 })),
    accept("accept-cancellation", [...handshake(), listRequest(), {
      schemaVersion: "0.1", kind: "cancel-request", requestId: "cancel-1", sessionRef: "session-1", targetRequestId: "list-1",
    }, {
      schemaVersion: "0.1", kind: "cancel-response", requestId: "cancel-1", sessionRef: "session-1", targetRequestId: "list-1", disposition: "accepted",
    }], activeState({ activeRequests: 1, completedRequests: 1 })),
    accept("accept-catalog", [...handshake(), ...catalog()], activeState({ completedRequests: 1, surfaces: 1 })),
    accept("accept-delta", [...handshake(), ...catalog(), deltaRequest(), deltaResponse()], activeState({ completedRequests: 2, surfaces: 1 })),
    accept("accept-event-invalidation", [...handshake(), {
      schemaVersion: "0.1", kind: "event", sessionRef: "session-1", sequence: 1, event: "session-invalidated",
    }], closedState),
    accept("accept-handshake", handshake(), activeState()),
    accept("accept-keyed-replay", [...handshake(), ...catalog(), actionRequest(), actionResponse(), actionRequest(), actionResponse()], activeState({ completedRequests: 2, surfaces: 1 })),
    reject("reject-cancel-missing-target", [...handshake(), {
      schemaVersion: "0.1", kind: "cancel-request", requestId: "cancel-1", sessionRef: "session-1", targetRequestId: "missing-1",
    }], "request_conflict"),
    reject("reject-catalog-stale-action", [...handshake(), ...catalog(), {
      schemaVersion: "0.1", kind: "event", sessionRef: "session-1", sequence: 1, event: "catalog-changed",
    }, actionRequest()], "resync_required"),
    reject("reject-delta-digest-mismatch", [...handshake(), ...catalog(), deltaRequest(), deltaResponse(digest("c"))], "resync_required"),
    reject("reject-event-sequence-gap", [...handshake(), {
      schemaVersion: "0.1", kind: "event", sessionRef: "session-1", sequence: 2, event: "catalog-changed",
    }], "resync_required"),
    reject("reject-keyed-replay-changed-request", [...handshake(), ...catalog(), actionRequest(), actionResponse(), actionRequest({ input: { confirmed: false } })], "request_conflict"),
    reject("reject-keyed-replay-changed-response", [...handshake(), ...catalog(), actionRequest(), actionResponse(), actionRequest(), actionResponse({ saved: false })], "request_conflict"),
    reject("reject-response-kind-mismatch", [...handshake(), listRequest(), {
      schemaVersion: "0.1", kind: "cancel-response", requestId: "list-1", sessionRef: "session-1", targetRequestId: "other-1", disposition: "accepted",
    }], "invalid_message"),
    reject("reject-server-capability-escalation", [hello(["snapshots"]), serverHello(["actions", "snapshots"])], "invalid_message"),
    reject("reject-stale-action-revision", [...handshake(), ...catalog(), actionRequest({ revision: "revision-old" })], "stale_revision"),
    reject("reject-unavailable-surface", [...handshake(), {
      schemaVersion: "0.1", kind: "snapshot-request", requestId: "snapshot-1", sessionRef: "session-1", surfaceRef: "surface-missing",
    }], "surface_unavailable"),
    reject("reject-unnegotiated-capability", [...handshake(["surface-catalog"]), ...catalog(), actionRequest()], "capability_not_negotiated"),
    reject("reject-wrong-session", [...handshake(), { ...listRequest(), sessionRef: "session-old" }], "invalid_session"),
  ].sort((left, right) => left.id.localeCompare(right.id)),
});
