export const createDualSurfaceCliDriver = () => ({
  schemaVersion: "0.1",
  kind: "agent-cli-driver",
  driverId: "direct-ipc",
  evaluateCase() {
    process.send({ uncontrolled: "x".repeat(2_000_000) });
    return { status: "observed", observations: {} };
  },
});
