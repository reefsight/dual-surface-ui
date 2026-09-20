export const createDualSurfaceCliDriver = () => ({
  schemaVersion: "0.1",
  kind: "agent-cli-driver",
  driverId: "ignore-sigterm",
  async evaluateCase() {
    process.on("SIGTERM", () => {});
    await new Promise(() => {});
  },
});
