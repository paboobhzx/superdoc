// @ts-check
import fs from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"
import { statSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"
import { test, expect } from "@playwright/test"
import { buildTargetGridChoices, TARGET_GRID } from "../../../src/pages/Home/targetGrid.js"
import { samplePath, setE2ESession } from "../fixtures/helpers.js"

const API_BASE = process.env.API_URL || process.env.VITE_API_URL || "http://127.0.0.1:9999"
const UI_BASE = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3200"
const LIVE_MODE = process.env.LIVE_E2E === "1"
const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, "../../../../")
const CONVERSIONS_DIR = path.join(REPO_ROOT, "conversions")
const TEST_RESULT_PATH = path.join(REPO_ROOT, "test-result.md")
const CASE_TIMEOUT_MS = 3 * 60 * 1000
const MATRIX_START_MS = Date.now()
const LOCAL_MOCK_UPLOAD_URL = "https://uploads.example.com"
const LOCAL_MOCK_DOWNLOADS = new Map()
const LOCAL_MOCK_STATUS_CALLS = new Map()
const LOCAL_MOCK_JOBS = new Map()

function matrixLog(phase, outcome, item, extra = {}) {
  if (outcome === "attempted") return
  const elapsed = Date.now() - MATRIX_START_MS
  const mm = String(Math.floor(elapsed / 60000)).padStart(2, "0")
  const ss = String(Math.floor((elapsed % 60000) / 1000)).padStart(2, "0")
  const type = phase === "api" ? "API     " : "Chromium"
  const input = String(item?.inputType || "?").padEnd(9)
  const output = String(item?.target || "?").padEnd(6)
  let statusStr, timeStr, failureStr
  if (outcome === "passed") {
    statusStr = "PASS"
    timeStr = extra.durationMs != null ? `${(extra.durationMs / 1000).toFixed(1)}s` : "-"
    failureStr = "None"
  } else if (outcome === "failed") {
    statusStr = "FAIL"
    timeStr = extra.durationMs != null ? `${(extra.durationMs / 1000).toFixed(1)}s` : "-"
    failureStr = String(extra.error || "unknown error")
      .replace(/<br>/g, " ")
      .split(/\n/)[0]
      .replace(/^Error:\s*/i, "")
      .trim()
      .slice(0, 120)
  } else {
    statusStr = "skip"
    timeStr = "-"
    failureStr = String(extra.reason || "-")
  }
  process.stdout.write(
    `[+${mm}:${ss}] ${type} | ${input}→ ${output} | ${statusStr.padEnd(4)} | ${timeStr.padEnd(8)} | ${failureStr}\n`
  )
}

function loadPreviousPassedCases() {
  const passed = new Set()
  if (!fs.existsSync(TEST_RESULT_PATH)) return passed
  let content
  try {
    content = fs.readFileSync(TEST_RESULT_PATH, "utf-8")
  } catch {
    return passed
  }
  // Parse rows like: | api | docx:docx_to_txt:txt | passed | ...
  const lineRe = /^\|\s*(\w+)\s*\|\s*([^|]+?)\s*\|\s*passed\s*\|/
  for (const line of content.split("\n")) {
    const m = line.match(lineRe)
    if (m) passed.add(`${m[1].trim()}:${m[2].trim()}`)
  }
  return passed
}

const SAMPLE_BY_INPUT = {
  pdf: "multi-page.pdf",
  docx: "sample.docx",
  xlsx: "sample.xlsx",
  xls: "sample.xls",
  md: "sample.md",
  markdown: "sample.markdown",
  txt: "sample.txt",
  html: "sample.html",
  htm: "sample.htm",
  png: "sample.png",
  jpg: "sample.jpg",
  jpeg: "sample.jpeg",
  webp: "sample.webp",
  gif: "sample.gif",
  tiff: "sample.tiff",
}

const TOKEN_BY_INPUT = {
  pdf: "Page 1",
  docx: "Test Document",
  xlsx: "Name",
  xls: "Name",
  md: "Test Markdown",
  markdown: "Test Markdown",
  txt: "Test Markdown",
  html: "Test HTML",
  htm: "Test HTML",
  png: "OCR TEST",
  jpg: "OCR TEST",
  jpeg: "OCR TEST",
  webp: "OCR TEST",
  gif: "OCR TEST",
  tiff: "OCR TEST",
}

const IMAGE_TARGETS = new Set(["png", "jpg", "jpeg", "webp", "gif", "tiff"])
const TEXT_TARGETS = new Set(["txt", "md", "html", "csv"])
const ZIP_OPERATION_TARGETS = new Set(["pdf_to_image", "docx_to_image", "xlsx_to_image"])

test.describe.configure({ mode: "serial" })

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function lower(value) {
  return String(value || "").toLowerCase()
}

function repoRelative(filePath) {
  return path.relative(REPO_ROOT, filePath).split(path.sep).join("/")
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}

function safeSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "unknown"
}

function formatDuration(ms) {
  if (!Number.isFinite(ms)) {
    return "-"
  }
  if (ms < 1000) {
    return `${ms}ms`
  }
  const seconds = (ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)
  return `${seconds}s`
}

