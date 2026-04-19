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

  it("renders operations returned by the API", async () => {
    api.getOperations.mockResolvedValue({
      operations: [
        { operation: "pdf_to_docx", label: "PDF to Word (.docx)", category: "convert" },
        { operation: "pdf_to_txt", label: "PDF to Text (.txt)", category: "convert" },
      ],
      count: 2,
    })

    const file = new File(["x"], "doc.pdf", { type: "application/pdf" })
    render(<OperationPicker file={file} onPick={() => {}} onBack={() => {}} />)

    await waitFor(() => {
      expect(screen.getByText("PDF to Word (.docx)")).toBeInTheDocument()
      expect(screen.getByText("PDF to Text (.txt)")).toBeInTheDocument()
    })
  })

  it("calls onPick with the operation id when a card is clicked", async () => {
    api.getOperations.mockResolvedValue({
      operations: [
        { operation: "pdf_to_docx", label: "PDF to Word (.docx)", category: "convert" },
      ],
      count: 1,
    })

    const file = new File(["x"], "doc.pdf", { type: "application/pdf" })
    const onPick = vi.fn()
    render(<OperationPicker file={file} onPick={onPick} onBack={() => {}} />)

    const button = await screen.findByText("PDF to Word (.docx)")
    fireEvent.click(button.closest("button"))

    expect(onPick).toHaveBeenCalledWith("pdf_to_docx")
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
