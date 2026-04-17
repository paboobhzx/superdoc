// @ts-check
import { test, expect } from "@playwright/test";
import * as XLSX from "xlsx";

test.describe("XLSX Editor", () => {
  test("uploads, applies a cell value, exports an XLSX", async ({ page }) => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([["A1"]]);
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    await page.goto("/editor/xlsx");
    await page.locator('input[type="file"]').setInputFiles({
      name: "in.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from(buf),
    });

    await expect(page.getByRole("heading", { name: "Preview" })).toBeVisible();
    await page.getByText("A1").first().click();

    await page.locator('input[placeholder="Value"]').fill("Z9");
    await page.getByRole("button", { name: "Apply" }).click();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export XLSX" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.xlsx$/i);
  });
});
