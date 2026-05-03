import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { render, screen, act } from "@testing-library/react"
import { MemoryRouter, Routes, Route } from "react-router-dom"
import { ThemeProvider } from "../context/ThemeContext"
import { I18nProvider } from "../context/I18nContext"

const jobStates = {
  current: null,
}

vi.mock("../hooks/useJob", () => ({
  useJob: () => ({
    job: jobStates.current,
    loading: false,
    error: null,
  }),
}))

describe("Processing page", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    jobStates.current = null
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("shows a live countdown and real lifecycle labels", async () => {
    jobStates.current = {
      job_id: "abc",
      status: "PROCESSING",
      operation: "pdf_to_txt",
      file_size_bytes: 1024,
      started_at: Math.floor(Date.now() / 1000) - 5,
      estimated_seconds: 10,
      download_url: "",
    }

    const { Processing } = await import("../pages/Processing/Processing")

    render(
      <MemoryRouter initialEntries={["/processing/abc"]}>
        <I18nProvider>
          <ThemeProvider>
            <Routes>
              <Route path="/processing/:jobId" element={<Processing />} />
            </Routes>
          </ThemeProvider>
        </I18nProvider>
      </MemoryRouter>
    )

    expect(screen.getByText("Queued")).toBeTruthy()
    expect(screen.getByText("Processing")).toBeTruthy()
    expect(screen.getByText("Finalizing")).toBeTruthy()

    expect(screen.getByText(/Estimated: ~5s remaining/)).toBeTruthy()

    await act(async () => {
      vi.advanceTimersByTime(2000)
    })

    expect(screen.getByText(/Estimated: ~3s remaining/)).toBeTruthy()
  })

  it("shows completion duration when the job is done", async () => {
    jobStates.current = {
      job_id: "abc",
      status: "DONE",
      operation: "docx_to_pdf",
      file_size_bytes: 1024,
      actual_seconds: 8,
      download_url: "https://download.example.com/out.pdf",
    }

    const { Processing } = await import("../pages/Processing/Processing")

    render(
      <MemoryRouter initialEntries={["/processing/abc"]}>
        <I18nProvider>
          <ThemeProvider>
            <Routes>
              <Route path="/processing/:jobId" element={<Processing />} />
            </Routes>
          </ThemeProvider>
        </I18nProvider>
      </MemoryRouter>
    )

    expect(screen.getByText("Completed in 8s")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Download file" })).toBeTruthy()
  })
})
