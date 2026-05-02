// @ts-check
import { test, expect } from "@playwright/test";
import { Document, Packer, Paragraph } from "docx";

test.describe("DOCX Editor", () => {
  test("uploads, edits text, exports a DOCX", async ({ page }) => {
    const src = new Document({
      sections: [{ properties: {}, children: [new Paragraph("Hello")] }],
    });
    const buf = await Packer.toBuffer(src);

    await page.goto("/editor/docx");

    await page.locator('input[type="file"]').setInputFiles({
      name: "in.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: Buffer.from(buf),
    });

    const editor = page.locator(".ProseMirror");
    await expect(editor).toContainText("Hello");
    await editor.click();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.type("Hello\nWorld");
    await expect(editor).toContainText("World");

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export DOCX" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.docx$/i);
  });
});
