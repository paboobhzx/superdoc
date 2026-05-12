// @ts-check
import { test, expect } from "@playwright/test";

test.describe("Dashboard (mocked authenticated)", () => {
  test("lists files and deletes one", async ({ page }) => {
    const apiBase = process.env.VITE_API_URL || "http://127.0.0.1:9999";

    const jobA = {
      job_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      file_name: "one.pdf",
      operation: "pdf_to_docx",
      status: "DONE",
      created_at: new Date().toISOString(),
      expires_at: Math.floor(Date.now() / 1000) + 3 * 3600,
      file_size_bytes: 1024,
      download_url: "https://download.example.com/one.docx",
    };

    const jobB = {
      job_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      file_name: "two.png",
      operation: "image_convert",
      status: "FAILED",
      created_at: new Date(Date.now() - 1000).toISOString(),
      file_size_bytes: 2048,
    };

    let jobs = [jobA, jobB];

    await page.route("**/*", async (route) => {
      const req = route.request();
      const url = req.url();

      if (url === `${apiBase}/auth/me` && req.method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ user: { id: "user-1", email: "test@example.com" } }),
        });
        return;
      }

      if (url.startsWith(`${apiBase}/users/me/files?`) && req.method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ jobs }),
        });
        return;
      }

      if (url.startsWith(`${apiBase}/users/me/files/${jobA.job_id}?`) && req.method() === "DELETE") {
        jobs = jobs.filter((j) => j.job_id !== jobA.job_id);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ deleted: true, job_id: jobA.job_id }),
        });
        return;
      }

      await route.fallback();
    });

    page.on("dialog", (d) => d.accept());

    await page.goto("/dashboard");

    await expect(page.getByRole("heading", { name: "Files" })).toBeVisible();
    await expect(page.getByText("one.pdf")).toBeVisible();
    await expect(page.getByText(/Expires in 2h|Expires in 3h/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Download" })).toBeVisible();

    await page.getByRole("button", { name: "Delete" }).first().click();
    await expect(page.getByText("one.pdf")).toBeHidden();
    await expect(page.getByText("two.png")).toBeVisible();
  });
});
