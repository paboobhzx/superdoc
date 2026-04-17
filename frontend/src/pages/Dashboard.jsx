import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return "";
  const mb = bytes / 1024 / 1024;
  return `${mb.toFixed(1)} MB`;
}

function formatWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

export function Dashboard() {
  const auth = useAuth();
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [err, setErr] = useState("");
  const [jobs, setJobs] = useState([]);

  const canLoad = Boolean(auth?.isAuthenticated);

  const sorted = useMemo(() => {
    return [...jobs].sort((a, b) => {
      const ta = new Date(a.created_at || 0).getTime();
      const tb = new Date(b.created_at || 0).getTime();
      return tb - ta;
    });
  }, [jobs]);

  useEffect(() => {
    if (!canLoad) return;

    let active = true;
    async function load() {
      setErr("");
      setLoading(true);
      try {
        const data = await api.getUserFiles();
        if (!active) return;
        setJobs(data.jobs || []);
      } catch (e) {
        if (!active) return;
        setErr(e.message || "Failed to load files.");
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [canLoad]);

  async function onDelete(jobId) {
    setErr("");
    if (!jobId) return;
    const ok = confirm("Delete this file? This cannot be undone.");
    if (!ok) return;

    setDeletingId(jobId);
    try {
      await api.deleteUserFile(jobId);
      setJobs((prev) => prev.filter((j) => j.job_id !== jobId));
    } catch (e) {
      setErr(e.message || "Delete failed.");
    } finally {
      setDeletingId("");
    }
  }

  if (!auth?.configured) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-bold font-headline text-on-surface mb-2">Files</h1>
        <p className="text-on-surface-variant">
          Auth is not configured. Set <code>VITE_COGNITO_USER_POOL_ID</code> and <code>VITE_COGNITO_CLIENT_ID</code>.
        </p>
      </div>
    );
  }

  if (!auth.isAuthenticated) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-bold font-headline text-on-surface mb-2">Files</h1>
        <p className="text-on-surface-variant mb-6">
          Sign in to view your saved conversions. Registered users can store up to 10 documents for 7 days.
        </p>
        <div className="flex gap-3">
          <Link
            to="/auth/login"
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-primary text-on-primary font-bold text-sm hover:opacity-90 transition-opacity no-underline"
          >
            Sign in
            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
          </Link>
          <Link
            to="/auth/register"
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl border border-outline-variant/20 text-on-surface font-semibold text-sm hover:bg-surface-container transition-colors no-underline"
          >
            Create account
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold font-headline text-on-surface">Files</h1>
          <p className="text-sm text-on-surface-variant">Up to 10 documents · stored for 7 days</p>
        </div>
        <button
          onClick={() => auth.signOut()}
          className="px-4 py-2 rounded-xl border border-outline-variant/20 text-on-surface font-semibold text-sm hover:bg-surface-container transition-colors"
        >
          Sign out
        </button>
      </div>

      {err && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-error-container/20 border border-error/20 text-on-error-container mb-6">
          <span className="material-symbols-outlined text-error text-[20px]">warning</span>
          <span className="text-sm font-medium">{err}</span>
        </div>
      )}

      <div className="rounded-2xl bg-surface-container-lowest border border-outline-variant/10 overflow-hidden">
        <div className="px-5 py-4 border-b border-outline-variant/10 flex items-center justify-between">
          <span className="font-bold text-on-surface">Recent</span>
          {loading && <span className="text-xs text-on-surface-variant">Loading…</span>}
        </div>

        {sorted.length === 0 && !loading ? (
          <div className="p-6 text-on-surface-variant text-sm">
            No files yet. Upload something from <Link to="/" className="text-primary font-semibold no-underline hover:underline">Home</Link>.
          </div>
        ) : (
          <ul className="divide-y divide-outline-variant/10">
            {sorted.map((job) => (
              <li key={job.job_id} className="p-5 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-on-surface truncate">
                      {job.file_name || job.job_id?.slice(0, 8)}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary/10 text-primary">
                      {job.status}
                    </span>
                  </div>
                  <div className="text-xs text-on-surface-variant mt-1">
                    {job.operation ? job.operation.replace(/_/g, " ") : ""}
                    {job.file_size_bytes ? ` · ${formatBytes(job.file_size_bytes)}` : ""}
                    {job.created_at ? ` · ${formatWhen(job.created_at)}` : ""}
                  </div>
                </div>

                <div className="flex gap-2">
                  <Link
                    to={`/processing/${job.job_id}`}
                    className="px-4 py-2 rounded-xl border border-outline-variant/20 text-on-surface font-semibold text-sm hover:bg-surface-container transition-colors no-underline"
                  >
                    View
                  </Link>
                  {job.download_url ? (
                    <a
                      href={job.download_url}
                      className="px-4 py-2 rounded-xl bg-primary text-on-primary font-bold text-sm hover:opacity-90 transition-opacity no-underline"
                    >
                      Download
                    </a>
                  ) : null}
                  <button
                    onClick={() => onDelete(job.job_id)}
                    disabled={deletingId === job.job_id}
                    className="px-4 py-2 rounded-xl border border-outline-variant/20 text-on-surface font-semibold text-sm hover:bg-surface-container transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {deletingId === job.job_id ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
