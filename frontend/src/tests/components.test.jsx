import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider, useTheme } from "../context/ThemeContext";

// ── ThemeContext ────────────────────────────────────────────────────────────

describe("ThemeContext", () => {
  afterEach(() => localStorage.clear());

  it("defaults to azure theme", () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }) => <ThemeProvider>{children}</ThemeProvider>,
    });
    expect(result.current.theme).toBe("azure");
  });

  it("provides 5 themes", () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }) => <ThemeProvider>{children}</ThemeProvider>,
    });
    expect(result.current.themes).toHaveLength(5);
  });
});

// ── Home page ──────────────────────────────────────────────────────────────

describe("Home page", () => {
  it("renders hero and tools grid", async () => {
    const { Home } = await import("../pages/Home/Home");
    render(
      <BrowserRouter>
        <ThemeProvider>
          <Home />
        </ThemeProvider>
      </BrowserRouter>
    );
    expect(screen.getByText(/Transform Any File/)).toBeTruthy();
    expect(screen.getByText("PDF Tools")).toBeTruthy();
    expect(screen.getByText("Documents")).toBeTruthy();
    expect(screen.getByText("Images")).toBeTruthy();
    expect(screen.getByText("Video")).toBeTruthy();
  });

  it("shows drop zone with format pills", async () => {
    const { Home } = await import("../pages/Home/Home");
    render(
      <BrowserRouter>
        <ThemeProvider>
          <Home />
        </ThemeProvider>
      </BrowserRouter>
    );
    expect(screen.getByText("Drop any file here")).toBeTruthy();
    ["PDF", "DOCX", "MP4", "PNG"].forEach((fmt) => {
      expect(screen.getByText(fmt)).toBeTruthy();
    });
  });

  it("shows $1/video badge", async () => {
    const { Home } = await import("../pages/Home/Home");
    render(
      <BrowserRouter>
        <ThemeProvider>
          <Home />
        </ThemeProvider>
      </BrowserRouter>
    );
    expect(screen.getByText("$1 / video")).toBeTruthy();
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

// ── Auth pages render ──────────────────────────────────────────────────────

describe("Auth pages", () => {
  it("Login renders without AppShell", async () => {
    const { Login } = await import("../pages/auth/Login");
    render(
      <BrowserRouter>
        <ThemeProvider>
          <Login />
        </ThemeProvider>
      </BrowserRouter>
    );
    expect(screen.getByText("Sign in")).toBeTruthy();
    expect(screen.getByText("Continue without account")).toBeTruthy();
  });

  it("Register renders with strength bar", async () => {
    const { Register } = await import("../pages/auth/Register");
    render(
      <BrowserRouter>
        <ThemeProvider>
          <Register />
        </ThemeProvider>
      </BrowserRouter>
    );
    expect(screen.getByText("Create account")).toBeTruthy();
    expect(screen.getByText(/No credit card/)).toBeTruthy();
  });

  it("ConfirmEmail renders OTP inputs", async () => {
    const { ConfirmEmail } = await import("../pages/auth/ConfirmEmail");
    render(
      <BrowserRouter>
        <ThemeProvider>
          <ConfirmEmail />
        </ThemeProvider>
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
        <ThemeProvider>
          <Settings />
        </ThemeProvider>
      </BrowserRouter>
    );
    expect(screen.getByText("Profile")).toBeTruthy();
    expect(screen.getByText("Security")).toBeTruthy();
    expect(screen.getByText("Notifications")).toBeTruthy();
    expect(screen.getByText("Theme")).toBeTruthy();
    expect(screen.getByText("Danger Zone")).toBeTruthy();
  });

  it("shows 5 theme swatches", async () => {
    const { Settings } = await import("../pages/Settings");
    render(
      <BrowserRouter>
        <ThemeProvider>
          <Settings />
        </ThemeProvider>
      </BrowserRouter>
    );
    expect(screen.getByText("Azure")).toBeTruthy();
    expect(screen.getByText("Dark")).toBeTruthy();
    expect(screen.getByText("Orange")).toBeTruthy();
    expect(screen.getByText("Galaxy")).toBeTruthy();
    expect(screen.getByText("Brasil")).toBeTruthy();
  });
});
