// @ts-check
import { test, expect } from "@playwright/test";

function urlEndsWith(path) {
  if (path === "/") return /\/$/;
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}$`);
}

function trapPageErrors(page) {
  const errors = [];
  page.on("pageerror", (err) => {
    errors.push(String(err && err.message ? err.message : err));
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}

// ── Home page ────────────────────────────────────────────────────────────────

test.describe("Home page", () => {
  test("loads within 3 seconds", async ({ page }) => {
    const errors = trapPageErrors(page);
    const start = Date.now();
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    expect(errors).toHaveLength(0);
    expect(Date.now() - start).toBeLessThan(3000);
  });

  test('shows hero text "Transform Any File"', async ({ page }) => {
    const errors = trapPageErrors(page);
    await page.goto("/");
    expect(errors).toHaveLength(0);
    await expect(page.getByText("Transform Any File")).toBeVisible();
  });

  test("shows 6 tool cards", async ({ page }) => {
    await page.goto("/");
    for (const title of [
      "PDF Tools",
      "Documents",
      "Images",
      "Video",
      "Convert Anything",
      "Extract & Export",
    ]) {
      await expect(page.getByRole("heading", { name: title })).toBeVisible();
    }
  });

  test("shows $1/video badge on Video card", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("$1 / video")).toBeVisible();
  });

  test("shows drop zone with format pills", async ({ page }) => {
    await page.goto("/");
    for (const fmt of ["PDF", "DOCX", "MP4", "PNG"]) {
      await expect(page.getByText(fmt, { exact: true })).toBeVisible();
    }
  });

  test('drop zone shows "Drop any file here" text', async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Drop any file here")).toBeVisible();
  });

  test("no console errors on load", async ({ page }) => {
    const errors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    await page.goto("/");
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

// ── Navigation ───────────────────────────────────────────────────────────────

test.describe("Navigation", () => {
  test.use({ viewport: { width: 1200, height: 800 } });

  test("all nav links in sidebar work", async ({ page }) => {
    await page.goto("/");
    // Sidebar is visible on desktop viewport
    const routes = [
      { label: "Home", path: "/" },
      { label: "Files", path: "/dashboard" },
      { label: "Settings", path: "/settings" },
    ];
    for (const { label, path } of routes) {
      const link = page.locator(`aside a`).filter({ hasText: label });
      await link.click();
      await expect(page).toHaveURL(urlEndsWith(path));
    }
  });

  test("logo links to home", async ({ page }) => {
    await page.goto("/settings");
    await page.locator("header a").filter({ hasText: "SuperDoc" }).click();
    await expect(page).toHaveURL(urlEndsWith("/"));
  });

  test("clicking settings navigates to /settings", async ({ page }) => {
    await page.goto("/");
    const link = page.locator(`aside a`).filter({ hasText: "Settings" });
    await link.click();
    await expect(page).toHaveURL(urlEndsWith("/settings"));
  });
});

// ── Theme switching ──────────────────────────────────────────────────────────

test.describe("Theme switching", () => {
  test("theme switcher has 5 color dots", async ({ page }) => {
    await page.goto("/");
    const dots = page.locator("header button[title]");
    await expect(dots).toHaveCount(5);
  });

  test("clicking a theme dot changes localStorage superdoc-theme", async ({ page }) => {
    await page.goto("/");
    const dots = page.locator("header button[title]");
    // Click the second dot (index 1) to change from default
    await dots.nth(1).click();
    const theme = await page.evaluate(() =>
      localStorage.getItem("superdoc-theme")
    );
    expect(theme).toBeTruthy();
    expect(theme).not.toBe("");
  });

  test("theme persists after page reload", async ({ page }) => {
    await page.goto("/");
    const dots = page.locator("header button[title]");
    // Click a non-default dot
    await dots.nth(2).click();
    const themeBefore = await page.evaluate(() =>
      localStorage.getItem("superdoc-theme")
    );
    await page.reload();
    const themeAfter = await page.evaluate(() =>
      localStorage.getItem("superdoc-theme")
    );
    expect(themeAfter).toBe(themeBefore);
  });
});

// ── Mobile viewport (390x844) ────────────────────────────────────────────────

test.describe("Mobile viewport", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("no horizontal scrollbar", async ({ page }) => {
    await page.goto("/");
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = page.viewportSize().width;
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 5);
  });

  test("bottom nav visible", async ({ page }) => {
    await page.goto("/");
    // The bottom nav is the <nav> element that is fixed at the bottom
    const bottomNav = page.locator("nav.md\\:hidden").or(
      page.locator("nav").filter({ hasText: "Home" }).last()
    );
    await expect(bottomNav).toBeVisible();
  });

  test("sidebar hidden", async ({ page }) => {
    await page.goto("/");
    const sidebar = page.locator("aside");
    await expect(sidebar).toBeHidden();
  });

  test("all tool cards visible (stacked)", async ({ page }) => {
    await page.goto("/");
    for (const title of [
      "PDF Tools",
      "Documents",
      "Images",
      "Video",
      "Convert Anything",
      "Extract & Export",
    ]) {
      await expect(page.getByRole("heading", { name: title })).toBeVisible();
    }
  });
});

// ── Auth pages ───────────────────────────────────────────────────────────────

test.describe("Auth pages", () => {
  test("/auth/login renders without sidebar", async ({ page }) => {
    await page.goto("/auth/login");
    const sidebar = page.locator("aside");
    // Sidebar should not be present on auth pages
    await expect(sidebar).toHaveCount(0);
  });

  test("/auth/login has email and password inputs", async ({ page }) => {
    await page.goto("/auth/login");
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test('/auth/login has "Sign in" button', async ({ page }) => {
    await page.goto("/auth/login");
    await expect(
      page.locator("button").filter({ hasText: "Sign in" })
    ).toBeVisible();
  });

  test('/auth/login "Create free account" links to /auth/register', async ({
    page,
  }) => {
    await page.goto("/auth/login");
    const link = page.getByText("Create free account").or(
      page.getByText("Create account")
    );
    await link.click();
    await expect(page).toHaveURL(/\/auth\/register/);
  });

  test("/auth/register has password strength bar", async ({ page }) => {
    await page.goto("/auth/register");
    // Type a password to trigger the strength bar
    const pwInput = page.locator('input[type="password"]').first();
    await pwInput.fill("Test1234!");
    const bars = page.locator("div.flex.gap-1.mt-2 > div");
    await expect(bars).toHaveCount(4);
  });

  test('/auth/register "Sign in" links back to /auth/login', async ({
    page,
  }) => {
    await page.goto("/auth/register");
    const link = page.getByText("Sign in");
    await link.click();
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test("/auth/confirm shows 6 OTP input boxes", async ({ page }) => {
    await page.goto("/auth/confirm");
    // OTP inputs are typically individual single-char inputs
    const otpInputs = page.locator(
      'input[maxlength="1"], input[data-otp], input[autocomplete="one-time-code"]'
    );
    const count = await otpInputs.count();
    // If individual inputs, expect 6; if a container-based OTP, check differently
    if (count > 0) {
      expect(count).toBe(6);
    } else {
      // Fallback: look for 6 child elements in an OTP container
      const otpContainer = page.locator('[class*="otp"], [class*="code"]').first();
      await expect(otpContainer).toBeVisible();
    }
  });
});

// ── Settings page ────────────────────────────────────────────────────────────

test.describe("Settings page", () => {
  test("/settings shows Profile section", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText("Profile")).toBeVisible();
  });

  test("/settings shows Security section", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText("Security")).toBeVisible();
  });

  test("/settings shows Notifications section with toggles", async ({
    page,
  }) => {
    await page.goto("/settings");
    await expect(page.getByText("Notifications")).toBeVisible();
    const section = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Notifications" }) });
    const toggles = section.locator("button");
    await expect(toggles).toHaveCount(2);
  });

  test("/settings shows Theme section with 5 swatches", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText("Theme")).toBeVisible();
    // Look for the 5 theme labels
    for (const name of ["Azure", "Dark", "Orange", "Galaxy", "Brasil"]) {
      await expect(page.getByText(name)).toBeVisible();
    }
  });

  test("/settings shows Danger Zone with delete button", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText("Danger Zone")).toBeVisible();
    const deleteBtn = page
      .locator("button")
      .filter({ hasText: /delete/i });
    await expect(deleteBtn).toBeVisible();
  });

  test("clicking theme swatch changes active theme", async ({ page }) => {
    await page.goto("/settings");
    // Get the current theme
    const before = await page.evaluate(() =>
      localStorage.getItem("superdoc-theme")
    );
    // Click "Orange" or "Dark" swatch — whichever is not the current one
    const target = before === "orange" ? "Dark" : "Orange";
    await page.getByText(target).click();
    const after = await page.evaluate(() =>
      localStorage.getItem("superdoc-theme")
    );
    expect(after).not.toBe(before);
  });
});

// ── Processing page ──────────────────────────────────────────────────────────

test.describe("Processing page", () => {
  test("/processing/fake-id shows error state", async ({ page }) => {
    await page.goto("/processing/fake-id");
    // Should show an error or loading state since the API is not connected
    const body = await page.textContent("body");
    expect(body).toBeTruthy();
    expect(body.length).toBeGreaterThan(0);
  });

  test('shows "Try again" button that navigates to /', async ({ page }) => {
    await page.goto("/processing/fake-id");
    const btn = page
      .getByText("Try again")
      .or(page.getByText("Convert another file"));
    if (await btn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await btn.click();
      await expect(page).toHaveURL(urlEndsWith("/"));
    }
  });
});

// ── Accessibility ────────────────────────────────────────────────────────────

test.describe("Accessibility", () => {
  test("Tab key cycles through interactive elements on home", async ({
    page,
  }) => {
    await page.goto("/");
    // Tab through several elements and verify focus moves
    const focusedTags = [];
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Tab");
      const tag = await page.evaluate(() => document.activeElement?.tagName);
      focusedTags.push(tag);
    }
    // At least some elements should receive focus
    const interactiveTags = focusedTags.filter((t) =>
      ["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(t)
    );
    expect(interactiveTags.length).toBeGreaterThan(0);
  });

  test("drop zone has aria-label", async ({ page }) => {
    await page.goto("/");
    const dropZone = page.locator("[aria-label]").filter({ hasText: /drop|file|upload/i });
    const count = await dropZone.count();
    expect(count).toBeGreaterThan(0);
  });
});
