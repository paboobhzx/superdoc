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
    });

    expect(api.createUserJob).toHaveBeenCalledWith({
      operation: "pdf_to_docx",
      file_size_bytes: 1,
      file_name: "sample.pdf",
      params: { high_fidelity: false },
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
    });

    expect(api.createUserJob).toHaveBeenCalledWith({
      operation: "pdf_to_docx",
      file_size_bytes: 1,
      file_name: "sample.pdf",
      session_id: "session-123",
    });
  });
});
