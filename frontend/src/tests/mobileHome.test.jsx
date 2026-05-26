import { describe, it, expect, vi, afterEach } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { ThemeProvider } from "../context/ThemeContext"
import { I18nProvider } from "../context/I18nContext"
import { AuthProvider } from "../context/AuthContext"

vi.mock("../lib/api", () => ({
  api: {
    me: vi.fn().mockResolvedValue(null),
    getOperations: vi.fn(),
    createJob: vi.fn(),
    uploadToS3: vi.fn(),
    triggerProcess: vi.fn(),
    analyzePdf: vi.fn(),
    repairPdf: vi.fn(),
  },
}))

vi.mock("../pages/Home/pickerRouting", () => ({
  dispatchPick: vi.fn(),
  createAndUploadOnly: vi.fn(async () => ({ job_id: "job-ana", file_key: "uploads/sample.pdf" })),
}))

import { api } from "../lib/api"
import { dispatchPick } from "../pages/Home/pickerRouting"
import { MobileHome } from "../pages/Home/MobileHome"

function Providers({ children }) {
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

describe("MobileHome", () => {
  afterEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
  })

  it("renders touch upload first", () => {
    render(<MobileHome />, { wrapper: Providers })
    expect(screen.getByRole("button", { name: "File upload drop zone" })).toBeTruthy()
    expect(screen.queryByRole("combobox")).toBeNull()
  })

  it("loads operations after file selection and shows dropdown choices", async () => {
    api.getOperations.mockResolvedValue({
      operations: [
        { operation: "pdf_to_docx", kind: "backend_job", intent: "convert", label: "PDF to Word", targets: ["docx"], output_type: "docx", params_schema: {} },
        { operation: "pdf_edit", kind: "client_editor", intent: "edit", label: "Edit PDF", targets: ["pdf"], output_type: "pdf", editor_route: "/editor/pdf", params_schema: {} },
      ],
    })

    render(<MobileHome />, { wrapper: Providers })
    fireEvent.change(screen.getByLabelText("File upload drop zone", { selector: "input" }), {
      target: { files: [new File(["x"], "sample.pdf", { type: "application/pdf" })] },
    })

    await waitFor(() => expect(screen.getByRole("combobox")).toBeTruthy())
    expect(screen.getByRole("option", { name: "DOCX" })).toBeTruthy()
    expect(screen.getByRole("option", { name: "Edit" })).toBeTruthy()
  })

  it("hides edit option when the catalog has no client editor", async () => {
    api.getOperations.mockResolvedValue({
      operations: [
        { operation: "pdf_to_docx", kind: "backend_job", intent: "convert", label: "PDF to Word", targets: ["docx"], output_type: "docx", params_schema: {} },
      ],
    })

    render(<MobileHome />, { wrapper: Providers })
    fireEvent.change(screen.getByLabelText("File upload drop zone", { selector: "input" }), {
      target: { files: [new File(["x"], "sample.pdf", { type: "application/pdf" })] },
    })

    await waitFor(() => expect(screen.getByRole("combobox")).toBeTruthy())
    expect(screen.queryByRole("option", { name: "Edit" })).toBeNull()
  })

  it("dispatches the selected conversion through the shared picker path", async () => {
    api.getOperations.mockResolvedValue({
      operations: [
        { operation: "pdf_to_docx", kind: "backend_job", intent: "convert", label: "PDF to Word", targets: ["docx"], output_type: "docx", params_schema: {} },
      ],
    })
    dispatchPick.mockResolvedValue({ type: "internal", path: "/processing/job-1" })

    render(<MobileHome />, { wrapper: Providers })
    fireEvent.change(screen.getByLabelText("File upload drop zone", { selector: "input" }), {
      target: { files: [new File(["x"], "sample.pdf", { type: "application/pdf" })] },
    })
    await waitFor(() => expect(screen.getByRole("combobox")).toBeTruthy())

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "pdf_to_docx:docx" } })
    fireEvent.click(screen.getByRole("button", { name: /Process/ }))

    await waitFor(() => expect(dispatchPick).toHaveBeenCalled())
    expect(dispatchPick.mock.calls[0][0].operation).toBe("pdf_to_docx")
  })

  it("uses shared PDF analysis recommendation in mobile params panel", async () => {
    api.getOperations.mockResolvedValue({
      operations: [
        { operation: "pdf_to_docx", kind: "backend_job", intent: "convert", label: "PDF to Word", targets: ["docx"], output_type: "docx", params_schema: { high_fidelity: { type: "boolean", default: false } } },
      ],
    })
    api.createJob.mockResolvedValue({ job_id: "job-ana", upload: { url: "https://upload", fields: {} } })
    api.uploadToS3.mockResolvedValue(undefined)
    api.analyzePdf.mockResolvedValue({ recommendation: "image" })

    render(<MobileHome />, { wrapper: Providers })
    fireEvent.change(screen.getByLabelText("File upload drop zone", { selector: "input" }), {
      target: { files: [new File(["x"], "sample.pdf", { type: "application/pdf" })] },
    })

    await waitFor(() => expect(screen.getByRole("combobox")).toBeTruthy())
    await waitFor(() => expect(api.analyzePdf).toHaveBeenCalled())
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "pdf_to_docx:docx" } })
    fireEvent.click(screen.getByRole("button", { name: /Process/ }))
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /high fidelity/i })).toBeChecked())
  })
})
