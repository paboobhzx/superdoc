import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { BrowserRouter, MemoryRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider, useTheme } from "../context/ThemeContext";
import { I18nProvider, useI18n } from "../context/I18nContext";
import { AuthProvider } from "../context/AuthContext";

function Providers({ children }) {
  return (
    <I18nProvider>
      <ThemeProvider>
        <AuthProvider>{children}</AuthProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}

// ── ThemeContext ────────────────────────────────────────────────────────────

describe("ThemeContext", () => {
  afterEach(() => localStorage.clear());

  it("defaults to Azure Blue theme", () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: Providers,
    });
    expect(result.current.theme).toBe("azure");
  });

  it("provides Azure Blue and dark themes", () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: Providers,
    });
    expect(result.current.themes.map((theme) => theme.id)).toEqual(["azure", "orange", "gray", "brown", "dark"]);
  });

  it("migrates stored light preference to Azure Blue", () => {
    localStorage.setItem("superdoc-theme", "light");
    const { result } = renderHook(() => useTheme(), {
      wrapper: Providers,
    });
    expect(result.current.theme).toBe("azure");
  });
});

// ── I18nContext ────────────────────────────────────────────────────────────

describe("I18nContext", () => {
  afterEach(() => localStorage.clear());

  it("falls back to the key when a translation is missing", () => {
    const { result } = renderHook(() => useI18n(), { wrapper: Providers });
    expect(result.current.t("missing.key")).toBe("missing.key");
  });

  it("uses a persisted locale override", () => {
    localStorage.setItem("superdoc-locale", "pt-BR");
    const { result } = renderHook(() => useI18n(), { wrapper: Providers });
    expect(result.current.locale).toBe("pt-BR");
    expect(result.current.t("settings.title")).toBe("Configuracoes");
  });
});

// ── ParamsPanel ────────────────────────────────────────────────────────────

