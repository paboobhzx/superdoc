const API_URL = import.meta.env.VITE_API_URL || "";

async function request(method, path, body = null) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_URL}${path}`, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  // Create a job and get a presigned upload URL
  createJob: (payload) => request("POST", "/jobs", payload),

  // Get job status (poll this)
  getStatus: (jobId) => request("GET", `/jobs/${jobId}`),

  // Upload file directly to S3 via presigned URL
  uploadToS3: async (uploadUrl, file) => {
    const res = await fetch(uploadUrl, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": file.type || "application/octet-stream" },
    });
    if (!res.ok) throw new Error(`S3 upload failed: ${res.status}`);
  },

  // Trigger processing after upload
  triggerProcess: (jobId) => request("POST", `/jobs/${jobId}/process`),

  // Health check
  health: () => request("GET", "/health"),
};
