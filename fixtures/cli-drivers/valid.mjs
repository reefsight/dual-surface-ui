let calls = 0;

export async function createDualSurfaceCliDriver() {
  const allowedEnvironment = new Set(["DUAL_SURFACE_CLI_CHILD", "TZ", "LANG", "LC_ALL", "SystemRoot"]);
  if (Object.keys(process.env).some((key) => !allowedEnvironment.has(key))) {
    throw new Error("ambient environment inherited");
  }
  return {
    schemaVersion: "0.1",
    kind: "agent-cli-driver",
    driverId: "fixture-driver",
    record({ signal, emitAudit }) {
      if (!Object.isFrozen(signal)) throw new Error("signal not frozen");
      process.stdout.write("driver output is discarded");
      emitAudit({
        schemaVersion: "0.1",
        event: "surface_observed",
        correlationId: "correlation-1",
        surfaceId: "surface-1",
        revision: "revision-1",
        sequence: 1,
        timestamp: "2026-09-20T00:00:00.000Z",
        durationMs: 0,
        outcome: "observed",
      });
    },
    async evaluateCase(request, { signal }) {
      calls += 1;
      if (!Object.isFrozen(request) || !Object.isFrozen(request.input) || !Object.isFrozen(signal)) {
        throw new Error("request not detached and frozen");
      }
      return { status: "observed", observations: { answer: request.input, calls } };
    },
  };
}
