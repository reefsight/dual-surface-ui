export function createDualSurfaceCliDriver() {
  return {
    schemaVersion: "0.1",
    kind: "agent-cli-driver",
    driverId: "secret-output-driver",
    async evaluateCase() {
      process.stderr.write("authorization: Bearer abcdefghijklmnop");
      return { status: "environment_unavailable" };
    },
  };
}