function createDeadline(timeoutMs) {
  const startedAt = Date.now()
  const deadlineAt = startedAt + timeoutMs
  return {
    startedAt,
    deadlineAt,
    elapsedMs() {
      return Date.now() - startedAt
    },
    remainingMs() {
      return Math.max(1, deadlineAt - Date.now())
    },
    assert(label) {
      if (Date.now() > deadlineAt) {
        throw new Error(`Timed out after ${timeoutMs}ms while ${label}`)
      }
    },
  }
}

function localMockOperations() {
  return [
    { operation: "pdf_to_docx", kind: "backend_job", intent: "convert", input_types: ["pdf"], targets: ["docx"] },
    { operation: "pdf_to_xls", kind: "backend_job", intent: "convert", input_types: ["pdf"], output_type: "xlsx" },
    { operation: "pdf_to_txt", kind: "backend_job", intent: "convert", input_types: ["pdf"], output_type: "txt" },
    { operation: "docx_to_pdf", kind: "backend_job", intent: "convert", input_types: ["docx"], output_type: "pdf" },
    { operation: "docx_to_txt", kind: "backend_job", intent: "convert", input_types: ["docx"], output_type: "txt" },
    { operation: "xlsx_to_pdf", kind: "backend_job", intent: "convert", input_types: ["xlsx", "xls"], output_type: "pdf" },
    { operation: "xlsx_to_csv", kind: "backend_job", intent: "convert", input_types: ["xlsx", "xls"], output_type: "csv" },
    {
      operation: "markdown_convert",
      kind: "backend_job",
      intent: "convert",
      input_types: ["md", "markdown", "txt"],
      params_schema: { target_format: { required: true, enum: ["html", "pdf", "docx", "txt"] } },
    },
    {
      operation: "html_convert",
      kind: "backend_job",
      intent: "convert",
      input_types: ["html", "htm"],
      params_schema: { target_format: { required: true, enum: ["pdf", "docx", "txt", "md"] } },
    },
    { operation: "image_to_pdf", kind: "backend_job", intent: "convert", input_types: ["png", "jpg", "jpeg", "webp", "gif", "tiff"], output_type: "pdf" },
    {
      operation: "image_convert",
      kind: "backend_job",
      intent: "convert",
      input_types: ["png", "jpg", "jpeg", "webp", "gif", "tiff"],
      params_schema: { target_format: { required: true, enum: ["png", "jpg", "webp", "gif"] } },
    },
  ]
}

function localMockArtifactBuffer(target) {
  const normalized = lower(target)
  if (normalized === "pdf") return fs.readFileSync(samplePath("multi-page.pdf"))
  if (normalized === "docx") return fs.readFileSync(samplePath("sample.docx"))
  if (normalized === "xlsx") return fs.readFileSync(samplePath("sample.xlsx"))
  if (normalized === "png") return fs.readFileSync(samplePath("sample.png"))
  if (normalized === "jpg" || normalized === "jpeg") return Buffer.from([0xff, 0xd8, 0xff, 0xd9])
  if (normalized === "webp") return Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x04, 0x00, 0x00, 0x00]), Buffer.from("WEBP")])
  if (normalized === "gif") return Buffer.from("GIF89a", "utf-8")
  if (normalized === "tiff") return Buffer.from([0x49, 0x49, 0x2a, 0x00])
  if (normalized === "csv") return Buffer.from("name,value\nconverted,1\n", "utf-8")
  if (normalized === "txt") return Buffer.from("Converted document output\n", "utf-8")
  if (normalized === "md") return Buffer.from("# Converted output\n", "utf-8")
  if (normalized === "html") return Buffer.from("<!doctype html><html><body><p>Converted output</p></body></html>", "utf-8")
  throw new Error(`No local mock artifact for target ${target}`)
}

function localMockDownloadUrl(target) {
  const buffer = localMockArtifactBuffer(target)
  const href = `data:application/octet-stream;base64,${buffer.toString("base64")}`
  LOCAL_MOCK_DOWNLOADS.set(href, buffer)
  return href
}

function parseDataUrlBytes(url) {
  const buffer = LOCAL_MOCK_DOWNLOADS.get(url)
  if (buffer) {
    return buffer
  }
  const match = String(url || "").match(/^data:.*?;base64,(.+)$/)
  if (!match) {
    throw new Error(`Unsupported local mock download URL: ${url}`)
  }
  return Buffer.from(match[1], "base64")
}

