// @ts-check
import { test, expect } from "@playwright/test";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fs from "node:fs/promises";

const LIVE_BASE_URL = "https://superdoc.pablobhz.cloud";
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);

test.skip(process.env.LIVE_E2E !== "1", "Live production E2E is opt-in with LIVE_E2E=1");
test.describe.configure({ mode: "serial" });
test.use({
  viewport: { width: 1440, height: 1000 },
  launchOptions: { args: ["--window-size=1440,1000"] },
});

async function makeSourcePdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("SuperDoc live PDF to DOCX smoke", {
    x: 72,
    y: 720,
    size: 18,
    font,
    color: rgb(0.1, 0.1, 0.1),
  });
  return Buffer.from(await doc.save());
}

async function chooseConversionTarget(page, file, targetName) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator('input[type="file"]')).toBeAttached();
  await page.locator('input[type="file"]').setInputFiles(file);
  const target = page.getByRole("button", { name: new RegExp(`^${targetName}\\b`, "i") });
  await expect(target).toBeEnabled({ timeout: 20_000 });
  const downloadPromise = page.waitForEvent("download", { timeout: 180_000 });
  await target.click();
  await expect(page.getByRole("link", { name: "Download file" })).toBeVisible({ timeout: 180_000 });
  return downloadPromise;
}

async function saveDownload(download, testInfo) {
  const suggested = download.suggestedFilename();
  const path = testInfo.outputPath(suggested);
  await download.saveAs(path);
  return { suggested, path, bytes: await fs.readFile(path) };
}

test.describe("live production document conversions", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    expect(baseURL).toBe(LIVE_BASE_URL);
    page.setDefaultTimeout(30_000);
  });

  test("converts a PNG image to a parseable PDF download", async ({ page }, testInfo) => {
    const download = await chooseConversionTarget(page, {
      name: "superdoc-live-image.png",
      mimeType: "image/png",
      buffer: PNG_1X1,
    }, "PDF");

    const { bytes } = await saveDownload(await download, testInfo);
    expect(bytes.subarray(0, 5).toString("utf8")).toBe("%PDF-");
    await expect(PDFDocument.load(bytes)).resolves.toBeTruthy();
  });

  test("converts a PDF to a valid DOCX zip download", async ({ page }, testInfo) => {
    const download = await chooseConversionTarget(page, {
      name: "superdoc-live-source.pdf",
      mimeType: "application/pdf",
      buffer: await makeSourcePdf(),
    }, "DOCX");

    const { suggested, bytes } = await saveDownload(await download, testInfo);
    expect(suggested).toMatch(/\.docx$/i);
    expect(bytes.length).toBeGreaterThan(1024);
    expect(bytes.subarray(0, 2).toString("utf8")).toBe("PK");
    expect(bytes.indexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))).toBeGreaterThanOrEqual(0);
  });
});
