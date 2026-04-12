import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProgressBar } from "../components/ProgressBar/ProgressBar";
import { DropZone }    from "../components/DropZone/DropZone";
import { renderHook, act } from "@testing-library/react";
import { useJob }      from "../hooks/useJob";

// ── ProgressBar ────────────────────────────────────────────────────────────

describe("ProgressBar", () => {
  it("shows QUEUED state correctly", () => {
    render(<ProgressBar status="QUEUED" estimatedSeconds={30} />);
    expect(screen.getByText("Uploading")).toBeTruthy();
  });

  it("shows estimated time when processing", () => {
    render(<ProgressBar status="PROCESSING" estimatedSeconds={45} />);
    expect(screen.getByText(/45s remaining/)).toBeTruthy();
  });

  it("shows completed message when DONE", () => {
    render(<ProgressBar status="DONE" actualSeconds={38} />);
    expect(screen.getByText(/Completed in 38s/)).toBeTruthy();
  });

  it("shows error message when FAILED", () => {
    render(<ProgressBar status="FAILED" />);
    expect(screen.getByText(/Processing failed/)).toBeTruthy();
  });

  it("does not show ETA when estimatedSeconds is 0", () => {
    const { container } = render(<ProgressBar status="PROCESSING" estimatedSeconds={0} />);
    expect(container.textContent).not.toMatch(/remaining/);
  });
});

// ── DropZone ───────────────────────────────────────────────────────────────

describe("DropZone", () => {
  it("renders upload prompt", () => {
    render(<DropZone onFile={vi.fn()} />);
    expect(screen.getByText("Drop any file here")).toBeTruthy();
    expect(screen.getByText("Browse files")).toBeTruthy();
  });

  it("shows release text when dragging", () => {
    const { container } = render(<DropZone onFile={vi.fn()} />);
    const zone = container.firstChild;
    fireEvent.dragOver(zone, { preventDefault: () => {} });
    expect(screen.getByText("Release to upload")).toBeTruthy();
  });

  it("calls onFile with dropped file", () => {
    const onFile = vi.fn();
    const { container } = render(<DropZone onFile={onFile} />);
    const zone = container.firstChild;
    const file = new File(["content"], "test.pdf", { type: "application/pdf" });
    fireEvent.drop(zone, {
      preventDefault: () => {},
      dataTransfer: { files: [file] },
    });
    expect(onFile).toHaveBeenCalledWith(file);
  });

  it("is not interactive when disabled", () => {
    const onFile = vi.fn();
    const { container } = render(<DropZone onFile={onFile} disabled />);
    const zone = container.firstChild;
    expect(zone.getAttribute("tabIndex")).toBe("-1");
  });

  it("renders all format pills", () => {
    render(<DropZone onFile={vi.fn()} />);
    ["PDF", "DOCX", "MP4", "PNG"].forEach((fmt) => {
      expect(screen.getByText(fmt)).toBeTruthy();
    });
  });
});

// ── useJob hook ────────────────────────────────────────────────────────────

vi.mock("../lib/api", () => ({
  api: {
    getStatus: vi.fn(),
  },
}));

import { api } from "../lib/api";

describe("useJob", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns null job when no jobId", () => {
    const { result } = renderHook(() => useJob(null));
    expect(result.current.job).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("polls and sets job on success", async () => {
    api.getStatus.mockResolvedValue({ job_id: "abc", status: "DONE", actual_seconds: 5 });
    const { result } = renderHook(() => useJob("abc"));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.job).not.toBeNull());
    expect(result.current.job.status).toBe("DONE");
    expect(result.current.loading).toBe(false);
  });

  it("sets error on API failure", async () => {
    api.getStatus.mockRejectedValue(new Error("Network error"));
    const { result } = renderHook(() => useJob("bad-id"));
    await waitFor(() => expect(result.current.error).toBe("Network error"));
    expect(result.current.loading).toBe(false);
  });

  it("stops polling once DONE", async () => {
    api.getStatus.mockResolvedValue({ job_id: "x", status: "DONE" });
    const { result } = renderHook(() => useJob("x"));
    await waitFor(() => expect(api.getStatus).toHaveBeenCalledTimes(1));
    expect(result.current.job.status).toBe("DONE");
  });
});
