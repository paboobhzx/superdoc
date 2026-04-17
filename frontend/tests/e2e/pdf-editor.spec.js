// @ts-check
import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

test.describe("PDF Editor", () => {
  test("uploads, rotates, exports a PDF", async ({ page }) => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 400]);
    const bytes = await doc.save();

    await page.goto("/editor/pdf");

    await page.locator('input[type="file"]').setInputFiles({
      name: "in.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(bytes),
    });

    await expect(page.getByText("in.pdf")).toBeVisible();
    await page.getByRole("button", { name: "Rotate right" }).click();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export PDF" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  });
});
