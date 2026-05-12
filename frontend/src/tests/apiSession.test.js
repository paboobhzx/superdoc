import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("cookie session API", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_API_URL", "https://api.example.com");
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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
});
