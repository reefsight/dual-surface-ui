export function createDualSurfaceCliDriver() {
  return {
    schemaVersion: "0.1",
    kind: "agent-cli-driver",
    driverId: "timeout-driver",
    evaluateCase() {
      return new Promise(() => {});
    },
  };
}
