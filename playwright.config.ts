import { defineConfig, devices } from "@playwright/test";

const primaryPort = Number(process.env.BROWSER_FIXTURE_PORT ?? "43991");
const primaryOrigin = `http://127.0.0.1:${primaryPort}`;

export default defineConfig({
  testDir: "./e2e/browser",
  outputDir: "./test-results/browser",
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  workers: 3,
  reporter: "line",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: primaryOrigin,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npm run build && node scripts/browser-fixture-server.mjs`,
    url: `${primaryOrigin}/__health`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