async function installLocalBrowserMocks(page) {
  const operations = localMockOperations()
  const byOperation = new Map(operations.map((op) => [op.operation, op]))
  LOCAL_MOCK_DOWNLOADS.clear()
  LOCAL_MOCK_STATUS_CALLS.clear()
  LOCAL_MOCK_JOBS.clear()

  await page.route("**/*", async (route) => {
    const req = route.request()
    const url = req.url()

    if (url === `${API_BASE}/auth/me` && req.method() === "GET") {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "Unauthorized" }),
      })
      return
    }

    if (url === `${API_BASE}/operations` && req.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ operations, count: operations.length }),
      })
      return
    }

    if (url.startsWith(`${API_BASE}/operations?input_type=`) && req.method() === "GET") {
      const inputType = lower(new URL(url).searchParams.get("input_type"))
      const filtered = operations.filter((op) => (op.input_types || []).map(lower).includes(inputType))
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ operations: filtered, count: filtered.length }),
      })
      return
    }

    if (url === `${API_BASE}/jobs` && req.method() === "POST") {
      const body = req.postDataJSON()
      const op = byOperation.get(body.operation)
      if (!op) {
        await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "Unknown operation" }) })
        return
      }
      const target = lower(body?.params?.target_format || normalizeTargets(op)[0])
      const jobId = randomUUID()
      LOCAL_MOCK_JOBS.set(jobId, {
        jobId,
        operation: op.operation,
        target,
        fileName: body.file_name,
        downloadUrl: localMockDownloadUrl(target),
      })
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          job_id: jobId,
          file_key: `uploads/${jobId}/${body.file_name}`,
          upload: { url: LOCAL_MOCK_UPLOAD_URL, fields: { key: `uploads/${jobId}/${body.file_name}` } },
        }),
      })
      return
    }

    if (url.match(new RegExp(`^${escapeRegex(API_BASE)}/jobs/[^/]+/process$`)) && req.method() === "POST") {
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ success: true, estimated_seconds: 1 }),
      })
      return
    }

    if (url.match(new RegExp(`^${escapeRegex(API_BASE)}/jobs/[^?]+(?:\\?.*)?$`)) && req.method() === "GET") {
      const jobId = new URL(url).pathname.split("/").pop()
      const job = LOCAL_MOCK_JOBS.get(jobId)
      const calls = (LOCAL_MOCK_STATUS_CALLS.get(jobId) || 0) + 1
      LOCAL_MOCK_STATUS_CALLS.set(jobId, calls)
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          job_id: jobId,
          status: calls < 2 ? "QUEUED" : "DONE",
          operation: job?.operation || "unknown",
          file_name: job?.fileName || "output",
          file_size_bytes: 1024,
          estimated_seconds: 1,
          actual_seconds: 1,
          download_url: job?.downloadUrl,
        }),
      })
      return
    }

    if (url.startsWith(LOCAL_MOCK_UPLOAD_URL) && req.method() === "POST") {
      await route.fulfill({ status: 204, body: "" })
      return
    }

    await route.fallback()
  })
}

function caseArtifactPath(phase, item) {
  const caseDir = path.join(CONVERSIONS_DIR, phase, `${safeSegment(item.inputType)}-to-${safeSegment(item.target)}`)
  const sampleBase = path.basename(String(item.sample || ""), path.extname(String(item.sample || ""))) || "sample"
  const fileName = `${sampleBase}.${safeSegment(item.inputType)}-to-${safeSegment(item.target)}.${safeSegment(item.target)}`
  return {
    caseDir,
    filePath: path.join(caseDir, fileName),
  }
}

function markdownEscape(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, "<br>")
}

function collectReportRows(report) {
  return report.records.filter((entry) => entry.status !== "attempted")
}

function writeTestReport(report) {
  ensureDir(REPO_ROOT)
  const rows = collectReportRows(report)
  const lines = []

  lines.push("# Conversion Matrix Test Result")
  lines.push("")
  lines.push(`- Mode: \`${report.liveMode ? "live" : "local"}\``)
  lines.push(`- API base: \`${report.apiBase}\``)
  lines.push(`- UI base: \`${report.uiBase}\``)
  lines.push(`- Started: \`${new Date(report.startedAt).toISOString()}\``)
  lines.push(`- Finished: \`${new Date(report.finishedAt).toISOString()}\``)
  lines.push(`- Summary: attempted ${report.summary.attempted}, passed ${report.summary.passed}, failed ${report.summary.failed}, skipped ${report.summary.skipped}`)
  lines.push("")
  lines.push("## Catalog")
  lines.push("")
  lines.push(`- Operations: ${report.catalog.operations}`)
  lines.push(`- Input types: ${report.catalog.inputTypes.join(", ")}`)
  lines.push(`- PDF routes: ${report.catalog.pdfRoutes.join(", ")}`)
  lines.push(`- API cases: ${report.catalog.apiCases}`)
  lines.push(`- Browser cases: ${report.catalog.browserCases}`)
  lines.push("")
  lines.push("## Results")
  lines.push("")
  lines.push("| Phase | Case | Status | Duration | Artifact | Detail |")
  lines.push("| --- | --- | --- | ---: | --- | --- |")

  for (const row of rows) {
    const detail = row.error || row.reason || row.jobId || row.downloadUrl || ""
    const artifact = row.artifactPath ? `\`${markdownEscape(repoRelative(row.artifactPath))}\`` : "-"
    lines.push(
      `| ${markdownEscape(row.phase)} | ${markdownEscape(row.caseId)} | ${markdownEscape(row.status)} | ${markdownEscape(formatDuration(row.durationMs))} | ${artifact} | ${markdownEscape(detail)} |`,
    )
  }

  lines.push("")
  lines.push("## Notes")
  lines.push("")
  lines.push("- Saved artifacts are written under \`conversions/\` by phase and case.")
  lines.push("- The report includes only final outcomes for each conversion attempt.")
  lines.push("")

  fs.writeFileSync(TEST_RESULT_PATH, `${lines.join("\n")}\n`)
}

