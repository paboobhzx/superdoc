// @ts-check
const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL:     process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000",
    trace:       "on-first-retry",
    screenshot:  "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile",   use: { ...devices["iPhone 14"] } },
  ],
  webServer: process.env.CI ? undefined : {
    command: "npm run dev",
    port:    3000,
    reuseExistingServer: true,
  },
});
