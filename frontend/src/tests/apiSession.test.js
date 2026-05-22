import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("cookie session API", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_API_URL", "https://api.example.com");
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("../lib/toast");
    vi.restoreAllMocks();
  });

  it("sends credentials without forwarding a browser-stored bearer token", async () => {
    localStorage.setItem("superdoc_id_token", "test.jwt.token");
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ ok: true }),
    }));

    const { api } = await import("../lib/api");
    await api.getUserFiles();

    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.com/users/me/files",
      expect.objectContaining({
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it("threads anonymous session IDs through file-history helpers", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ ok: true }),
    }));

    const { api } = await import("../lib/api");
    await api.getUserFiles("session-123");
    await api.deleteUserFile("job-1", "session-123");
    await api.createUserFile({ file_name: "a.pdf", file_size_bytes: 1 }, "session-123");
    await api.completeUserFile("job-1", "session-123");

    expect(fetch.mock.calls.map((call) => call[0])).toEqual([
      "https://api.example.com/users/me/files?session_id=session-123",
      "https://api.example.com/users/me/files/job-1?session_id=session-123",
      "https://api.example.com/users/me/files?session_id=session-123",
      "https://api.example.com/users/me/files/job-1/complete?session_id=session-123",
    ]);
  });

  it("suppresses background 403 toasts for user settings", async () => {
    const toastError = vi.fn();
    vi.doMock("../lib/toast", () => ({
      notify: { error: toastError },
    }));
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 403,
      headers: { get: () => "application/json" },
      json: async () => ({ error: "Forbidden" }),
    }));

    const { api } = await import("../lib/api");
    await expect(api.getUserSettings()).rejects.toMatchObject({ status: 403 });
    expect(toastError).not.toHaveBeenCalled();
  });

  it("sends analysis result when triggering a pre-analyzed job", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 202,
      headers: { get: () => "application/json" },
      json: async () => ({ success: true }),
    }));

    const { api } = await import("../lib/api");
    await api.triggerProcess("job-1", { high_fidelity: false }, { recommendation: "text", complexity_score: 72 });

    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.com/jobs/job-1/process",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          params: { high_fidelity: false },
          analysis_result: { recommendation: "text", complexity_score: 72 },
        }),
      }),
    );
  });

  it("calls the repair endpoint with session id when requested", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ success: true, repaired: true }),
    }));

    const { api } = await import("../lib/api");
    await api.repairPdf("job-2", "session-abc");

    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.com/jobs/job-2/repair?session_id=session-abc",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