describe("ParamsPanel", () => {
  it("opens pdf_to_docx with high fidelity unchecked by default", async () => {
    const { ParamsPanel } = await import("../components/ParamsPanel");
    const onConfirm = vi.fn();
    render(
      <Providers>
        <ParamsPanel
          opMeta={{
            operation: "pdf_to_docx",
            params_schema: { high_fidelity: { type: "boolean", default: true } },
          }}
          onConfirm={onConfirm}
          onCancel={() => {}}
        />
      </Providers>
    );

    expect(screen.getByRole("checkbox", { name: /high fidelity/i })).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: /convert/i }));
    expect(onConfirm).toHaveBeenCalledWith({ high_fidelity: false });
  });

  it("applies ready PDF analysis recommendations to the high fidelity checkbox", async () => {
    const { ParamsPanel } = await import("../components/ParamsPanel");
    const opMeta = {
      operation: "pdf_to_docx",
      params_schema: { high_fidelity: { type: "boolean", default: false } },
    };
    const { rerender } = render(
      <Providers>
        <ParamsPanel
          opMeta={opMeta}
          onConfirm={() => {}}
          onCancel={() => {}}
          analysisState="ready"
          analysisResult={{ recommendation: "image" }}
        />
      </Providers>
    );

    expect(screen.getByRole("checkbox", { name: /high fidelity/i })).toBeChecked();

    rerender(
      <Providers>
        <ParamsPanel
          opMeta={opMeta}
          onConfirm={() => {}}
          onCancel={() => {}}
          analysisState="ready"
          analysisResult={{ recommendation: "text" }}
        />
      </Providers>
    );

    await waitFor(() => expect(screen.getByRole("checkbox", { name: /high fidelity/i })).not.toBeChecked());
  });

  it("keeps the PDF analysis report closed until requested", async () => {
    const { ParamsPanel } = await import("../components/ParamsPanel");
    render(
      <Providers>
        <ParamsPanel
          opMeta={{
            operation: "pdf_to_docx",
            params_schema: { high_fidelity: { type: "boolean", default: false } },
          }}
          onConfirm={() => {}}
          onCancel={() => {}}
          analysisState="ready"
          analysisResult={{
            recommendation: "text",
            complexity_score: 72,
            high_fidelity_viable: false,
            regular_text_viable: true,
            page_count: 3,
            file_size_mb: 1.5,
            rationale_keys: ["high_fidelity_risk"],
            signals: {
              producer: "FPDF",
              mean_xobjects_per_page: 12,
              text_extractable_ratio: 0.9,
              image_coverage_ratio: 0.2,
              column_count_hint: 2,
            },
            estimated_seconds: { image: 8, text: 24 },
          }}
        />
      </Providers>
    );

    expect(screen.getByText(/Editable Word text/i)).toBeTruthy();
    expect(screen.queryByText("Complexity")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /view analysis report/i }));

    expect(screen.getByText("Complexity")).toBeTruthy();
    expect(screen.getByText("72")).toBeTruthy();
    expect(screen.getByText("Producer")).toBeTruthy();
    expect(screen.getByText("FPDF")).toBeTruthy();
    expect(screen.getByText("Text extractability")).toBeTruthy();
    expect(screen.getByText("90%")).toBeTruthy();
  });

  it("allows manual override after an analysis recommendation", async () => {
    const { ParamsPanel } = await import("../components/ParamsPanel");
    const onConfirm = vi.fn();
    render(
      <Providers>
        <ParamsPanel
          opMeta={{
            operation: "pdf_to_docx",
            params_schema: { high_fidelity: { type: "boolean", default: false } },
          }}
          onConfirm={onConfirm}
          onCancel={() => {}}
          analysisState="ready"
          analysisResult={{ recommendation: "image", rationale_keys: ["high_fidelity_viable"] }}
        />
      </Providers>
    );

    const checkbox = screen.getByRole("checkbox", { name: /high fidelity/i });
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: /convert/i }));
    expect(onConfirm).toHaveBeenCalledWith({ high_fidelity: false });
  });

  it("renders generic schema controls and returns typed params", async () => {
    const { ParamsPanel } = await import("../components/ParamsPanel");
    const onConfirm = vi.fn();
    render(
      <Providers>
        <ParamsPanel
          opMeta={{
            operation: "pdf_remove_watermark",
            params_schema: {
              watermark_text: { type: "string", default: "DRAFT", label: "Watermark text" },
              dry_run: { type: "boolean", default: false, label: "Dry run report" },
              confidence_min: { type: "float", default: 0.6, minimum: 0.3, maximum: 1, label: "Minimum confidence" },
              case: { type: "enum", values: ["auto", "annot", "xobject"], default: "auto", label: "Detection mode" },
            },
          }}
          onConfirm={onConfirm}
          onCancel={() => {}}
        />
      </Providers>
    );

    fireEvent.change(screen.getByLabelText(/watermark text/i), { target: { value: "CONFIDENTIAL" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /dry run report/i }));
    fireEvent.change(screen.getByLabelText(/minimum confidence/i), { target: { value: "0.75" } });
    fireEvent.change(screen.getByLabelText(/detection mode/i), { target: { value: "xobject" } });
    fireEvent.click(screen.getByRole("button", { name: /convert/i }));

    expect(onConfirm).toHaveBeenCalledWith({
      watermark_text: "CONFIDENTIAL",
      dry_run: true,
      confidence_min: 0.75,
      case: "xobject",
    });
  });

  it("returns selected image watermark as an extra upload", async () => {
    const { ParamsPanel } = await import("../components/ParamsPanel");
    const onConfirm = vi.fn();
    render(
      <Providers>
        <ParamsPanel
          opMeta={{
            operation: "pdf_annotate",
            params_schema: {
              watermark_type: { type: "enum", values: ["text", "image"], default: "text", label: "Watermark type" },
              watermark_text: { type: "string", default: "DRAFT", label: "Text" },
              stamp_mode: { type: "enum", values: ["watermark", "header", "footer", "corner"], default: "watermark", label: "Placement" },
              opacity: { type: "float", default: 0.3, minimum: 0.05, maximum: 1, label: "Opacity" },
            },
          }}
          onConfirm={onConfirm}
          onCancel={() => {}}
        />
      </Providers>
    );

    const file = new File(["png"], "logo.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText(/watermark type/i), { target: { value: "image" } });
    fireEvent.change(screen.getByLabelText(/watermark image/i), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: /convert/i }));

    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      watermark_type: "image",
      __extraFiles: [{ role: "watermark_image", file }],
    }));
  });
});

// ── Home page ──────────────────────────────────────────────────────────────

