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

// Map specific HTTP codes to user-friendly copy. 429 gets special treatment
// because the default "Too many requests" scares users who can't self-serve.
const FRIENDLY_BY_STATUS = {
  401: "You need to sign in to do that.",
  403: "That action isn't available for your account.",
  404: "We couldn't find what you're looking for.",
  413: "That file is too large.",
  429: "You're going a little fast — take a short breath and try again.",
  500: "Something broke on our end. We're looking into it.",
  502: "Our backend is briefly unreachable. Try again in a moment.",
  503: "Service temporarily unavailable. Try again in a moment.",
  504: "The server took too long. Try again.",
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
  if (!parsed.ok) {
    const technical = parsed.data.error || `${method} ${path} -> HTTP ${parsed.status}`;
    const friendly = FRIENDLY_BY_STATUS[parsed.status] || technical;
    // Fire a toast so every API consumer gets feedback without plumbing.
    // Callers can still try/catch to suppress if they want custom handling.
    try {
      // Dynamic import keeps this file safe to load in environments without
      // the DOM (tests, SSR in theory). If the toast module is unavailable,
      // we swallow the failure — the thrown Error below is still the source
      // of truth for callers.
      const mod = await import("./toast");
      mod.notify.error({ message: friendly, httpCode: parsed.status, technical });
    } catch {
      // Toast unavailable — fall through to throwing.
    }
    const err = new Error(friendly);
    err.status = parsed.status;
    err.technical = technical;
    throw err;
  }
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

  // Fetch a short-lived presigned GET URL for an S3 key. Used by editors
  // to load a file uploaded via the client_editor flow.
  getPresignedDownload: (key) => {
    const qs = `?key=${encodeURIComponent(key)}`
    return request("GET", `/files/download${qs}`)
  },

  // Create a Stripe Checkout Session for a paid_backend_job. Returns
  // { payment_id, job_id, checkout_url }. The frontend redirects the user
  // to checkout_url. Fails with 503 if Stripe isn't configured yet.
  createCheckout: (payload) => request("POST", "/checkout", payload),


  // Fetch the catalog of supported operations.
  // Used by OperationPicker. The optional input_type filters to
  // operations that accept that file extension.
  getOperations: (inputType) => {
    const qs = inputType ? `?input_type=${encodeURIComponent(inputType)}` : ""
    return request("GET", `/operations${qs}`)
  },
};
