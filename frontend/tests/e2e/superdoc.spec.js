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
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}

test.describe("Home", () => {
  test("loads the upload-first workbench without console errors", async ({ page }) => {
    const errors = trapPageErrors(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    expect(errors).toHaveLength(0);
    await expect(page.getByText("SuperDoc")).toBeVisible();
    await expect(page.getByText("file workbench.")).toBeVisible();
    await expect(page.getByText("Drop your file here")).toBeVisible();
  });

  test("shows current format pills", async ({ page }) => {
    await page.goto("/");
    for (const fmt of ["PDF", "DOCX", "XLSX", "PNG"]) {
      await expect(page.getByText(fmt, { exact: true }).first()).toBeVisible();
    }
  });
});

test.describe("Navigation and support", () => {
  test("header logo links home", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("link", { name: "SuperDoc home" }).click();
    await expect(page).toHaveURL(urlEndsWith("/"));
  });

  test("support link reaches the internal support page", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Support" }).click();
    await expect(page).toHaveURL(/\/support$/);
    await expect(page.getByText("Support SuperDoc without locking the core product.")).toBeVisible();
  });
});

test.describe("Theme", () => {
  test("defaults to azure and toggles to dark", async ({ page }) => {
    await page.goto("/");
    await expect.poll(async () => page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("azure");
    await page.getByRole("button", { name: /Switch to Dark mode/i }).click();
    await expect.poll(async () => page.evaluate(() => localStorage.getItem("superdoc-theme"))).toBe("dark");
    await expect.poll(async () => page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");
  });

  test("persists theme after reload", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Switch to Dark mode/i }).click();
    await page.reload();
    await expect.poll(async () => page.evaluate(() => localStorage.getItem("superdoc-theme"))).toBe("dark");
  });
});

test.describe("Auth", () => {
  test("login renders without app shell", async ({ page }) => {
    await page.goto("/auth/login");
    await expect(page.locator("header")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Create free account" })).toBeVisible();
  });

  test("register links to support page", async ({ page }) => {
    await page.goto("/auth/register");
    await page.getByRole("link", { name: /support plan/i }).click();
    await expect(page).toHaveURL(/\/support$/);
  });

  test("confirm page shows six OTP inputs", async ({ page }) => {
    await page.goto("/auth/confirm");
    await expect(page.locator('input[maxlength="1"]')).toHaveCount(6);
  });
});

test.describe("Settings and dashboard", () => {
  test("settings shows theme and language selectors", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText("Theme")).toBeVisible();
    await expect(page.getByDisplayValue("Azure Blue")).toBeVisible();
    await expect(page.getByDisplayValue("English (US)")).toBeVisible();
  });

  test("dashboard anonymous state shows session-only copy", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByText("Files shown here are only available during this browser session.")).toBeVisible();
  });
});
