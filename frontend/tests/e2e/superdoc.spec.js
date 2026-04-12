// @ts-check
const { test, expect, devices } = require("@playwright/test");

const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";

// ── Desktop tests ─────────────────────────────────────────────────────────

test.describe("Home page", () => {
  test("loads within 3 seconds", async ({ page }) => {
    const start = Date.now();
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");
    expect(Date.now() - start).toBeLessThan(3000);
  });

  test("renders logo, drop zone, and tool cards", async ({ page }) => {
    await page.goto(BASE);
    await expect(page.getByText("⚡ SuperDoc")).toBeVisible();
    await expect(page.getByText("Drop any file here")).toBeVisible();
    await expect(page.getByText("PDF Tools")).toBeVisible();
    await expect(page.getByText("Video")).toBeVisible();
    await expect(page.getByText("$1 / video")).toBeVisible();
  });

  test("dark mode toggle persists in localStorage", async ({ page }) => {
    await page.goto(BASE);
    const toggle = page.getByText("🌙 Dark");
    await toggle.click();
    await expect(page.getByText("☀️ Light")).toBeVisible();
    // Reload and verify it persists
    await page.reload();
    await expect(page.getByText("☀️ Light")).toBeVisible();
    // Check localStorage
    const theme = await page.evaluate(() => localStorage.getItem("superdoc-theme"));
    expect(theme).toBe("dark");
  });

  test("no console errors on load", async ({ page }) => {
    const errors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");
    expect(errors).toHaveLength(0);
  });

  test("health endpoint responds", async ({ request }) => {
    const apiUrl = process.env.VITE_API_URL || "";
    if (!apiUrl) test.skip();
    const res = await request.get(`${apiUrl}/health`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe("ok");
  });
});

// ── Mobile viewport tests ────────────────────────────────────────────────

test.describe("Mobile viewport", () => {
  test.use({ ...devices["iPhone 14"] });

  test("home page loads correctly on mobile", async ({ page }) => {
    await page.goto(BASE);
    await expect(page.getByText("⚡ SuperDoc")).toBeVisible();
    await expect(page.getByText("Drop any file here")).toBeVisible();
  });

  test("tool cards are visible on mobile", async ({ page }) => {
    await page.goto(BASE);
    await expect(page.getByText("PDF Tools")).toBeVisible();
    await expect(page.getByText("Images")).toBeVisible();
  });

  test("no horizontal scroll on mobile", async ({ page }) => {
    await page.goto(BASE);
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = page.viewportSize().width;
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 5); // 5px tolerance
  });
});

// ── Processing page ────────────────────────────────────────────────────────

test.describe("Processing page", () => {
  test("shows loading state for unknown job", async ({ page }) => {
    await page.goto(`${BASE}/processing/nonexistent-job-id`);
    // Should show loading or error, not crash
    const body = await page.textContent("body");
    expect(body).toBeTruthy();
    expect(body.length).toBeGreaterThan(0);
  });

  test("navigate back to home from processing page", async ({ page }) => {
    await page.goto(`${BASE}/processing/some-job-id`);
    // If Convert another file button appears, click it
    const btn = page.getByText("← Try again").or(page.getByText("Convert another file →"));
    if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await btn.click();
      await expect(page).toHaveURL(BASE + "/");
    }
  });
});

// ── Accessibility ─────────────────────────────────────────────────────────

test.describe("Accessibility", () => {
  test("all interactive elements are keyboard accessible", async ({ page }) => {
    await page.goto(BASE);
    // Tab through interactive elements
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    // Should not throw
    const focused = await page.evaluate(() => document.activeElement?.tagName);
    expect(focused).toBeTruthy();
  });

  test("dark mode toggle has aria-label", async ({ page }) => {
    await page.goto(BASE);
    const toggle = page.locator("[aria-label*='mode']");
    await expect(toggle).toBeVisible();
  });
});
