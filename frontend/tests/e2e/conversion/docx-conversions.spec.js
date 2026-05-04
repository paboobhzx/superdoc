// @ts-check
import { test, expect } from "@playwright/test"
import { uploadAndConvert, downloadAndValidate } from "../fixtures/helpers.js"

test.skip(process.env.LIVE_E2E !== "1", "Live production E2E is opt-in with LIVE_E2E=1")

test.describe("DOCX conversions", () => {
  test("DOCX to PDF produces a PDF", async ({ page, request }, testInfo) => {
    const url = await uploadAndConvert({ page, request, testInfo, sampleFile: "sample.docx", targetLabel: "PDF" })
    await downloadAndValidate({ request, url, expectedMagic: Buffer.from("%PDF") })
  })

  test("DOCX to TXT extracts the heading text", async ({ page, request }, testInfo) => {
    const url = await uploadAndConvert({ page, request, testInfo, sampleFile: "sample.docx", targetLabel: "TXT" })
    const buffer = await downloadAndValidate({ request, url })
    expect(buffer.toString("utf-8")).toContain("Test Document")
  })

  test("DOCX to MD preserves the table", async ({ page, request }, testInfo) => {
    const url = await uploadAndConvert({ page, request, testInfo, sampleFile: "sample.docx", targetLabel: "MD" })
    const buffer = await downloadAndValidate({ request, url })
    const text = buffer.toString("utf-8")
    expect(text).toContain("# Test Document")
    expect(text).toContain("| A | B |")
  })

  test("DOCX to PNG returns a zip archive", async ({ page, request }, testInfo) => {
    const url = await uploadAndConvert({ page, request, testInfo, sampleFile: "sample.docx", targetLabel: "PNG" })
    await downloadAndValidate({ request, url, expectedMagic: Buffer.from([0x50, 0x4b]) })
  })
})
