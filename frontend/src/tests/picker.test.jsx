// frontend/src/tests/picker.test.jsx
// Smoke tests for OperationPicker. We mock api.getOperations and assert that
// the picker renders, handles selection, and falls back gracefully on error.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import "@testing-library/jest-dom"
import { OperationPicker } from "../pages/Home/OperationPicker"

vi.mock("../lib/api", () => ({
  api: {
    getOperations: vi.fn(),
  },
}))

import { api } from "../lib/api"

describe("OperationPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
  })

  it("renders edit/convert choices returned by the API", async () => {
    api.getOperations.mockResolvedValue({
      operations: [
        { operation: "pdf_edit", kind: "client_editor", intent: "edit", label: "Edit PDF", category: "edit" },
        { operation: "pdf_to_docx", kind: "backend_job", intent: "convert", label: "PDF to Word (.docx)", category: "convert" },
      ],
      count: 2,
    })

    const file = new File(["x"], "doc.pdf", { type: "application/pdf" })
    render(<OperationPicker file={file} onPick={() => {}} onBack={() => {}} />)

    await waitFor(() => {
      expect(screen.getByText("Edit")).toBeInTheDocument()
      expect(screen.getByText("Convert")).toBeInTheDocument()
    })
  })

  it("calls onPick with operation metadata when a card is clicked", async () => {
    const op = {
      operation: "pdf_to_docx",
      kind: "backend_job",
      intent: "convert",
      label: "PDF to Word (.docx)",
      category: "convert",
    }
    api.getOperations.mockResolvedValue({
      operations: [op],
      count: 1,
    })

    const file = new File(["x"], "doc.pdf", { type: "application/pdf" })
    const onPick = vi.fn()
    render(<OperationPicker file={file} onPick={onPick} onBack={() => {}} />)

    const button = await screen.findByText("PDF to Word (.docx)")
    fireEvent.click(button.closest("button"))

    expect(onPick).toHaveBeenCalledWith(op)
  })

  it("expands image_convert targets and passes target_format params", async () => {
    api.getOperations.mockResolvedValue({
      operations: [
        {
          operation: "image_convert",
          kind: "backend_job",
          intent: "convert",
          label: "Convert image format",
          category: "convert",
          targets: ["png", "jpg", "webp"],
        },
      ],
      count: 1,
    })

    const file = new File(["x"], "photo.png", { type: "image/png" })
    const onPick = vi.fn()
    render(<OperationPicker file={file} onPick={onPick} onBack={() => {}} />)

    const button = await screen.findByText("Image to JPEG")
    fireEvent.click(button.closest("button"))

    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({
      operation: "image_convert",
      target: "jpg",
      params: { target_format: "jpg" },
    }))
    expect(screen.queryByText("Image to PNG")).not.toBeInTheDocument()
  })

  it("uses cached operations for the same input type", async () => {
    api.getOperations.mockResolvedValue({
      operations: [
        { operation: "docx_to_txt", kind: "backend_job", intent: "convert", label: "Word to Text (.txt)", category: "convert" },
      ],
      count: 1,
    })

    const file = new File(["x"], "doc.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })
    const { unmount } = render(<OperationPicker file={file} onPick={() => {}} onBack={() => {}} />)
    await screen.findByText("Word to Text (.txt)")
    unmount()

    render(<OperationPicker file={file} onPick={() => {}} onBack={() => {}} />)
    await screen.findByText("Word to Text (.txt)")

    expect(api.getOperations).toHaveBeenCalledTimes(1)
  })

  it("shows the conversion choices for DOCX files", async () => {
    api.getOperations.mockResolvedValue({
      operations: [
        { operation: "docx_to_txt", kind: "backend_job", intent: "convert", label: "Word to Text (.txt)", category: "convert", targets: ["txt"] },
        { operation: "docx_to_pdf", kind: "backend_job", intent: "convert", label: "Word to PDF", category: "convert", targets: ["pdf"] },
      ],
      count: 2,
    })

    const file = new File(["x"], "doc.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })
    render(<OperationPicker file={file} onPick={() => {}} onBack={() => {}} />)

    expect(await screen.findByText("Word to Text (.txt)")).toBeInTheDocument()
    expect(screen.getByText("Word to PDF")).toBeInTheDocument()
  })

  it("shows the conversion choices for XLSX files", async () => {
    api.getOperations.mockResolvedValue({
      operations: [
        { operation: "xlsx_to_csv", kind: "backend_job", intent: "convert", label: "Excel to CSV (first sheet)", category: "convert", targets: ["csv"] },
        { operation: "xlsx_to_pdf", kind: "backend_job", intent: "convert", label: "Excel to PDF", category: "convert", targets: ["pdf"] },
      ],
      count: 2,
    })

    const file = new File(["x"], "book.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
    render(<OperationPicker file={file} onPick={() => {}} onBack={() => {}} />)

    expect(await screen.findByText("Excel to CSV (first sheet)")).toBeInTheDocument()
    expect(screen.getByText("Excel to PDF")).toBeInTheDocument()
  })

  it("shows the conversion choices for PDF files", async () => {
    api.getOperations.mockResolvedValue({
      operations: [
        { operation: "pdf_to_docx", kind: "backend_job", intent: "convert", label: "PDF to Word (.docx)", category: "convert", targets: ["docx"] },
        { operation: "pdf_to_txt", kind: "backend_job", intent: "convert", label: "PDF to Text (.txt)", category: "convert", targets: ["txt"] },
        { operation: "pdf_to_image", kind: "backend_job", intent: "convert", label: "PDF to PNG images (.zip)", category: "convert", targets: ["png"] },
      ],
      count: 3,
    })

    const file = new File(["x"], "doc.pdf", { type: "application/pdf" })
    render(<OperationPicker file={file} onPick={() => {}} onBack={() => {}} />)

    expect(await screen.findByText("PDF to Word (.docx)")).toBeInTheDocument()
    expect(screen.getByText("PDF to Text (.txt)")).toBeInTheDocument()
    expect(screen.getByText("PDF to PNG images (.zip)")).toBeInTheDocument()
  })

  it("shows an error banner if the API call fails", async () => {
    api.getOperations.mockRejectedValue(new Error("backend down"))

    const file = new File(["x"], "doc.pdf", { type: "application/pdf" })
    render(<OperationPicker file={file} onPick={() => {}} onBack={() => {}} />)

    await waitFor(() => {
      expect(screen.getByText(/backend down/i)).toBeInTheDocument()
    })
  })

  it("shows empty-state when catalog is empty for the input type", async () => {
    api.getOperations.mockResolvedValue({ operations: [], count: 0 })

    const file = new File(["x"], "weird.tiff", { type: "image/tiff" })
    render(<OperationPicker file={file} onPick={() => {}} onBack={() => {}} />)

    await waitFor(() => {
      expect(screen.getByText(/no actions available/i)).toBeInTheDocument()
    })
  })
})
