// @ts-check
import { test, expect } from "@playwright/test";

test.describe("Markdown Editor", () => {
  test("loads Markdown, edits rich content, and exports Markdown", async ({ page }) => {
    await page.goto("/editor/markdown");

    await page.locator('input[type="file"]').setInputFiles({
      name: "notes.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Hello\n\n- one\n"),
    });

    const editor = page.locator(".ProseMirror");
    await expect(editor).toContainText("Hello");
    await editor.click();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+End" : "Control+End");
    await page.keyboard.type("\nWorld");
    await expect(editor).toContainText("World");

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export Markdown" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("notes.md");
  });
});
