// @ts-check
import { test, expect } from "@playwright/test"
import { uploadAndConvert, downloadAndValidate } from "../fixtures/helpers.js"

test.skip(process.env.LIVE_E2E !== "1", "Live production E2E is opt-in with LIVE_E2E=1")

test.describe("PDF conversions", () => {
  test("PDF to DOCX produces a valid Word document", async ({ page, request }, testInfo) => {
    const url = await uploadAndConvert({ page, request, testInfo, sampleFile: "tiny.pdf", targetLabel: "PDF to Word" })
    await downloadAndValidate({ request, url, expectedMagic: Buffer.from([0x50, 0x4b, 0x03, 0x04]) })
  })

  test("PDF to TXT includes the source text", async ({ page, request }, testInfo) => {
    const url = await uploadAndConvert({ page, request, testInfo, sampleFile: "tiny.pdf", targetLabel: "PDF to Text" })
    const buffer = await downloadAndValidate({ request, url })
    expect(buffer.toString("utf-8")).toContain("Hello SuperDoc")
  })

  test("PDF to MD includes page headers for multi-page input", async ({ page, request }, testInfo) => {
    const url = await uploadAndConvert({ page, request, testInfo, sampleFile: "multi-page.pdf", targetLabel: "PDF to Markdown" })
    const buffer = await downloadAndValidate({ request, url })
    const text = buffer.toString("utf-8")
    expect(text).toContain("## Page 1")
    expect(text).toContain("## Page 2")
  })

  test("PDF to PNG returns a zip archive", async ({ page, request }, testInfo) => {
    const url = await uploadAndConvert({ page, request, testInfo, sampleFile: "multi-page.pdf", targetLabel: "PDF to PNG images (.zip)" })
    await downloadAndValidate({ request, url, expectedMagic: Buffer.from([0x50, 0x4b]) })
  })

  test("PDF to JPG returns a zip archive", async ({ page, request }, testInfo) => {
    const url = await uploadAndConvert({ page, request, testInfo, sampleFile: "multi-page.pdf", targetLabel: "PDF to JPG images (.zip)" })
    await downloadAndValidate({ request, url, expectedMagic: Buffer.from([0x50, 0x4b]) })
  })
})
