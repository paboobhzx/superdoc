import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  api: {
    createJob: vi.fn(),
    createUserJob: vi.fn(),
    uploadToS3: vi.fn(),
    triggerProcess: vi.fn(),
  },
}));

import { api } from "../lib/api";
import { handleBackendJob, createAndUploadOnly } from "../pages/Home/pickerRouting";

describe("pickerRouting authenticated job fallback session", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("passes session_id to createUserJob for authenticated conversions", async () => {
    api.createUserJob.mockResolvedValue({ job_id: "job-1", upload: { url: "https://upload", fields: {} } });
    api.uploadToS3.mockResolvedValue(undefined);
    api.triggerProcess.mockResolvedValue(undefined);

    await handleBackendJob({
      file: new File(["x"], "sample.pdf", { type: "application/pdf" }),
      operation: "pdf_to_docx",
      params: { high_fidelity: false },
      auth: { isAuthenticated: true },
      sessionId: "session-123",
      retentionChoice: "extended",
    });

    expect(api.createUserJob).toHaveBeenCalledWith({
      operation: "pdf_to_docx",
      file_size_bytes: 1,
      file_name: "sample.pdf",
      params: { high_fidelity: false },
      retention_choice: "extended",
      session_id: "session-123",
    });
  });

  it("passes session_id to createUserJob for authenticated pre-analysis uploads", async () => {
    api.createUserJob.mockResolvedValue({
      job_id: "job-2",
      file_key: "users/u/uploads/job-2/sample.pdf",
      upload: { url: "https://upload", fields: {} },
    });
    api.uploadToS3.mockResolvedValue(undefined);

    await createAndUploadOnly({
      file: new File(["x"], "sample.pdf", { type: "application/pdf" }),
      operation: "pdf_to_docx",
      auth: { isAuthenticated: true },
      sessionId: "session-123",
      retentionChoice: "default",
    });

    expect(api.createUserJob).toHaveBeenCalledWith({
      operation: "pdf_to_docx",
      file_size_bytes: 1,
      file_name: "sample.pdf",
      retention_choice: "default",
      session_id: "session-123",
    });
  });

  it("requests and uploads image watermark extra file", async () => {
    const watermark = new File(["png"], "logo.png", { type: "image/png" });
    api.createJob.mockResolvedValue({
      job_id: "job-3",
      upload: { url: "https://main", fields: {} },
      extra_uploads: [{ role: "watermark_image", upload: { url: "https://extra", fields: {} } }],
    });
    api.uploadToS3.mockResolvedValue(undefined);
    api.triggerProcess.mockResolvedValue(undefined);

    await handleBackendJob({
      file: new File(["x"], "sample.pdf", { type: "application/pdf" }),
      operation: "pdf_annotate",
      params: {
        watermark_type: "image",
        opacity: 0.4,
        __extraFiles: [{ role: "watermark_image", file: watermark }],
      },
      auth: { isAuthenticated: false },
      sessionId: "session-123",
    });

    expect(api.createJob).toHaveBeenCalledWith({
      operation: "pdf_annotate",
      file_size_bytes: 1,
      file_name: "sample.pdf",
      params: { watermark_type: "image", opacity: 0.4 },
      extra_files: [{ role: "watermark_image", file_name: "logo.png", file_size_bytes: 3, content_type: "image/png" }],
      retention_choice: "default",
      session_id: "session-123",
    });
    expect(api.uploadToS3).toHaveBeenCalledTimes(2);
    expect(api.uploadToS3).toHaveBeenLastCalledWith({ url: "https://extra", fields: {} }, watermark);
  });
});
