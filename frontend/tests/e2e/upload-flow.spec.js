// @ts-check
import { test, expect } from "@playwright/test";

test.describe("Upload flow (mocked API + S3)", () => {
  test("drop/upload navigates to processing and shows download", async ({ page }) => {
    const apiBase = process.env.VITE_API_URL || "http://127.0.0.1:9999";
    const s3Url = "https://uploads.example.com";

    const jobId = "11111111-1111-1111-1111-111111111111";
    const statusCalls = new Map();

    await page.route("**/*", async (route) => {
      const req = route.request();
      const url = req.url();

      if (url === `${apiBase}/jobs` && req.method() === "POST") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            job_id: jobId,
            file_key: `uploads/${jobId}/sample.pdf`,
            upload: { url: s3Url, fields: { key: `uploads/${jobId}/sample.pdf` } },
          }),
        });
        return;
      }

      if (url === `${apiBase}/jobs/${jobId}/process` && req.method() === "POST") {
        await route.fulfill({
          status: 202,
          contentType: "application/json",
          body: JSON.stringify({ success: true, estimated_seconds: 1 }),
        });
        return;
      }

      if (url === `${apiBase}/jobs/${jobId}` && req.method() === "GET") {
        const n = (statusCalls.get(jobId) || 0) + 1;
        statusCalls.set(jobId, n);

        const status = n < 2 ? "QUEUED" : "DONE";
        const payload = {
          job_id: jobId,
          status,
          operation: "pdf_to_docx",
          file_size_bytes: 1024,
          estimated_seconds: 1,
          actual_seconds: 1,
          download_url: status === "DONE" ? "https://download.example.com/out.docx" : undefined,
        };

        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(payload),
        });
        return;
      }

      if (url.startsWith(s3Url) && req.method() === "POST") {
        await route.fulfill({ status: 204, body: "" });
        return;
      }

      await route.fallback();
    });

    await page.goto("/");

    await page.locator('input[type="file"]').setInputFiles({
      name: "sample.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n%mock\n"),
    });

    await expect(page).toHaveURL(new RegExp(`/processing/${jobId}$`));
    await expect(page.getByRole("link", { name: "Download file" })).toBeVisible({
      timeout: 15_000,
    });
  });
});
