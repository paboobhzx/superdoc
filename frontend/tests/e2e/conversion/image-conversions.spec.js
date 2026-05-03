// @ts-check
import { test, expect } from "@playwright/test"
import { uploadAndConvert, downloadAndValidate } from "../fixtures/helpers.js"

test.skip(process.env.LIVE_E2E !== "1", "Live production E2E is opt-in with LIVE_E2E=1")

test.describe("Image conversions", () => {
  test("PNG to PDF produces a PDF", async ({ page, request }, testInfo) => {
    const url = await uploadAndConvert({ page, request, testInfo, sampleFile: "sample.png", targetLabel: "Convert to PDF" })
    await downloadAndValidate({ request, url, expectedMagic: Buffer.from("%PDF") })
  })

  test("PNG OCR to TXT exposes extracted text", async ({ page, request }, testInfo) => {
    const url = await uploadAndConvert({ page, request, testInfo, sampleFile: "sample.png", targetLabel: "Image to Text" })
    const text = (await downloadAndValidate({ request, url })).toString("utf-8")
    expect(text.length).toBeGreaterThan(0)
  })

  test("JPG to PNG returns a zip archive", async ({ page, request }, testInfo) => {
    const url = await uploadAndConvert({ page, request, testInfo, sampleFile: "sample.jpg", targetLabel: "Convert to PNG" })
    await downloadAndValidate({ request, url, expectedMagic: Buffer.from([0x50, 0x4b]) })
  })
})