describe("Home page", () => {
  it("renders hero and upload-first flow", async () => {
    const { Home } = await import("../pages/Home/Home");
    render(
      <BrowserRouter>
        <Providers>
          <Home />
        </Providers>
      </BrowserRouter>
    );
    expect(screen.getByText(/file workbench/)).toBeTruthy();
    expect(screen.getByText("Drop your file here")).toBeTruthy();
    expect(screen.getByText(/PDF, DOCX, Markdown, HTML/)).toBeTruthy();
  });

  it("shows drop zone with format pills", async () => {
    const { Home } = await import("../pages/Home/Home");
    render(
      <BrowserRouter>
        <Providers>
          <Home />
        </Providers>
      </BrowserRouter>
    );
    expect(screen.getByText("Drop your file here")).toBeTruthy();
    ["PDF", "DOCX", "XLSX", "PNG"].forEach((fmt) => {
      expect(screen.getAllByText(fmt).length).toBeGreaterThan(0);
    });
  });

  it("renders the requested footer attribution", async () => {
    const { Home } = await import("../pages/Home/Home");
    render(
      <BrowserRouter>
        <Providers>
          <Home />
        </Providers>
      </BrowserRouter>
    );
    expect(screen.getByText(/Developed by Zorak Software/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "http://pablobhz.cloud" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "LinkedIn" })).toBeTruthy();
  });

  it("shows the extended retention checkbox after single-file selection", async () => {
    localStorage.setItem("superdoc-locale", "en-US");
    api.getOperations.mockResolvedValue({
      operations: [
        { operation: "pdf_to_docx", kind: "backend_job", intent: "convert", label: "PDF to Word", targets: ["docx"], output_type: "docx", params_schema: {} },
      ],
    });
    const { Home } = await import("../pages/Home/Home");
    render(
      <BrowserRouter>
        <Providers>
          <Home />
        </Providers>
      </BrowserRouter>
    );

    fireEvent.change(screen.getByRole("button", { name: "File upload drop zone" }).querySelector("input"), {
      target: { files: [new File(["x"], "sample.pdf", { type: "application/pdf" })] },
    });

    const checkbox = await screen.findByRole("checkbox", { name: /Keep files for up to 12 hours/i });
    expect(checkbox).not.toBeChecked();
  });

  it("shows a PDF tools working strip after selecting a direct-start tool", async () => {
    localStorage.setItem("superdoc-locale", "en-US");
    api.getOperations.mockResolvedValue({
      operations: [
        { operation: "pdf_compress", kind: "backend_job", intent: "transform", label: "Compress PDF", targets: ["pdf"], output_type: "pdf", params_schema: {} },
      ],
    });
    api.createJob.mockResolvedValue({ job_id: "job-1", upload: { url: "https://upload", fields: {} } });
    api.uploadToS3.mockImplementation(() => new Promise(() => {}));
    api.triggerProcess.mockResolvedValue(undefined);
    const { Home } = await import("../pages/Home/Home");
    render(
      <BrowserRouter>
        <Providers>
          <Home />
        </Providers>
      </BrowserRouter>
    );

    fireEvent.change(screen.getByRole("button", { name: "File upload drop zone" }).querySelector("input"), {
      target: { files: [new File(["x"], "sample.pdf", { type: "application/pdf" })] },
    });
    fireEvent.click(await screen.findByRole("button", { name: /Compress PDF/i }));

    expect(await screen.findAllByText("Compress PDF")).not.toHaveLength(0);
    expect(screen.getByText(/Uploading · sample.pdf/i)).toBeTruthy();
  });

  it("shows the same retention checkbox for desktop batch selection", async () => {
    localStorage.setItem("superdoc-locale", "en-US");
    api.getOperations.mockResolvedValue({
      operations: [
        { operation: "pdf_to_docx", kind: "backend_job", intent: "convert", label: "PDF to Word", targets: ["docx"], output_type: "docx", params_schema: {} },
      ],
    });
    const { Home } = await import("../pages/Home/Home");
    render(
      <BrowserRouter>
        <Providers>
          <Home />
        </Providers>
      </BrowserRouter>
    );

    fireEvent.change(screen.getByRole("button", { name: "File upload drop zone" }).querySelector("input"), {
      target: {
        files: [
          new File(["x"], "a.pdf", { type: "application/pdf" }),
          new File(["y"], "b.pdf", { type: "application/pdf" }),
        ],
      },
    });

    const checkbox = await screen.findByRole("checkbox", { name: /Keep files for up to 12 hours/i });
    expect(checkbox).not.toBeChecked();
  });
});

