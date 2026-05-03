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
});
