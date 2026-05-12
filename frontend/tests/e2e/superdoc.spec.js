// @ts-check
import { test, expect } from "@playwright/test";

function urlEndsWith(path) {
  if (path === "/") return /\/$/;
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}$`);
}

function trapPageErrors(page) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err?.message || err)));
  page.on("console", (msg) => {
    const text = msg.text();
    if (msg.type() === "error" && !/401 \(Unauthorized\)/i.test(text)) errors.push(text);
  });
  return errors;
}

async function mockAnonymousSession(page) {
  const apiBase = process.env.VITE_API_URL || "http://127.0.0.1:9999";
  await page.route(`${apiBase}/auth/me`, async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "Unauthorized" }),
    });
  });
  await page.route(`${apiBase}/users/me/files**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ jobs: [] }),
    });
  });
}

test.describe("Home", () => {
  test("loads the upload-first workbench without console errors", async ({ page }) => {
    await mockAnonymousSession(page);
    const errors = trapPageErrors(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    expect(errors).toHaveLength(0);
    await expect(page.getByRole("heading", { name: "SuperDoc file workbench." })).toBeVisible();
    await expect(page.getByText("Drop your file here")).toBeVisible();
  });

  test("shows current format pills", async ({ page }) => {
    await mockAnonymousSession(page);
    await page.goto("/");
    for (const fmt of ["PDF", "DOCX", "XLSX", "PNG"]) {
      await expect(page.getByText(fmt, { exact: true }).first()).toBeVisible();
    }
  });
});

test.describe("Navigation and support", () => {
  test("header logo links home", async ({ page }) => {
    await mockAnonymousSession(page);
    await page.goto("/settings");
    await page.getByRole("link", { name: "SuperDoc home" }).click();
    await expect(page).toHaveURL(urlEndsWith("/"));
  });

  test("support link reaches the internal support page", async ({ page }) => {
    await mockAnonymousSession(page);
    await page.goto("/");
    await page.getByRole("link", { name: "Support" }).click();
    await expect(page).toHaveURL(/\/support$/);
    await expect(page.getByText("Support SuperDoc without locking the core product.")).toBeVisible();
  });
});

test.describe("Theme", () => {
  test("defaults to azure and cycles to next theme", async ({ page }) => {
    await mockAnonymousSession(page);
    await page.goto("/");
    await expect.poll(async () => page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("azure");
    await page.getByRole("button", { name: /Switch to/i }).click();
    // azure is index 0 → next is orange (index 1)
    await expect.poll(async () => page.evaluate(() => localStorage.getItem("superdoc-theme"))).toBe("orange");
    await expect.poll(async () => page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("orange");
  });

  test("persists theme after reload", async ({ page }) => {
    await mockAnonymousSession(page);
    await page.goto("/");
    await page.getByRole("button", { name: /Switch to/i }).click();
    await page.reload();
    // azure → orange
    await expect.poll(async () => page.evaluate(() => localStorage.getItem("superdoc-theme"))).toBe("orange");
  });
});

test.describe("Auth", () => {
  test("login renders without app shell", async ({ page }) => {
    await mockAnonymousSession(page);
    await page.goto("/auth/login");
    await expect(page.locator("header")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Create free account" })).toBeVisible();
  });

  test("register links to support page", async ({ page }) => {
    await mockAnonymousSession(page);
    await page.goto("/auth/register");
    await page.getByRole("link", { name: /support plan/i }).click();
    await expect(page).toHaveURL(/\/support$/);
  });

  test("confirm page shows six OTP inputs", async ({ page }) => {
    await mockAnonymousSession(page);
    await page.goto("/auth/confirm");
    await expect(page.locator('input[maxlength="1"]')).toHaveCount(6);
  });
});

test.describe("Settings and dashboard", () => {
  test("settings shows theme and language selectors", async ({ page }) => {
    await mockAnonymousSession(page);
    await page.goto("/settings");
    await expect(page.getByText("Theme")).toBeVisible();
    await expect(page.getByRole("combobox").nth(0)).toHaveValue("azure");
    await expect(page.getByRole("combobox").nth(1)).toHaveValue("en-US");
  });

  test("dashboard anonymous state shows session-only copy", async ({ page }) => {
    await mockAnonymousSession(page);
    await page.goto("/dashboard");
    await expect(page.getByText("Files shown here are only available during this browser session.")).toBeVisible();
  });
});
