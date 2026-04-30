// @ts-check
import { test, expect } from "@playwright/test";

const apiBase = process.env.VITE_API_URL || "http://127.0.0.1:9999";
const s3Url = "https://uploads.example.com";

function uploadFor(jobId, fileName) {
  return {
    job_id: jobId,
    file_key: `uploads/${jobId}/${fileName}`,
    upload: { url: s3Url, fields: { key: `uploads/${jobId}/${fileName}` } },
  };
}

async function mockProcessingFlow(page, { jobId, fileName, operation }) {
  const statusCalls = new Map();

  await page.route("**/*", async (route) => {
    const req = route.request();
    const url = req.url();

    if (url === `${apiBase}/operations?input_type=pdf` && req.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          operations: [
            { operation: "pdf_edit", kind: "client_editor", intent: "edit", label: "Edit PDF", category: "edit", editor_route: "/editor/pdf" },
            { operation: "pdf_to_docx", kind: "backend_job", intent: "convert", label: "PDF to Word (.docx)", category: "convert", targets: ["docx"] },
          ],
          count: 2,
        }),
      });
      return;
    }

    if (url === `${apiBase}/jobs` && req.method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(uploadFor(jobId, fileName)),
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
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          job_id: jobId,
          status,
          operation,
          file_size_bytes: 1024,
          estimated_seconds: 1,
          actual_seconds: 1,
          download_url: status === "DONE" ? "https://download.example.com/out.docx" : undefined,
        }),
      });
      return;
    }

    if (url.startsWith(s3Url) && req.method() === "POST") {
      await route.fulfill({ status: 204, body: "" });
      return;
    }

    await route.fallback();
  });
}

async function mockCatalogOnly(page, operationsByType) {
  await page.route("**/*", async (route) => {
    const req = route.request();
    const url = req.url();

    for (const [type, operations] of Object.entries(operationsByType)) {
      if (url === `${apiBase}/operations?input_type=${type}` && req.method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ operations, count: operations.length }),
        });
        return;
      }
    }

    if (url === `${apiBase}/jobs` && req.method() === "POST") {
      const body = req.postDataJSON();
      const jobId = body.operation === "image_to_pdf"
        ? "22222222-2222-2222-2222-222222222222"
        : "33333333-3333-3333-3333-333333333333";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(uploadFor(jobId, body.file_name)),
      });
      return;
    }

    if (url.match(/\/jobs\/[^/]+\/process$/) && req.method() === "POST") {
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ success: true, estimated_seconds: 1 }),
      });
      return;
    }

    if (url.startsWith(s3Url) && req.method() === "POST") {
      await route.fulfill({ status: 204, body: "" });
      return;
    }

    await route.fallback();
  });
}

async function clickActionHeading(page, name) {
  await page.locator("button").filter({ has: page.locator("h3", { hasText: name }) }).click();
}

test.describe("Upload flow (mocked API + S3)", () => {
  test("chooses Convert, creates a job, and reaches processing", async ({ page }) => {
    const jobId = "11111111-1111-1111-1111-111111111111";
    await mockProcessingFlow(page, { jobId, fileName: "sample.pdf", operation: "pdf_to_docx" });

    await page.goto("/");
    await page.locator('input[type="file"]').setInputFiles({
      name: "sample.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n%mock\n"),
    });

    await clickActionHeading(page, "Convert");
    await clickActionHeading(page, "PDF to Word (.docx)");

    await expect(page).toHaveURL(new RegExp(`/processing/${jobId}$`));
    await expect(page.getByRole("link", { name: "Download file" })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("Edit PDF opens the PDF editor", async ({ page }) => {
    await mockCatalogOnly(page, {
      pdf: [
        { operation: "pdf_edit", kind: "client_editor", intent: "edit", label: "Edit PDF", category: "edit", editor_route: "/editor/pdf" },
        { operation: "pdf_to_docx", kind: "backend_job", intent: "convert", label: "PDF to Word (.docx)", category: "convert", targets: ["docx"] },
      ],
    });

    await page.goto("/");
    await page.locator('input[type="file"]').setInputFiles({
      name: "editable.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n%mock\n"),
    });

    await clickActionHeading(page, "Edit");
    await clickActionHeading(page, "Edit PDF");
    await expect(page).toHaveURL(/\/editor\/pdf\?key=/);
  });

  test("Edit image opens the image editor", async ({ page }) => {
    await mockCatalogOnly(page, {
      png: [
        { operation: "image_edit", kind: "client_editor", intent: "edit", label: "Edit image", category: "edit", editor_route: "/editor/image" },
        { operation: "image_to_pdf", kind: "backend_job", intent: "convert", label: "Image to PDF", category: "convert", targets: ["pdf"] },
      ],
    });

    await page.goto("/");
    await page.locator('input[type="file"]').setInputFiles({
      name: "photo.png",
      mimeType: "image/png",
      buffer: Buffer.from("png"),
    });

    await clickActionHeading(page, "Edit");
    await clickActionHeading(page, "Edit image");
    await expect(page).toHaveURL(/\/editor\/image\?key=/);
  });

  test("Convert image to PDF creates a backend job", async ({ page }) => {
    await mockCatalogOnly(page, {
      png: [
        { operation: "image_edit", kind: "client_editor", intent: "edit", label: "Edit image", category: "edit", editor_route: "/editor/image" },
        { operation: "image_to_pdf", kind: "backend_job", intent: "convert", label: "Image to PDF", category: "convert", targets: ["pdf"] },
      ],
    });

    await page.goto("/");
    await page.locator('input[type="file"]').setInputFiles({
      name: "photo.png",
      mimeType: "image/png",
      buffer: Buffer.from("png"),
    });

    await clickActionHeading(page, "Convert");
    await clickActionHeading(page, "Image to PDF");
    await expect(page).toHaveURL(/\/processing\/22222222-2222-2222-2222-222222222222$/);
  });

  test("shows empty state when no conversions are available", async ({ page }) => {
    await mockCatalogOnly(page, { tiff: [] });

    await page.goto("/");
    await page.locator('input[type="file"]').setInputFiles({
      name: "scan.tiff",
      mimeType: "image/tiff",
      buffer: Buffer.from("tiff"),
    });

    await expect(page.getByText(/no actions available/i)).toBeVisible();
  });
});