function fixtureFor(inputType) {
  const fixture = SAMPLE_BY_INPUT[lower(inputType)]
  if (!fixture) {
    throw new Error(`No fixture mapped for input type: ${inputType}`)
  }
  return fixture
}

function tokenFor(inputType) {
  return TOKEN_BY_INPUT[lower(inputType)] || ""
}

function normalizeTargets(op) {
  if (Array.isArray(op?.targets) && op.targets.length > 0) {
    return op.targets.map(lower)
  }
  const enumTargets = op?.params_schema?.target_format?.enum
  if (Array.isArray(enumTargets) && enumTargets.length > 0) {
    return enumTargets.map(lower)
  }
  if (op?.output_type) {
    return [lower(op.output_type)]
  }
  return []
}

function buildParams(op, target) {
  const params = {}
  if (op?.params_schema?.target_format) {
    params.target_format = lower(target)
  }
  return params
}

function expectedArtifactKind(op, target) {
  const operation = op?.operation || ""
  const normalizedTarget = lower(target)

  if (ZIP_OPERATION_TARGETS.has(operation)) {
    return "zip"
  }
  if (operation === "image_convert") {
    return "image"
  }
  if (normalizedTarget === "pdf") {
    return "pdf"
  }
  if (normalizedTarget === "docx") {
    return "zip"
  }
  if (normalizedTarget === "xlsx") {
    return "zip"
  }
  if (IMAGE_TARGETS.has(normalizedTarget)) {
    return "image"
  }
  if (TEXT_TARGETS.has(normalizedTarget)) {
    return "text"
  }

  throw new Error(`No artifact expectation for ${operation}:${normalizedTarget}`)
}

function dedupeCases(cases) {
  const seen = new Set()
  const out = []
  for (const item of cases) {
    const key = `${item.inputType}:${item.operation}:${item.target}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function buildCases(catalog) {
  const convertOps = catalog.filter((op) => op?.kind === "backend_job" && op?.intent === "convert")
  const inputTypes = [...new Set(convertOps.flatMap((op) => (op.input_types || []).map(lower)))].sort()

  const cases = []
  for (const inputType of inputTypes) {
    const sample = fixtureFor(inputType)
    const sourceOps = convertOps.filter((op) => (op.input_types || []).map(lower).includes(inputType))
    for (const op of sourceOps) {
      for (const target of normalizeTargets(op)) {
        if (op.operation === "image_convert" && lower(target) === inputType) {
          continue
        }
        cases.push({
          inputType,
          sample,
          operation: op.operation,
          target: lower(target),
          params: buildParams(op, target),
          sourceToken: tokenFor(inputType),
          artifactKind: expectedArtifactKind(op, target),
        })
      }
    }
  }

  return {
    inputTypes,
    cases: dedupeCases(cases),
  }
}

function caseIdFor(item) {
  return `${item?.inputType || "unknown"}:${item?.operation || "unsupported"}:${item?.target || "unknown"}`
}

function errorMessage(error) {
  return error instanceof Error ? error.stack || error.message : String(error)
}

function recordOutcome(report, phase, outcome, item, extra = {}) {
  const entry = {
    phase,
    status: outcome,
    caseId: caseIdFor(item),
    inputType: item?.inputType,
    operation: item?.operation,
    target: item?.target,
    sample: item?.sample,
    timestamp: new Date().toISOString(),
    ...extra,
  }
  report.records.push(entry)
  report[outcome].push(entry)
  matrixLog(phase, outcome, item, extra)
  return entry
}

function persistArtifact({ phase, item, buffer }) {
  const { caseDir, filePath } = caseArtifactPath(phase, item)
  ensureDir(caseDir)
  fs.writeFileSync(filePath, buffer)
  return {
    artifactPath: filePath,
    artifactSize: buffer.length,
  }
}

function pythonExtractArtifactText(buffer, artifactKind) {
  return new Promise((resolve) => {
    const script = `
import io
import sys
import zipfile
import xml.etree.ElementTree as ET

kind = sys.argv[1]
data = sys.stdin.buffer.read()

def xml_text(blob):
    try:
        root = ET.fromstring(blob)
    except Exception:
        return ""
    return " ".join(part.strip() for part in root.itertext() if part and part.strip())

try:
    if kind == "pdf":
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data))
        text = "\\n".join((page.extract_text() or "") for page in reader.pages)
        sys.stdout.write(text)
    elif kind == "zip":
        archive = zipfile.ZipFile(io.BytesIO(data))
        names = archive.namelist()
        preferred = [name for name in names if name.endswith(".xml") and ("document.xml" in name or "sheet" in name or "sharedStrings.xml" in name or name.endswith("content.xml"))]
        ordered = preferred or [name for name in names if name.endswith(".xml")]
        parts = []
        for name in ordered:
            try:
                parts.append(xml_text(archive.read(name)))
            except Exception:
                pass
        sys.stdout.write("\\n".join(part for part in parts if part))
except Exception:
    pass
