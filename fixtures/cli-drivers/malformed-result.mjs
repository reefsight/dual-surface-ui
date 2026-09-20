export function createDualSurfaceCliDriver() {
  return {
    schemaVersion: "0.1",
    kind: "agent-cli-driver",
    driverId: "malformed-driver",
    async evaluateCase() {
      return { status: "observed", observations: { answer: 1 }, extra: true };
    },
  };
}