// ── useJob hook ────────────────────────────────────────────────────────────

vi.mock("../lib/api", () => ({
  api: {
    getStatus: vi.fn(),
    getOperations: vi.fn(() => Promise.resolve({ operations: [] })),
    createJob: vi.fn(),
    createUserJob: vi.fn(),
    uploadToS3: vi.fn(),
    triggerProcess: vi.fn(),
    me: vi.fn(() => Promise.resolve({ user: null })),
    getUserSettings: vi.fn(() => Promise.resolve({})),
    logout: vi.fn(() => Promise.resolve({ ok: true })),
  },
}));

import { api } from "../lib/api";

describe("useJob", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns null job when no jobId", async () => {
    const { useJob } = await import("../hooks/useJob");
    const { result } = renderHook(() => useJob(null));
    expect(result.current.job).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("polls and sets job on success", async () => {
    api.getStatus.mockResolvedValue({ job_id: "abc", status: "DONE", actual_seconds: 5 });
    const { useJob } = await import("../hooks/useJob");
    const { result } = renderHook(() => useJob("abc"));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.job).not.toBeNull());
    expect(result.current.job.status).toBe("DONE");
  });

  it("sets error on API failure", async () => {
    api.getStatus.mockRejectedValue(new Error("Network error"));
    const { useJob } = await import("../hooks/useJob");
    const { result } = renderHook(() => useJob("bad-id"));
    await waitFor(() => expect(result.current.error).toBe("Network error"));
  });
});

// ── Processing page ────────────────────────────────────────────────────────

describe("Processing page", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders DONE without actual_seconds as Completed", async () => {
    api.getStatus.mockResolvedValue({
      job_id: "abc",
      status: "DONE",
      operation: "docx_to_pdf",
      file_size_bytes: 1024,
      download_url: "https://download.example.com/out.pdf",
    });
    const { Processing } = await import("../pages/Processing/Processing");

    render(
      <MemoryRouter initialEntries={["/processing/abc"]}>
        <Providers>
          <Routes>
            <Route path="/processing/:jobId" element={<Processing />} />
          </Routes>
        </Providers>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("Completed")).toBeTruthy());
    expect(screen.queryByText(/undefineds/)).toBeNull();
    expect(screen.getByRole("link", { name: "Download file" })).toBeTruthy();
  });
});

// ── Auth pages render ──────────────────────────────────────────────────────

describe("Auth pages", () => {
  it("Login renders without AppShell", async () => {
    const { Login } = await import("../pages/auth/Login");
    render(
      <BrowserRouter>
        <Providers>
          <Login />
        </Providers>
      </BrowserRouter>
    );
    expect(screen.getByText("Sign in")).toBeTruthy();
    expect(screen.getByText("Continue without account")).toBeTruthy();
  });

  it("Register renders with strength bar", async () => {
    const { Register } = await import("../pages/auth/Register");
    render(
      <BrowserRouter>
        <Providers>
          <Register />
        </Providers>
      </BrowserRouter>
    );
    expect(screen.getByText("Create account")).toBeTruthy();
    expect(screen.getByText(/No credit card/)).toBeTruthy();
  });

  it("ConfirmEmail renders OTP inputs", async () => {
    const { ConfirmEmail } = await import("../pages/auth/ConfirmEmail");
    render(
      <BrowserRouter>
        <Providers>
          <ConfirmEmail />
        </Providers>
      </BrowserRouter>
    );
    expect(screen.getByText("Check your email")).toBeTruthy();
    expect(screen.getByText("Confirm")).toBeTruthy();
  });
});

// ── Settings page ──────────────────────────────────────────────────────────

describe("Settings page", () => {
  it("renders all 5 sections", async () => {
    const { Settings } = await import("../pages/Settings");
    render(
      <BrowserRouter>
        <Providers>
          <Settings />
        </Providers>
      </BrowserRouter>
    );
    expect(screen.getByText("Profile")).toBeTruthy();
    expect(screen.getByText("Security")).toBeTruthy();
    expect(screen.getByText("Notifications")).toBeTruthy();
    expect(screen.getByText("Appearance")).toBeTruthy();
    expect(screen.getByText("Danger Zone")).toBeTruthy();
  });

  it("shows theme and language selectors", async () => {
    const { Settings } = await import("../pages/Settings");
    render(
      <BrowserRouter>
        <Providers>
          <Settings />
        </Providers>
      </BrowserRouter>
    );
    expect(screen.getByDisplayValue("Azure Blue")).toBeTruthy();
    expect(screen.getByDisplayValue("English (US)")).toBeTruthy();
  });
});

