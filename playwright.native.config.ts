import { defineConfig } from "@playwright/test";

const port = Number(process.env.BROWSER_FIXTURE_PORT ?? "43991");

export default defineConfig({
  testDir: "./e2e/native",
  outputDir: "./test-results/native-webmcp",
  forbidOnly: true,
  fullyParallel: false,
  reporter: "line",
  retries: 0,
  timeout: 120_000,
  workers: 1,
  webServer: {
    command: "npm run build && node scripts/browser-fixture-server.mjs",
    reuseExistingServer: true,
    timeout: 120_000,
    url: `http://127.0.0.1:${port}/__health`,
  },
});
