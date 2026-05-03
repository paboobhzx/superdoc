// @ts-check
import { test, expect } from "@playwright/test"
import { uploadAndConvert, downloadAndValidate } from "../fixtures/helpers.js"

test.skip(process.env.LIVE_E2E !== "1", "Live production E2E is opt-in with LIVE_E2E=1")

test.describe("HTML and XLSX conversions", () => {
  test("HTML to PDF and DOCX are available", async ({ page, request }, testInfo) => {
    const pdfUrl = await uploadAndConvert({ page, request, testInfo, sampleFile: "sample.html", targetLabel: "HTML to PDF" })
    await downloadAndValidate({ request, url: pdfUrl, expectedMagic: Buffer.from("%PDF") })

    const docxUrl = await uploadAndConvert({ page, request, testInfo, sampleFile: "sample.html", targetLabel: "HTML to Word" })
    await downloadAndValidate({ request, url: docxUrl, expectedMagic: Buffer.from([0x50, 0x4b, 0x03, 0x04]) })
  })

  test("XLSX to CSV, MD, TXT, PDF and DOCX are available", async ({ page, request }, testInfo) => {
    const csvUrl = await uploadAndConvert({ page, request, testInfo, sampleFile: "sample.xlsx", targetLabel: "Spreadsheet to CSV" })
    const csv = await downloadAndValidate({ request, url: csvUrl })
    expect(csv.toString("utf-8")).toContain("Name")

    const mdUrl = await uploadAndConvert({ page, request, testInfo, sampleFile: "sample.xlsx", targetLabel: "Spreadsheet to Markdown" })
    expect((await downloadAndValidate({ request, url: mdUrl })).toString("utf-8")).toContain("| Name | Score |")

    const txtUrl = await uploadAndConvert({ page, request, testInfo, sampleFile: "sample.xlsx", targetLabel: "Spreadsheet to Text" })
    expect((await downloadAndValidate({ request, url: txtUrl })).toString("utf-8")).toContain("Name")

    const pdfUrl = await uploadAndConvert({ page, request, testInfo, sampleFile: "sample.xlsx", targetLabel: "Spreadsheet to PDF" })
    await downloadAndValidate({ request, url: pdfUrl, expectedMagic: Buffer.from("%PDF") })

    const docxUrl = await uploadAndConvert({ page, request, testInfo, sampleFile: "sample.xlsx", targetLabel: "Spreadsheet to Word" })
    await downloadAndValidate({ request, url: docxUrl, expectedMagic: Buffer.from([0x50, 0x4b, 0x03, 0x04]) })
  })
})
