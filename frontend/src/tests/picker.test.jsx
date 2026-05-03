// frontend/src/tests/picker.test.jsx
// Smoke tests for the picker logic: targetGrid choices, picker routing, and
// Home action feedback. OperationPicker was removed in round 3a; its
// functionality moved into Home.jsx + useConversionFlow.js.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import "@testing-library/jest-dom"
import { buildTargetGridChoices, findClientEditorOperation } from "../pages/Home/targetGrid"
import { dispatchPick } from "../pages/Home/pickerRouting"
import { ThemeProvider } from "../context/ThemeContext"
import { I18nProvider } from "../context/I18nContext"
import { AuthProvider } from "../context/AuthContext"

function HomeProviders({ children }) {
  return (
    <MemoryRouter>
      <AuthProvider>
        <I18nProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </I18nProvider>
      </AuthProvider>
    </MemoryRouter>
  )
}

vi.mock("../lib/api", () => ({
  api: {
    me: vi.fn().mockResolvedValue(null),
    getOperations: vi.fn(),
    createJob: vi.fn(),
    uploadToS3: vi.fn(),
    triggerProcess: vi.fn(),
  },
}))

import { api } from "../lib/api"

describe("target grid choices", () => {
  it("expands required target_format operations into static grid entries", () => {
    const choices = buildTargetGridChoices("md", [
      {
        operation: "markdown_convert",
        kind: "backend_job",
        intent: "convert",
        label: "Convert Markdown",
        targets: ["pdf", "docx", "png", "jpg"],
        params_schema: {
          target_format: { required: true, enum: ["pdf", "docx", "png", "jpg"] },
        },
      },
    ])

    expect(choices.find((choice) => choice.target === "pdf")).toMatchObject({
      enabled: true,
      opMeta: expect.objectContaining({
        operation: "markdown_convert",
        params: { target_format: "pdf" },
      }),
    })
    expect(choices.find((choice) => choice.target === "docx")?.enabled).toBe(true)
    expect(choices.find((choice) => choice.target === "png")?.enabled).toBe(true)
    expect(choices.find((choice) => choice.target === "jpg")?.enabled).toBe(true)
    expect(choices.find((choice) => choice.target === "xlsx")).toMatchObject({
      enabled: false,
      disabledReason: "Not supported",
    })
  })

  it("keeps unsupported targets disabled and visible", () => {
    const choices = buildTargetGridChoices("pdf", [
      { operation: "pdf_to_docx", kind: "backend_job", intent: "convert", label: "PDF to Word", targets: ["docx"] },
    ])

    expect(choices.map((choice) => choice.target)).toEqual(["pdf", "docx", "png", "jpg", "webp", "gif", "tiff", "md", "html", "xlsx", "csv", "txt"])
    expect(choices.find((choice) => choice.target === "docx")?.enabled).toBe(true)
    expect(choices.find((choice) => choice.target === "html")).toMatchObject({
      enabled: false,
      disabledReason: "Not supported",
    })
  })

  it("uses output_type and target_format enum when targets are absent", () => {
    const choices = buildTargetGridChoices("xlsx", [
      { operation: "xlsx_to_csv", kind: "backend_job", intent: "convert", label: "Excel to CSV", output_type: "csv" },
      {
        operation: "markdown_convert",
        kind: "backend_job",
        intent: "convert",
        label: "Markdown convert",
        params_schema: { target_format: { required: true, enum: ["pdf"] } },
      },
    ])

    expect(choices.find((choice) => choice.target === "csv")?.opMeta).toMatchObject({
      operation: "xlsx_to_csv",
      target: "csv",
    })
    expect(choices.find((choice) => choice.target === "pdf")?.opMeta).toMatchObject({
      operation: "markdown_convert",
      params: { target_format: "pdf" },
    })
  })

  it("keeps older deployed catalog modify operations out of the conversion grid", () => {
    const choices = buildTargetGridChoices("pdf", [
      { operation: "pdf_compress", kind: "backend_job", intent: "modify", label: "Compress PDF", output_type: "pdf" },
      { operation: "pdf_to_docx", kind: "backend_job", intent: "convert", label: "PDF to Word", output_type: "docx" },
      { operation: "pdf_to_image", kind: "backend_job", intent: "convert", label: "PDF to Images", output_type: "zip" },
    ])

    expect(choices.find((choice) => choice.target === "pdf")?.enabled).toBe(false)
    expect(choices.find((choice) => choice.target === "docx")?.opMeta.operation).toBe("pdf_to_docx")
    expect(choices.find((choice) => choice.target === "png")?.opMeta.operation).toBe("pdf_to_image")
  })

  it("expands older deployed image_convert catalogs without target metadata", () => {
    const choices = buildTargetGridChoices("png", [
      { operation: "image_convert", kind: "backend_job", intent: "convert", label: "Convert image format", output_type: "image" },
    ])

    expect(choices.find((choice) => choice.target === "png")?.enabled).toBe(false)
    expect(choices.find((choice) => choice.target === "jpg")?.opMeta).toMatchObject({
      operation: "image_convert",
      params: { target_format: "jpg" },
    })
  })

  it("skips same-format image conversion targets", () => {
    const choices = buildTargetGridChoices("png", [
      { operation: "image_convert", kind: "backend_job", intent: "convert", label: "Convert image", targets: ["png", "jpg"] },
    ])

    expect(choices.find((choice) => choice.target === "png")?.enabled).toBe(false)
    expect(choices.find((choice) => choice.target === "jpg")?.opMeta).toMatchObject({
      operation: "image_convert",
      params: { target_format: "jpg" },
    })
  })

  it("prefers the first operation returned for duplicate targets", () => {
    const choices = buildTargetGridChoices("pdf", [
      { operation: "first_pdf_to_txt", kind: "backend_job", intent: "convert", label: "First", targets: ["txt"] },
      { operation: "second_pdf_to_txt", kind: "backend_job", intent: "convert", label: "Second", targets: ["txt"] },
    ])

    expect(choices.find((choice) => choice.target === "txt")?.opMeta.operation).toBe("first_pdf_to_txt")
  })

  it("finds the client editor operation separately from conversion targets", () => {
    const edit = { operation: "doc_edit", kind: "client_editor", intent: "edit", label: "Edit" }
    const choices = buildTargetGridChoices("docx", [
      edit,
      { operation: "docx_to_pdf", kind: "backend_job", intent: "convert", label: "Word to PDF", targets: ["pdf"] },
    ])

    expect(findClientEditorOperation([edit])).toBe(edit)
    expect(choices.find((choice) => choice.target === "pdf")?.enabled).toBe(true)
    expect(choices.find((choice) => choice.target === "docx")?.enabled).toBe(false)
  })
})

