export function createDualSurfaceCliDriver() {
  return {
    schemaVersion: "0.1",
    kind: "agent-cli-driver",
    driverId: "oversized-output-driver",
    async evaluateCase() {
      process.stdout.write("x".repeat(70_000));
      return { status: "environment_unavailable" };
    },
  };
}
