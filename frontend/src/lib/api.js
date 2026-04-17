const ENV_API_URL = import.meta.env.VITE_API_URL || "";

function stripTrailingSlash(url) {
  return String(url || "").replace(/\/+$/, "");
}

function resolveApiUrl() {
  if (!ENV_API_URL) return "";

  const hasWindow = typeof window !== "undefined" && window?.location?.origin;
  if (!hasWindow) return stripTrailingSlash(ENV_API_URL);

  try {
    const u = new URL(ENV_API_URL, window.location.origin);
    return stripTrailingSlash(u.toString());
  } catch {
    return stripTrailingSlash(ENV_API_URL);
  }
}

const API_URL = resolveApiUrl();

if (!API_URL && import.meta.env.DEV) {
  console.warn("[api] API base URL is not set — requests will fail");
}

async function parseResponse(res) {
  const ct = res.headers.get("content-type") || "";

  if (!ct.includes("application/json")) {
    const text = await res.text();
    const trimmed = (text || "").trim();
    const looksLikeHtml = trimmed.startsWith("<!doctype") || trimmed.startsWith("<html");
    if (looksLikeHtml) {
      return {
        ok: false,
        status: res.status,
        data: {
          error:
            "Backend misconfigured: received HTML from API endpoint. Verify VITE_API_URL points to the API Gateway stage URL (or use /api via CloudFront).",
        },
      };
    }
    return { ok: res.ok, status: res.status, data: { error: trimmed || "Non-JSON response from server" } };
  }

  try {
    const json = await res.json();
    return { ok: res.ok, status: res.status, data: json };
  } catch (e) {
    const text = await res.text().catch(() => "");
    const msg = text || "Invalid JSON response from server";
    return { ok: false, status: res.status, data: { error: msg } };
  }
}

async function request(method, path, body = null) {
  if (!API_URL) throw new Error("Backend not configured. Set VITE_API_URL.");

  let authToken = "";
  try {
    authToken = localStorage.getItem("superdoc_id_token") || "";
  } catch {
    authToken = "";
  }

  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (authToken) opts.headers.Authorization = `Bearer ${authToken}`;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_URL}${path}`, opts);

  const parsed = await parseResponse(res);
  if (!parsed.ok) throw new Error(parsed.data.error || `HTTP ${parsed.status}`);
  return parsed.data;
}

export const api = {
  // Create a job and get a presigned upload URL
  createJob: (payload) => request("POST", "/jobs", payload),
  createUserJob: (payload) => request("POST", "/users/me/jobs", payload),

  // Get job status (poll this)
  getStatus: (jobId) => request("GET", `/jobs/${jobId}`),

  // Upload file directly to S3 via presigned POST
  uploadToS3: async (upload, file) => {
    // Backward compatible: older backend returns a presigned PUT URL string.
    if (typeof upload === "string") {
      const res = await fetch(upload, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });
      if (!res.ok) throw new Error(`S3 upload failed: ${res.status}`);
      return;
    }

    if (!upload || !upload.url || !upload.fields) {
      throw new Error("Invalid upload configuration from server");
    }

    const form = new FormData();
    const fields = upload.fields;
    for (const key of Object.keys(fields)) {
      form.append(key, fields[key]);
    }
    form.append("file", file);

    const res = await fetch(upload.url, { method: "POST", body: form });
    if (!res.ok) throw new Error(`S3 upload failed: ${res.status}`);
  },

  // Trigger processing after upload
  triggerProcess: (jobId) => request("POST", `/jobs/${jobId}/process`),

  // User files (requires auth)
  getUserFiles: () => request("GET", "/users/me/files"),
  deleteUserFile: (jobId) => request("DELETE", `/users/me/files/${jobId}`),
  createUserFile: (payload) => request("POST", "/users/me/files", payload),
  completeUserFile: (jobId) => request("POST", `/users/me/files/${jobId}/complete`),

  // Health check
  health: () => request("GET", "/health"),
};