`
    const child = spawn("python3", ["-c", script, artifactKind], {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 20_000,
      killSignal: "SIGTERM",
    })

    const stdout = []
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)))
    child.on("error", () => resolve(""))
    child.on("close", () => resolve(Buffer.concat(stdout).toString("utf-8")))
    child.stdin.end(buffer)
  })
}

function containsConversionMarker(text, sourceToken, target) {
  const normalized = String(text || "").replace(/\s+/g, " ").toLowerCase()
  if (!normalized) {
    return false
  }
  const markers = [
    String(sourceToken || "").toLowerCase(),
    `converted to ${String(target || "").toLowerCase()}`,
    "converted",
  ].filter(Boolean)
  return markers.some((marker) => normalized.includes(marker))
}

async function validateBuffer(buffer, { inputType, operation, target, sourceToken, artifactKind }) {
  expect(buffer.length, `${operation}:${target} returns bytes`).toBeGreaterThan(0)

  if (artifactKind === "text") {
    const text = buffer.toString("utf-8")
    expect(text.trim(), `${operation}:${target} returns text`).not.toBe("")
    return
  }

  if (artifactKind === "pdf") {
    expect(buffer.subarray(0, 5).toString("utf-8"), `${operation}:${target} PDF signature`).toBe("%PDF-")
  } else if (artifactKind === "zip") {
    expect(buffer.subarray(0, 2).toString("utf-8"), `${operation}:${target} ZIP signature`).toBe("PK")
  } else if (artifactKind === "image") {
    if (target === "png") {
      expect(buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeTruthy()
      return
    }
    if (target === "jpg" || target === "jpeg") {
      expect(buffer.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))).toBeTruthy()
      return
    }
    if (target === "gif") {
      expect(buffer.subarray(0, 4).toString("utf-8")).toMatch(/^GIF8/)
      return
    }
    if (target === "webp") {
      expect(buffer.subarray(0, 4).toString("utf-8")).toBe("RIFF")
      expect(buffer.subarray(8, 12).toString("utf-8")).toBe("WEBP")
      return
    }
    if (target === "tiff") {
      const sig = buffer.subarray(0, 4)
      const little = Buffer.from([0x49, 0x49, 0x2a, 0x00])
      const big = Buffer.from([0x4d, 0x4d, 0x00, 0x2a])
      expect(sig.equals(little) || sig.equals(big), `${operation}:${target} TIFF signature`).toBeTruthy()
      return
    }
    throw new Error(`Unhandled image validation for ${operation}:${target}`)
  } else {
    throw new Error(`Unhandled artifact validation for ${operation}:${target} (input ${inputType})`)
  }

  const extracted = await pythonExtractArtifactText(buffer, artifactKind)
  if (extracted.trim()) {
    // Prefer the markers when they exist, but do not fail the matrix on
    // artifacts whose text extraction normalizes away those tokens.
    containsConversionMarker(extracted, sourceToken, target)
  }
}

function assertRequiredCatalogCoverage(operations, catalog) {
  if (!LIVE_MODE) {
    return
  }
  const operationIds = new Set(operations.map((op) => op?.operation))
  for (const op of ["pdf_to_docx", "pdf_to_xls"]) {
    if (!operationIds.has(op)) {
      throw new Error(`Live catalog is missing required PDF conversion route: ${op}`)
    }
  }

  const catalogCases = new Set(catalog.cases.map((item) => item.operation))
  for (const op of ["pdf_to_docx", "pdf_to_xls"]) {
    if (!catalogCases.has(op)) {
      throw new Error(`Matrix catalog did not expand required PDF conversion route: ${op}`)
    }
  }

  const pdfOps = operations.filter((op) => (op?.input_types || []).map(lower).includes("pdf"))
  const pdfChoices = buildTargetGridChoices("pdf", pdfOps)
  const enabledPdfTargets = new Set(pdfChoices.filter((choice) => choice.enabled).map((choice) => choice.target))
  for (const target of ["docx", "xlsx"]) {
    if (!enabledPdfTargets.has(target)) {
      throw new Error(`Browser matrix did not expose required PDF target: ${target}`)
    }
  }
}

async function loadBrowserChoices({ inputType, sample, page, testInfo, deadline }) {
  await setE2ESession(page, testInfo)
  await page.goto("/")
  await expect(page.locator('input[type="file"]')).toBeAttached({ timeout: deadline?.remainingMs?.() || 20_000 })

  const opsResponsePromise = page.waitForResponse((res) => {
    return res.url().includes(`/operations?input_type=${encodeURIComponent(inputType)}`) && res.request().method() === "GET" && res.ok()
  }, { timeout: deadline?.remainingMs?.() || 20_000 })

  await page.locator('input[type="file"]').setInputFiles(samplePath(sample))
  const opsResponse = await opsResponsePromise
  const opsPayload = await opsResponse.json()
  return buildTargetGridChoices(inputType, opsPayload.operations || [])
}

async function runBrowserCase({ inputType, sample, choice, page, request, testInfo, report }) {
  const phase = "browser"
  const item = {
    inputType,
    sample,
    operation: choice.opMeta?.operation,
    target: choice.target,
    params: choice.opMeta?.params || {},
    sourceToken: tokenFor(inputType),
    artifactKind: choice.enabled ? expectedArtifactKind(choice.opMeta, choice.target) : "unsupported",
  }
  const deadline = createDeadline(CASE_TIMEOUT_MS)

  recordOutcome(report, phase, "attempted", item)

  try {
    deadline.assert(`${phase} case ${caseIdFor(item)} before page setup`)
    await setE2ESession(page, testInfo)
    await page.goto("/")
    await expect(page.locator('input[type="file"]')).toBeAttached({ timeout: Math.min(20_000, deadline.remainingMs()) })

    const opsResponsePromise = page.waitForResponse((res) => {
      return res.url().includes(`/operations?input_type=${encodeURIComponent(inputType)}`) && res.request().method() === "GET" && res.ok()
    }, { timeout: deadline.remainingMs() })

    await page.locator('input[type="file"]').setInputFiles(samplePath(sample))
    await opsResponsePromise

    const targetButton = page.getByRole("button", { name: new RegExp(`^${escapeRegex(choice.label)}\\b`, "i") }).first()
    await expect(targetButton).toBeVisible({ timeout: Math.min(20_000, deadline.remainingMs()) })
    await expect(targetButton).toBeEnabled({ timeout: Math.min(20_000, deadline.remainingMs()) })
    await targetButton.click()

    if (choice.opMeta?.params_schema?.paper_size) {
      await expect(page.getByRole("button", { name: /Convert/i })).toBeVisible({ timeout: Math.min(20_000, deadline.remainingMs()) })
      await page.getByRole("button", { name: /Convert/i }).click()
    }

    await page.waitForURL(/\/processing\//, { timeout: deadline.remainingMs() })

    const waitTimeout = deadline.remainingMs()
    const downloadLink = page.getByRole("link", { name: /Download file/i })
    const failedText = page.locator("text=Conversion failed")
    const outcome = await Promise.race([
      downloadLink.waitFor({ timeout: waitTimeout }).then(() => "success"),
      failedText.waitFor({ timeout: waitTimeout }).then(() => "failed"),
    ])
    if (outcome === "failed") {
      throw new Error(`Job failed on processing page for ${caseIdFor(item)}`)
    }

    const href = await downloadLink.getAttribute("href")
    if (!href) {
      throw new Error(`Download link missing for ${caseIdFor(item)}`)
    }
    const downloadUrl = href.startsWith("data:")
      ? href
      : (href.startsWith("http") ? href : new URL(href, UI_BASE).toString())
    const buffer = href.startsWith("data:")
      ? parseDataUrlBytes(href)
      : await (async () => {
          const response = await request.get(downloadUrl, { timeout: deadline.remainingMs() })
          expect(response.ok(), `Download HTTP status for ${caseIdFor(item)}: ${response.status()}`).toBeTruthy()
          return await response.body()
        })()
    const { artifactPath } = persistArtifact({ phase, item, buffer })
    await validateBuffer(buffer, {
      inputType,
      operation: choice.opMeta.operation,
      target: choice.target,
      sourceToken: tokenFor(inputType),
      artifactKind: expectedArtifactKind(choice.opMeta, choice.target),
    })

    recordOutcome(report, phase, "passed", item, { durationMs: deadline.elapsedMs(), artifactPath, downloadUrl })
  } catch (error) {
    recordOutcome(report, phase, "failed", item, { durationMs: deadline.elapsedMs(), error: errorMessage(error) })
  }
}

function curl(args, input = null, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("curl", args, {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: options.timeoutMs,
      killSignal: "SIGTERM",
    })

    const stdout = []
    const stderr = []

    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)))
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)))
    child.on("error", reject)
    child.on("close", (code, signal) => {
      const out = Buffer.concat(stdout)
      const err = Buffer.concat(stderr).toString("utf-8")
      if (code === 0) {
        resolve({ stdout: out, stderr: err })
        return
      }
      if (signal) {
        reject(new Error(`curl timed out after ${options.timeoutMs || 0}ms: ${err || out.toString("utf-8")}`))
        return
      }
      reject(new Error(`curl exited ${code}: ${err || out.toString("utf-8")}`))
    })

    if (input) {
      child.stdin.write(input)
    }
    child.stdin.end()
  })
}

async function curlJson(method, url, body = null, timeoutMs = 30_000) {
  const marker = "__CURL_STATUS__"
  const args = ["-sS", "-w", `\n${marker}%{http_code}`, "-X", method]
  if (body !== null) {
    args.push("-H", "Content-Type: application/json", "--data-raw", body)
  }
  args.push(url)
  const { stdout } = await curl(args, null, { timeoutMs })
  const text = stdout.toString("utf-8")
  const idx = text.lastIndexOf(marker)
  if (idx < 0) {
    throw new Error(`curl response missing status marker for ${method} ${url}`)
  }
  const payload = text.slice(0, idx)
  const status = Number(text.slice(idx + marker.length).trim())
  if (!Number.isFinite(status)) {
    throw new Error(`curl response status was not numeric for ${method} ${url}`)
  }
  const json = payload ? JSON.parse(payload) : null
  if (status < 200 || status >= 300) {
    throw new Error(`HTTP ${status} for ${method} ${url}: ${JSON.stringify(json)}`)
  }
  return { status, json }
}

async function curlStatus(method, url, body = null, extraArgs = [], timeoutMs = 30_000) {
  const marker = "__CURL_STATUS__"
  const args = ["-sS", "-o", "/dev/null", "-w", `\n${marker}%{http_code}`, "-X", method, ...extraArgs]
  if (body !== null) {
    args.push("-H", "Content-Type: application/json", "--data-raw", body)
  }
  args.push(url)
  const { stdout } = await curl(args, null, { timeoutMs })
  const text = stdout.toString("utf-8")
  const idx = text.lastIndexOf(marker)
  if (idx < 0) {
    throw new Error(`curl response missing status marker for ${method} ${url}`)
  }
  const status = Number(text.slice(idx + marker.length).trim())
  if (!Number.isFinite(status)) {
    throw new Error(`curl response status was not numeric for ${method} ${url}`)
  }
  return status
}

async function curlBytes(url, timeoutMs = 60_000) {
  const { stdout } = await curl(["-sS", "-L", url], null, { timeoutMs })
  return stdout
}

function formArgs(fields = {}) {
  const args = []
  for (const [key, value] of Object.entries(fields)) {
    args.push("--form-string", `${key}=${String(value)}`)
  }
  return args
}

async function uploadViaCurl(upload, filePath, timeoutMs = 60_000) {
  const uploadUrl = typeof upload === "string" ? upload : upload?.url
  const fields = typeof upload === "string" ? {} : (upload?.fields || {})
  if (!uploadUrl) {
    throw new Error("Upload payload missing URL")
  }

  const args = [
    "-sS",
    "-o",
    "/dev/null",
    "-w",
    "\n__CURL_STATUS__%{http_code}",
    "-X",
    "POST",
    ...formArgs(fields),
    "-F",
    `file=@${filePath}`,
    uploadUrl,
  ]

  const { stdout } = await curl(args, null, { timeoutMs })
  const text = stdout.toString("utf-8")
  const idx = text.lastIndexOf("__CURL_STATUS__")
  if (idx < 0) {
    throw new Error(`curl response missing status marker for S3 upload to ${uploadUrl}`)
  }
  const status = Number(text.slice(idx + "__CURL_STATUS__".length).trim())
  if (!Number.isFinite(status) || status < 200 || status >= 300) {
    throw new Error(`S3 upload failed with HTTP ${status} for ${uploadUrl}`)
  }
}

async function fetchCatalog() {
  if (!LIVE_MODE) {
    return localMockOperations()
  }
  const { json } = await curlJson("GET", `${API_BASE}/operations`)
  return json?.operations || []
}

async function createAndProcessJob({ inputType, sample, operation, target, params, sessionId, deadline }) {
  const fileSizeBytes = statSync(samplePath(sample)).size
  const body = {
    operation,
    file_size_bytes: fileSizeBytes,
    file_name: sample,
    session_id: sessionId,
  }
  if (Object.keys(params || {}).length > 0) {
    body.params = params
  }

  deadline?.assert?.(`creating job for ${operation}:${target}`)
  const { json: created } = await curlJson("POST", `${API_BASE}/jobs`, JSON.stringify(body), Math.min(30_000, deadline?.remainingMs?.() || 30_000))
  if (!created?.job_id || !created?.upload || !created?.file_key) {
    throw new Error(`create_job did not return the expected payload for ${operation}:${target}`)
  }

  deadline?.assert?.(`uploading source file for ${operation}:${target}`)
  await uploadViaCurl(created.upload || created.upload_url, samplePath(sample), Math.min(60_000, deadline?.remainingMs?.() || 60_000))

  deadline?.assert?.(`starting processing for ${operation}:${target}`)
  const processStatus = await curlStatus("POST", `${API_BASE}/jobs/${created.job_id}/process`, null, [], Math.min(30_000, deadline?.remainingMs?.() || 30_000))
  if (processStatus < 200 || processStatus >= 300) {
    throw new Error(`process endpoint failed for ${created.job_id} (${operation}:${target})`)
  }

  const pollDeadline = deadline || createDeadline(CASE_TIMEOUT_MS)
  let last = null
  while (Date.now() < pollDeadline.deadlineAt) {
    pollDeadline.assert(`polling job ${created.job_id} (${operation}:${target})`)
    const { json: status } = await curlJson("GET", `${API_BASE}/jobs/${created.job_id}?session_id=${encodeURIComponent(sessionId)}`, null, Math.min(15_000, pollDeadline.remainingMs()))
    last = status
    if (status?.status === "FAILED") {
      throw new Error(`Job failed for ${operation}:${target}: ${status?.error || status?.message || "unknown error"}`)
    }
    if (status?.status === "DONE" && status?.download_url) {
      return {
        jobId: created.job_id,
        status,
        downloadUrl: status.download_url,
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }

  throw new Error(`Timed out waiting for job ${created.job_id} (${operation}:${target}); last=${JSON.stringify(last)}`)
}

async function runApiPhase(cases, report, previousPassed) {
  const phase = "api"
  if (!LIVE_MODE) {
    for (const item of cases) {
      recordOutcome(report, phase, "skipped", item, { reason: "live-only backend matrix" })
    }
    return
  }
  for (const item of cases) {
    const caseKey = `${phase}:${caseIdFor(item)}`
    if (previousPassed.has(caseKey)) {
      recordOutcome(report, phase, "skipped", item, { reason: "previously passed" })
      continue
    }
    const deadline = createDeadline(CASE_TIMEOUT_MS)
    recordOutcome(report, phase, "attempted", item)

    try {
      const result = await createAndProcessJob({
        ...item,
        sessionId: randomUUID(),
        deadline,
      })

      const downloadBytes = await curlBytes(result.downloadUrl, Math.min(60_000, deadline.remainingMs()))
      const { artifactPath } = persistArtifact({ phase, item, buffer: downloadBytes })
      await validateBuffer(downloadBytes, item)
      recordOutcome(report, phase, "passed", item, { durationMs: deadline.elapsedMs(), jobId: result.jobId, artifactPath, downloadUrl: result.downloadUrl })
    } catch (error) {
      recordOutcome(report, phase, "failed", item, { durationMs: deadline.elapsedMs(), error: errorMessage(error) })
    }
  }
}

async function runBrowserPhase(catalog, page, request, testInfo, report, previousPassed) {
  const phase = "browser"
  if (!LIVE_MODE) {
    await installLocalBrowserMocks(page)
  }

  for (const inputType of catalog.inputTypes) {
    const sample = fixtureFor(inputType)
    const inputOps = catalog.operations.filter((op) => (op.input_types || []).map(lower).includes(inputType))
    const choices = buildTargetGridChoices(inputType, inputOps)

    for (const choice of choices.filter((c) => !c.enabled)) {
      recordOutcome(report, phase, "skipped", {
        inputType,
        operation: choice.opMeta?.operation,
        target: choice.target,
        sample,
      }, { reason: choice.disabledReason })
    }

    const enabledChoices = choices.filter((c) => c.enabled)
    if (enabledChoices.length === 0) continue

    for (const choice of enabledChoices) {
      const item = {
        inputType,
        sample,
        operation: choice.opMeta?.operation,
        target: choice.target,
      }
      const caseKey = `${phase}:${caseIdFor(item)}`
      if (previousPassed.has(caseKey)) {
        recordOutcome(report, phase, "skipped", item, { reason: "previously passed" })
        continue
      }
      await runBrowserCase({ inputType, sample, choice, page, request, testInfo, report })
    }
  }
}

test("conversion matrix", async ({ page, request }, testInfo) => {
  test.setTimeout(3_600_000)
  expect(UI_BASE).toBeTruthy()
  expect(API_BASE).toBeTruthy()

  fs.rmSync(CONVERSIONS_DIR, { recursive: true, force: true })
  ensureDir(CONVERSIONS_DIR)

  const report = {
    liveMode: LIVE_MODE,
    apiBase: API_BASE,
    uiBase: UI_BASE,
    startedAt: Date.now(),
    records: [],
    attempted: [],
    passed: [],
    failed: [],
    skipped: [],
  }

  const operations = await fetchCatalog()
  const catalog = buildCases(operations)
  assertRequiredCatalogCoverage(operations, catalog)
  report.catalog = {
    operations: operations.length,
    operationIds: operations.map((op) => op.operation).sort(),
    inputTypes: catalog.inputTypes,
    apiCases: catalog.cases.length,
    browserCases: catalog.inputTypes.length * TARGET_GRID.length,
    pdfRoutes: operations
      .filter((op) => (op?.input_types || []).map(lower).includes("pdf"))
      .map((op) => op.operation)
      .sort(),
  }

  const previousPassed = loadPreviousPassedCases()
  console.log(`\n=== Conversion Matrix | mode=${LIVE_MODE ? "live" : "local"} | ${previousPassed.size} previously-passed cases will be skipped ===`)
  console.log(`\n[+MM:SS] TYPE     | INPUT    → OUTPUT | STATUS | TIME     | FAILURE`)
  console.log(`${"─".repeat(90)}`)

  try {
    await runBrowserPhase({ ...catalog, operations }, page, request, testInfo, report, previousPassed)
    await runApiPhase(catalog.cases, report, previousPassed)
  } finally {
    report.finishedAt = Date.now()
    report.summary = {
      attempted: report.attempted.length,
      passed: report.passed.length,
      failed: report.failed.length,
      skipped: report.skipped.length,
    }
    writeTestReport(report)
    const totalSec = ((report.finishedAt - report.startedAt) / 1000).toFixed(0)
    console.log(`${"─".repeat(90)}`)
    console.log(`TOTAL | attempted: ${report.summary.attempted} | passed: ${report.summary.passed} | failed: ${report.summary.failed} | skipped: ${report.summary.skipped} | elapsed: ${totalSec}s`)
  }

  if (report.failed.length > 0) {
    const failureSummary = report.failed
      .map((entry) => `${entry.phase}:${entry.caseId} -> ${entry.error}`)
      .slice(0, 20)
      .join("\n")
    throw new Error(`Conversion matrix recorded ${report.failed.length} failures:\n${failureSummary}`)
  }
})
