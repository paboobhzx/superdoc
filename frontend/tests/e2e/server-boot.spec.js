import { test, expect } from "@playwright/test";

test("dev server serves index.html", async ({ request }) => {
  const res = await request.get("/");
  expect(res.ok()).toBeTruthy();
  const html = await res.text();
  expect(html).toContain('id="root"');
});

