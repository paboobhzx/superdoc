// @ts-check
const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL:     process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3200",
    trace:       "on-first-retry",
    screenshot:  "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // Run "mobile" tests on Chromium to avoid requiring WebKit in local dev/CI.
    { name: "mobile", use: { ...devices["iPhone 14"], browserName: "chromium" } },
  ],
  webServer: process.env.CI ? undefined : {
    command: "npm run dev -- --host 127.0.0.1 --port 3200 --strictPort",
    port:    3200,
    reuseExistingServer: false,
    env: {
      // Ensures the app boots with an API base URL even when running against mocked routes.
      VITE_API_URL: process.env.VITE_API_URL || "http://127.0.0.1:9999",
      VITE_ENV: process.env.VITE_ENV || "dev",
      // Enables AuthContext in E2E without depending on real Cognito.
      VITE_COGNITO_USER_POOL_ID: process.env.VITE_COGNITO_USER_POOL_ID || "us-east-1_dummy",
      VITE_COGNITO_CLIENT_ID: process.env.VITE_COGNITO_CLIENT_ID || "dummyclientid",
    },
  },
});
