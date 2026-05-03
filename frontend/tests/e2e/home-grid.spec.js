// @ts-check
import { test, expect } from "@playwright/test";

test.skip(process.env.LIVE_E2E !== "1", "Live production E2E is opt-in with LIVE_E2E=1");

async function selectFile(page, name, body) {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name,
    mimeType: "application/octet-stream",
    buffer: Buffer.from(body),
  });
}

test.describe("Home conversion grid", () => {
  test("PDF shows html/md/image targets and same-format gating", async ({ page }) => {
    await selectFile(page, "sample.pdf", "%PDF-1.4\n%mock\n");

    await expect(page.getByRole("button", { name: /PDF to HTML/i })).toBeEnabled();
    await expect(page.getByRole("button", { name: /PDF to Markdown/i })).toBeEnabled();
    await expect(page.getByRole("button", { name: /PDF to PNG images/i })).toBeEnabled();
    await expect(page.getByRole("button", { name: /^PDF$/ })).toContainText("Same format");
  });

  test("PNG input shows the extra image targets surfaced in TARGET_GRID", async ({ page }) => {
    await selectFile(page, "sample.png", "png");

    for (const target of ["WEBP", "GIF", "TIFF"]) {
      await expect(page.getByRole("button", { name: new RegExp(`^${target}\\b`) }).first()).toBeVisible();
    }
  });

  test("DOCX shows html/md/pdf/image targets", async ({ page }) => {
    await selectFile(page, "sample.docx", "docx");

    await expect(page.getByRole("button", { name: /Word to HTML/i })).toBeEnabled();
    await expect(page.getByRole("button", { name: /Word to Markdown/i })).toBeEnabled();
    await expect(page.getByRole("button", { name: /Word to PDF/i })).toBeEnabled();
    await expect(page.getByRole("button", { name: /Word to PNG images/i })).toBeEnabled();
  });

  test("XLSX shows spreadsheet conversions including HTML and TXT", async ({ page }) => {
    await selectFile(page, "sample.xlsx", "xlsx");

    await expect(page.getByRole("button", { name: /Spreadsheet to HTML/i })).toBeEnabled();
    await expect(page.getByRole("button", { name: /Spreadsheet to Word/i })).toBeEnabled();
    await expect(page.getByRole("button", { name: /Spreadsheet to PDF/i })).toBeEnabled();
    await expect(page.getByRole("button", { name: /Spreadsheet to Text/i })).toBeEnabled();
    await expect(page.getByRole("button", { name: /^XLSX$/ })).toContainText("Same format");
  });

  test("HTML shows document conversions and same-format gating", async ({ page }) => {
    await selectFile(page, "sample.html", "<!doctype html><html><body><h1>Hello</h1></body></html>");

    await expect(page.getByRole("button", { name: /HTML to PDF/i })).toBeEnabled();
    await expect(page.getByRole("button", { name: /HTML to Word/i })).toBeEnabled();
    await expect(page.getByRole("button", { name: /HTML to Text/i })).toBeEnabled();
    await expect(page.getByRole("button", { name: /^HTML$/ })).toContainText("Same format");
  });
});
