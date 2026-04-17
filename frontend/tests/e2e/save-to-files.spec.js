// @ts-check
import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

test.describe("Save to Files (registered)", () => {
  test("PDF editor saves and lands in Dashboard", async ({ page }) => {
    const apiBase = process.env.VITE_API_URL || "http://127.0.0.1:9999";
    const s3Url = "https://uploads.example.com";

    const savedJobId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const savedName = "edited.pdf";

    await page.addInitScript(() => {
      localStorage.setItem("superdoc_id_token", "test.jwt.token");
      localStorage.setItem("superdoc_email", "test@example.com");
    });

    let completed = false;

    await page.route("**/*", async (route) => {
      const req = route.request();
      const url = req.url();

      if (url === `${apiBase}/users/me/files` && req.method() === "POST") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            job_id: savedJobId,
            upload: { url: s3Url, fields: { key: `users/u/outputs/${savedJobId}/${savedName}` } },
            output_key: `users/u/outputs/${savedJobId}/${savedName}`,
          }),
        });
        return;
      }

      if (url === `${apiBase}/users/me/files/${savedJobId}/complete` && req.method() === "POST") {
        completed = true;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true, job_id: savedJobId }),
        });
        return;
      }

      if (url === `${apiBase}/users/me/files` && req.method() === "GET") {
        const jobs = completed
          ? [
              {
                job_id: savedJobId,
                file_name: savedName,
                status: "DONE",
                operation: "store",
                created_at: new Date().toISOString(),
                file_size_bytes: 1024,
                download_url: "https://download.example.com/edited.pdf",
              },
            ]
          : [];

        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ jobs }),
        });
        return;
      }

      if (url.startsWith(s3Url) && req.method() === "POST") {
        await route.fulfill({ status: 204, body: "" });
        return;
      }

      await route.fallback();
    });

    const doc = await PDFDocument.create();
    doc.addPage([300, 400]);
    const pdfBytes = await doc.save();

    await page.goto("/editor/pdf");
    await page.locator('input[type="file"]').setInputFiles({
      name: "in.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(pdfBytes),
    });

    await page.getByRole("button", { name: "Save to Files" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText(savedName)).toBeVisible();
  });
});

