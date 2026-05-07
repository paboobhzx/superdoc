import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../context/I18nContext";
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

function expiryMeta(expiresAt) {
  if (!expiresAt) return null;
  const ms = Number(expiresAt) * 1000 - Date.now();
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return { key: "dashboard.expired", params: {}, urgent: true };
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return { key: "dashboard.expiresIn", params: { time: "< 1 hour" }, urgent: true };
  if (hours < 24) return { key: "dashboard.expiresIn", params: { time: `${hours}h` }, urgent: hours < 2 };
  return { key: "dashboard.expiresIn", params: { time: `${Math.floor(hours / 24)}d` }, urgent: false };
}

const RECENT_FILES_KEY = "superdoc_recent_files";

function loadRecentFiles() {
  try {
    return JSON.parse(sessionStorage.getItem(RECENT_FILES_KEY) || "[]");
  } catch {
    return [];
  }
}

function RecentFilesView({ t }) {
  const recent = loadRecentFiles();

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold font-headline text-on-surface mb-1">{t("dashboard.files")}</h1>
      <p className="text-sm text-on-surface-variant mb-6">{t("dashboard.sessionOnly")}</p>
      <div className="rounded-2xl bg-surface-container-lowest border border-outline-variant/10 overflow-hidden">
        <div className="px-5 py-4 border-b border-outline-variant/10">
          <span className="font-bold text-on-surface">{t("dashboard.recent")}</span>
        </div>
        {recent.length === 0 ? (
          <div className="p-6 text-on-surface-variant text-sm">
            {t("dashboard.noFiles")} <Link to="/" className="text-primary font-semibold no-underline hover:underline">{t("common.home")}</Link>.
          </div>
        ) : (
          <ul className="divide-y divide-outline-variant/10">
            {recent.map((f) => (
              <li key={f.jobId} className="p-5 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <span className="font-bold text-on-surface truncate block">{f.fileName}</span>
                  <div className="text-xs text-on-surface-variant mt-1">
                    {f.operation?.replace(/_/g, " ")}
                    {f.convertedAt ? ` · ${new Date(f.convertedAt).toLocaleString()}` : ""}
                  </div>
                </div>
                <a
                  href={f.downloadUrl}
                  className="px-4 py-2 rounded-xl bg-primary text-on-primary font-bold text-sm hover:opacity-90 transition-opacity no-underline"
                >
                  {t("common.download")}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function Dashboard() {
  const auth = useAuth();
  const { t } = useI18n();
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
        const apiJobs = data.jobs || [];
        const recent = loadRecentFiles();
        const apiIds = new Set(apiJobs.map((j) => j.job_id));
        const localOnly = recent
          .filter((f) => !apiIds.has(f.jobId))
          .map((f) => ({
            job_id: f.jobId,
            file_name: f.fileName,
            status: "DONE",
            operation: f.operation,
            download_url: f.downloadUrl,
            created_at: f.convertedAt,
            expires_at: f.expiresAt,
          }));
        setJobs([...apiJobs, ...localOnly]);
      } catch (e) {
        if (!active) return;
        setErr(e.message || t("dashboard.loadFailed"));
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [canLoad, t]);

  async function onDelete(jobId) {
    setErr("");
    if (!jobId) return;
    const ok = confirm(t("dashboard.confirmDelete"));
    if (!ok) return;

    setDeletingId(jobId);
    try {
      await api.deleteUserFile(jobId);
      setJobs((prev) => prev.filter((j) => j.job_id !== jobId));
    } catch (e) {
      setErr(e.message || t("dashboard.deleteFailed"));
    } finally {
      setDeletingId("");
    }
  }

  if (!auth?.configured) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-bold font-headline text-on-surface mb-2">{t("dashboard.files")}</h1>
        <p className="text-on-surface-variant">
          {t("dashboard.authNotConfigured")} <code>VITE_COGNITO_USER_POOL_ID</code> and <code>VITE_COGNITO_CLIENT_ID</code>.
        </p>
      </div>
    );
  }

  if (!auth.authChecked) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-bold font-headline text-on-surface mb-2">{t("dashboard.files")}</h1>
        <p className="text-on-surface-variant">{t("common.loading")}…</p>
      </div>
    );
  }

  if (!auth.isAuthenticated) {
    return <RecentFilesView t={t} />;
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold font-headline text-on-surface">{t("dashboard.files")}</h1>
          <p className="text-sm text-on-surface-variant">{t("dashboard.retention")}</p>
        </div>
        <button
          onClick={() => auth.signOut()}
          className="px-4 py-2 rounded-xl border border-outline-variant/20 text-on-surface font-semibold text-sm hover:bg-surface-container transition-colors"
        >
          {t("dashboard.signOut")}
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
          <span className="font-bold text-on-surface">{t("dashboard.recent")}</span>
          {loading && <span className="text-xs text-on-surface-variant">{t("common.loading")}…</span>}
        </div>

        {sorted.length === 0 && !loading ? (
          <div className="p-6 text-on-surface-variant text-sm">
            {t("dashboard.noFiles")} <Link to="/" className="text-primary font-semibold no-underline hover:underline">{t("common.home")}</Link>.
          </div>
        ) : (
          <ul className="divide-y divide-outline-variant/10">
            {sorted.map((job) => {
              const expires = expiryMeta(job.expires_at);
              return (
              <li key={job.job_id} className="p-5 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-on-surface truncate">
                      {job.file_name || job.job_id?.slice(0, 8)}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary/10 text-primary">
                      {job.status}
                    </span>
                    {expires ? (
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        expires.urgent ? "bg-amber-500/15 text-amber-700" : "bg-surface-container text-on-surface-variant"
                      }`}>
                        {t(expires.key, expires.params)}
                      </span>
                    ) : null}
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
                    {t("common.view")}
                  </Link>
                  {job.download_url ? (
                    <a
                      href={job.download_url}
                      className="px-4 py-2 rounded-xl bg-primary text-on-primary font-bold text-sm hover:opacity-90 transition-opacity no-underline"
                    >
                      {t("common.download")}
                    </a>
                  ) : null}
                  <button
                    onClick={() => onDelete(job.job_id)}
                    disabled={deletingId === job.job_id}
                    className="px-4 py-2 rounded-xl border border-outline-variant/20 text-on-surface font-semibold text-sm hover:bg-surface-container transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {deletingId === job.job_id ? t("common.deleting") : t("common.delete")}
                  </button>
                </div>
              </li>
            )})}
          </ul>
        )}
      </div>
    </div>
  );
}
