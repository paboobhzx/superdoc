import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { BrowserRouter, MemoryRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider, useTheme } from "../context/ThemeContext";
import { I18nProvider, useI18n } from "../context/I18nContext";

function Providers({ children }) {
  return (
    <I18nProvider>
      <ThemeProvider>{children}</ThemeProvider>
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
    expect(result.current.themes.map((theme) => theme.id)).toEqual(["azure", "dark"]);
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
});

// ── useJob hook ────────────────────────────────────────────────────────────

vi.mock("../lib/api", () => ({
  api: { getStatus: vi.fn() },
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
    expect(screen.getByRole("button", { name: /Switch to Dark mode/i })).toBeTruthy();
  });

  it("renders design navigation links", async () => {
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