// ── AppShell ───────────────────────────────────────────────────────────────

describe("AppShell", () => {
  it("renders header with SuperDoc logo", async () => {
    const { default: AppShell } = await import(
      "../components/layout/AppShell"
    );
    render(
      <BrowserRouter>
        <Providers>
          <AppShell>
            <div>Content</div>
          </AppShell>
        </Providers>
      </BrowserRouter>
    );
    expect(screen.getByText("SuperDoc")).toBeTruthy();
  });

  it("renders dark/light theme toggle", async () => {
    const { default: AppShell } = await import(
      "../components/layout/AppShell"
    );
    render(
      <BrowserRouter>
        <Providers>
          <AppShell>
            <div>Content</div>
          </AppShell>
        </Providers>
      </BrowserRouter>
    );
    expect(screen.getByRole("button", { name: /Switch to Warm Orange mode/i })).toBeTruthy();
  });

  it("persists locale changes from the header selector", async () => {
    localStorage.setItem("superdoc-locale", "en-US");
    const { default: AppShell } = await import(
      "../components/layout/AppShell"
    );
    render(
      <BrowserRouter>
        <Providers>
          <AppShell>
            <div>Content</div>
          </AppShell>
        </Providers>
      </BrowserRouter>
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Change language" }), {
      target: { value: "pt-BR" },
    });

    await waitFor(() => expect(localStorage.getItem("superdoc-locale")).toBe("pt-BR"));
    expect(screen.getByText("Formatos")).toBeTruthy();
  });

  it("renders design navigation links", async () => {
    localStorage.setItem("superdoc-locale", "en-US");
    const { default: AppShell } = await import(
      "../components/layout/AppShell"
    );
    render(
      <BrowserRouter>
        <Providers>
          <AppShell>
            <div>Content</div>
          </AppShell>
        </Providers>
      </BrowserRouter>
    );
    expect(screen.getByText("Formats")).toBeTruthy();
    expect(screen.getByText("How it works")).toBeTruthy();
    expect(screen.getByText("FAQ")).toBeTruthy();
    expect(screen.getByText("Files")).toBeTruthy();
    expect(screen.queryByText("Settings")).toBeNull();
    expect(screen.queryByText("Sign in")).toBeNull();
  });

  it("renders aligned account menu actions", async () => {
    localStorage.setItem("superdoc-locale", "en-US");
    api.me.mockResolvedValueOnce({ user: { id: "user-1", email: "test@example.com" } });
    const { default: AppShell } = await import(
      "../components/layout/AppShell"
    );
    render(
      <BrowserRouter>
        <Providers>
          <AppShell>
            <div>Content</div>
          </AppShell>
        </Providers>
      </BrowserRouter>
    );

    const account = await screen.findByRole("button", { name: /account|conta/i });
    fireEvent.click(account);

    expect(screen.getByRole("link", { name: /profile/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /sign out/i })).toBeTruthy();
    expect(screen.getByText("test@example.com")).toBeTruthy();
  });

  it("renders the privacy page content", async () => {
    localStorage.setItem("superdoc-locale", "en-US");
    const { Privacy } = await import("../pages/Privacy");
    render(
      <BrowserRouter>
        <Providers>
          <Privacy />
        </Providers>
      </BrowserRouter>
    );

    expect(screen.getByText("How SuperDoc handles your files")).toBeTruthy();
    expect(screen.getByText("Temporary conversion jobs")).toBeTruthy();
  });
});

// ── api module ─────────────────────────────────────────────────────────────

describe("api module", () => {
  it("exports createJob, getStatus, uploadToS3, triggerProcess, health", async () => {
    // Re-import the actual module (bypass the mock) to check exports
    const apiModule = await vi.importActual("../lib/api");
    const { api: realApi } = apiModule;
    expect(typeof realApi.createJob).toBe("function");
    expect(typeof realApi.getStatus).toBe("function");
    expect(typeof realApi.uploadToS3).toBe("function");
    expect(typeof realApi.triggerProcess).toBe("function");
    expect(typeof realApi.health).toBe("function");
  });
});