describe("picker routing", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.createJob.mockResolvedValue({
      upload: { url: "https://upload.example.com", fields: {} },
      file_key: "uploads/job-1/notes.md",
    })
    api.uploadToS3.mockResolvedValue(undefined)
  })

  it("routes Markdown client edits to the Markdown editor", async () => {
    const file = new File(["# Hello"], "notes.md", { type: "text/markdown" })
    const target = await dispatchPick(
      { operation: "md_edit", kind: "client_editor", editor_route: "/editor/markdown" },
      { file, auth: { isAuthenticated: false }, sessionId: "session-1" },
    )

    expect(api.createJob).toHaveBeenCalledWith(expect.objectContaining({
      operation: "md_edit",
      file_name: "notes.md",
    }))
    expect(target).toEqual({
      type: "internal",
      path: "/editor/markdown?key=uploads%2Fjob-1%2Fnotes.md&name=notes.md",
    })
  })
})

describe("Home action feedback", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("shows a visible Starting state after a conversion tap", async () => {
    api.getOperations.mockResolvedValue({
      operations: [
        {
          operation: "markdown_convert",
          kind: "backend_job",
          intent: "convert",
          label: "Convert Markdown",
          targets: ["docx"],
          params_schema: { target_format: { required: true, enum: ["docx"] } },
        },
      ],
      count: 1,
    })
    api.createJob.mockReturnValue(new Promise(() => {}))

    const { Home } = await import("../pages/Home/Home")
    render(<Home />, { wrapper: HomeProviders })

    fireEvent.change(screen.getByLabelText("File upload drop zone").querySelector("input"), {
      target: { files: [new File(["# Hello"], "notes.md", { type: "text/markdown" })] },
    })

    const button = await screen.findByRole("button", { name: /DOCX Word/i })
    fireEvent.click(button)

    await waitFor(() => expect(button).toHaveAttribute("aria-busy", "true"))
    expect(screen.getAllByText("Starting...").length).toBeGreaterThan(0)
  })

  it("shows retry state instead of disabled targets for known empty catalogs", async () => {
    api.getOperations.mockResolvedValue({ operations: [], count: 0 })

    const { Home } = await import("../pages/Home/Home")
    render(<Home />, { wrapper: HomeProviders })

    fireEvent.change(screen.getByLabelText("File upload drop zone").querySelector("input"), {
      target: { files: [new File(["# Hello"], "notes.md", { type: "text/markdown" })] },
    })

    expect(await screen.findByText(/Actions are temporarily unavailable for .md files/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
  })
})
