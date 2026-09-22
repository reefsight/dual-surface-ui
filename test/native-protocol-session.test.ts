import { describe, expect, it } from "vitest";

import {
  NATIVE_PROTOCOL_LIMITS,
  NativeProtocolSessionError,
  NativeProtocolSessionVerifier,
  type NativeProtocolCapability,
} from "../src/native-protocol/index.js";

const allCapabilities = [
  "actions",
  "cancellation",
  "deltas",
  "events",
  "snapshots",
  "surface-catalog",
] as const;

const activate = (
  capabilities: readonly NativeProtocolCapability[] = allCapabilities,
): NativeProtocolSessionVerifier => {
  const verifier = new NativeProtocolSessionVerifier();
  verifier.accept({
    schemaVersion: "0.1",
    kind: "client-hello",
    requestId: "hello-1",
    supportedVersions: ["0.1"],
    capabilities: allCapabilities,
    requiredCapabilities: capabilities,
  });
  verifier.accept({
    schemaVersion: "0.1",
    kind: "server-hello",
    requestId: "hello-1",
    sessionRef: "session-1",
    protocolVersion: "0.1",
    capabilities: [...capabilities].sort(),
    limits: NATIVE_PROTOCOL_LIMITS,
  });
  return verifier;
};

const catalog = (verifier: NativeProtocolSessionVerifier): void => {
  verifier.accept({
    schemaVersion: "0.1",
    kind: "surface-list-request",
    requestId: "list-1",
    sessionRef: "session-1",
  });
  verifier.accept({
    schemaVersion: "0.1",
    kind: "surface-list-response",
    requestId: "list-1",
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
};

const actionRequest = (overrides: Record<string, unknown> = {}) => ({
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

const actionResponse = (overrides: Record<string, unknown> = {}) => ({
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
    output: { saved: true },
  },
  ...overrides,
});

const expectSessionError = (
  action: () => unknown,
  code: NativeProtocolSessionError["code"],
): void => {
  try {
    action();
    throw new Error("Expected native protocol session error");
  } catch (error) {
    expect(error).toBeInstanceOf(NativeProtocolSessionError);
    expect((error as NativeProtocolSessionError).code).toBe(code);
  }
};

describe("native protocol session verifier", () => {
  it("requires an exact handshake before discovery", () => {
    const verifier = new NativeProtocolSessionVerifier();
    expect(verifier.state.phase).toBe("awaiting-client-hello");
    expect(Object.isFrozen(verifier.state)).toBe(true);
    expectSessionError(() => verifier.accept({
      schemaVersion: "0.1",
      kind: "surface-list-request",
      requestId: "list-1",
      sessionRef: "session-1",
    }), "invalid_message");
    expect(verifier.state).toMatchObject({ phase: "closed", sessionRef: null });
  });

  it("rejects server capability escalation during negotiation", () => {
    const verifier = new NativeProtocolSessionVerifier();
    verifier.accept({
      schemaVersion: "0.1",
      kind: "client-hello",
      requestId: "hello-1",
      supportedVersions: ["0.1"],
      capabilities: ["snapshots"],
      requiredCapabilities: ["snapshots"],
    });
    expectSessionError(() => verifier.accept({
      schemaVersion: "0.1",
      kind: "server-hello",
      requestId: "hello-1",
      sessionRef: "session-1",
      protocolVersion: "0.1",
      capabilities: ["actions", "snapshots"],
      limits: NATIVE_PROTOCOL_LIMITS,
    }), "invalid_message");
  });

  it("gates each request family by negotiated capability", () => {
    const verifier = activate(["surface-catalog"]);
    catalog(verifier);
    expectSessionError(() => verifier.accept({
      schemaVersion: "0.1",
      kind: "snapshot-request",
      requestId: "snapshot-1",
      sessionRef: "session-1",
      surfaceRef: "surface-1",
    }), "capability_not_negotiated");
  });

  it("binds responses to active request IDs and kinds", () => {
    const verifier = activate();
    verifier.accept({
      schemaVersion: "0.1",
      kind: "surface-list-request",
      requestId: "list-1",
      sessionRef: "session-1",
    });
    expectSessionError(() => verifier.accept({
      schemaVersion: "0.1",
      kind: "cancel-response",
      requestId: "list-1",
      sessionRef: "session-1",
      targetRequestId: "other-1",
      disposition: "accepted",
    }), "invalid_message");
  });

  it("tracks catalog and authoritative action revision transitions", () => {
    const verifier = activate();
    catalog(verifier);
    expect(verifier.state.surfaces).toBe(1);
    verifier.accept(actionRequest());
    expect(verifier.state.activeRequests).toBe(1);
    verifier.accept(actionResponse());
    expect(verifier.state).toMatchObject({ activeRequests: 0, completedRequests: 2 });
    expectSessionError(() => verifier.accept(actionRequest({ requestId: "action-stale" })), "stale_revision");
  });

  it("rejects cross-session and unavailable-surface requests", () => {
    const wrongSession = activate();
    expectSessionError(() => wrongSession.accept({
      schemaVersion: "0.1",
      kind: "surface-list-request",
      requestId: "list-1",
      sessionRef: "session-old",
    }), "invalid_session");

    const unavailable = activate();
    expectSessionError(() => unavailable.accept({
      schemaVersion: "0.1",
      kind: "snapshot-request",
      requestId: "snapshot-1",
      sessionRef: "session-1",
      surfaceRef: "surface-missing",
    }), "surface_unavailable");
  });

  it("requires delta base correlation before advancing revision", () => {
    const verifier = activate();
    catalog(verifier);
    verifier.accept({
      schemaVersion: "0.1",
      kind: "delta-request",
      requestId: "delta-1",
      sessionRef: "session-1",
      surfaceRef: "surface-1",
      baseRevision: "revision-1",
      baseDigest: `sha256:${"a".repeat(64)}`,
    });
    expectSessionError(() => verifier.accept({
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
        baseDigest: `sha256:${"b".repeat(64)}`,
        targetDigest: `sha256:${"c".repeat(64)}`,
        target: { title: "Fixture", url: "app://fixture", generatedAt: "2026-09-22T00:00:01.000Z", focusedElementId: null, capabilities: [] },
        nodeUpserts: [],
        removedNodeIds: [],
      },
    }), "resync_required");
  });

  it("allows cancellation only for an active request in the same session", () => {
    const verifier = activate();
    verifier.accept({ schemaVersion: "0.1", kind: "surface-list-request", requestId: "list-1", sessionRef: "session-1" });
    verifier.accept({ schemaVersion: "0.1", kind: "cancel-request", requestId: "cancel-1", sessionRef: "session-1", targetRequestId: "list-1" });
    verifier.accept({ schemaVersion: "0.1", kind: "cancel-response", requestId: "cancel-1", sessionRef: "session-1", targetRequestId: "list-1", disposition: "accepted" });
    expect(verifier.state).toMatchObject({ activeRequests: 1, completedRequests: 1 });
  });

  it("requires contiguous event sequences and closes on invalidation", () => {
    const gap = activate();
    expectSessionError(() => gap.accept({
      schemaVersion: "0.1", kind: "event", sessionRef: "session-1", sequence: 2, event: "catalog-changed",
    }), "resync_required");

    const invalidated = activate();
    invalidated.accept({
      schemaVersion: "0.1", kind: "event", sessionRef: "session-1", sequence: 1, event: "session-invalidated",
    });
    expect(invalidated.state).toMatchObject({ phase: "closed", sessionRef: null, lastEventSequence: 0 });
  });

  it("blocks new stateful requests after a catalog-change hint", () => {
    const verifier = activate();
    catalog(verifier);
    verifier.accept({
      schemaVersion: "0.1", kind: "event", sessionRef: "session-1", sequence: 1, event: "catalog-changed",
    });
    expect(verifier.state.catalogStale).toBe(true);
    expectSessionError(() => verifier.accept(actionRequest()), "resync_required");
  });

  it("rejects catalog refresh while an older stateful request remains active", () => {
    const verifier = activate();
    catalog(verifier);
    verifier.accept(actionRequest());
    verifier.accept({
      schemaVersion: "0.1", kind: "event", sessionRef: "session-1", sequence: 1, event: "catalog-changed",
    });
    verifier.accept({ schemaVersion: "0.1", kind: "surface-list-request", requestId: "list-2", sessionRef: "session-1" });
    expectSessionError(() => verifier.accept({
      schemaVersion: "0.1",
      kind: "surface-list-response",
      requestId: "list-2",
      sessionRef: "session-1",
      surfaces: [],
    }), "resync_required");
  });

  it("correlates event revisions with an in-flight action response", () => {
    const accepted = activate();
    catalog(accepted);
    accepted.accept(actionRequest());
    accepted.accept({
      schemaVersion: "0.1", kind: "event", sessionRef: "session-1", sequence: 1,
      event: "surface-changed", surfaceRef: "surface-1", revision: "revision-2",
    });
    accepted.accept(actionResponse());
    expect(accepted.state).toMatchObject({ phase: "active", completedRequests: 2 });

    const rejected = activate();
    catalog(rejected);
    rejected.accept(actionRequest());
    rejected.accept({
      schemaVersion: "0.1", kind: "event", sessionRef: "session-1", sequence: 1,
      event: "surface-changed", surfaceRef: "surface-1", revision: "revision-other",
    });
    expectSessionError(() => rejected.accept(actionResponse()), "resync_required");
  });

  it("permits only identical keyed replay with the recorded response", () => {
    const verifier = activate();
    catalog(verifier);
    const request = actionRequest();
    const response = actionResponse();
    verifier.accept(request);
    verifier.accept(response);
    verifier.accept({ input: { confirmed: true }, ...request });
    verifier.accept({ outcome: { ...(response.outcome as object) }, ...response });
    expect(verifier.state.completedRequests).toBe(2);
    expectSessionError(() => verifier.accept(actionRequest({ input: { confirmed: false } })), "request_conflict");
  });

  it("rejects a changed outcome during keyed replay", () => {
    const verifier = activate();
    catalog(verifier);
    verifier.accept(actionRequest());
    verifier.accept(actionResponse());
    verifier.accept(actionRequest());
    expectSessionError(() => verifier.accept(actionResponse({
      outcome: {
        ...(actionResponse().outcome as object),
        output: { saved: false },
      },
    })), "request_conflict");
  });

  it("bounds the number of active requests", () => {
    const verifier = activate(["surface-catalog"]);
    for (let index = 0; index < 128; index += 1) {
      verifier.accept({
        schemaVersion: "0.1",
        kind: "surface-list-request",
        requestId: `list-${index}`,
        sessionRef: "session-1",
      });
    }
    expectSessionError(() => verifier.accept({
      schemaVersion: "0.1",
      kind: "surface-list-request",
      requestId: "list-overflow",
      sessionRef: "session-1",
    }), "resource_limit");
  });
});
