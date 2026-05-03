import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect } from "@playwright/test"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SAMPLES_DIR = path.join(HERE, "samples")

export function newSessionId(testInfo) {
  return `e2e-${testInfo.testId}-${Date.now()}`
}

export function samplePath(name) {
  return path.join(SAMPLES_DIR, name)
}

export async function setE2ESession(page, testInfo) {
  const sessionId = newSessionId(testInfo)
  await page.addInitScript((sid) => {
    sessionStorage.setItem("superdoc_session", sid)
  }, sessionId)
  return sessionId
}

export async function uploadAndConvert({ page, testInfo, sampleFile, targetLabel }) {
  await setE2ESession(page, testInfo)
  await page.goto("/")
  await expect(page.locator('input[type="file"]')).toBeAttached()

  const opsResponse = page.waitForResponse((res) => {
    return res.url().includes("/operations?input_type=") && res.request().method() === "GET" && res.ok()
  })
  await page.locator('input[type="file"]').setInputFiles(samplePath(sampleFile))
  await opsResponse

  const target = page.getByRole("button", { name: new RegExp(`^${targetLabel}\\b`, "i") }).first()
  await expect(target).toBeVisible({ timeout: 20_000 })
  await expect(target).toBeEnabled({ timeout: 20_000 })
  await target.click()

  await page.waitForURL(/\/processing\//, { timeout: 30_000 })
  await expect(page.getByRole("heading", { name: /Done - file ready|Converting file|Done — file ready/i })).toBeVisible({ timeout: 120_000 })

  const downloadLink = page.getByRole("link", { name: /Download file/i })
  await expect(downloadLink).toBeVisible({ timeout: 120_000 })
  return await downloadLink.getAttribute("href")
}

export async function downloadAndValidate({ request, url, expectedMagic, containsText }) {
  const res = await request.get(url)
  expect(res.ok(), `Download HTTP status: ${res.status()}`).toBeTruthy()
  const buffer = await res.body()
  expect(buffer.length, "Download is non-empty").toBeGreaterThan(0)
  if (expectedMagic) {
    const head = buffer.subarray(0, expectedMagic.length)
    expect(head.equals(expectedMagic), `Magic bytes mismatch: expected ${expectedMagic.toString("hex")}, got ${head.toString("hex")}`).toBeTruthy()
  }
  if (containsText) {
    expect(buffer.toString("utf-8")).toContain(containsText)
  }
  return buffer
}
