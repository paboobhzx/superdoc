import { useEffect, useRef, useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useI18n } from "../../context/I18nContext"
import { useJob } from "../../hooks/useJob"
import { api } from "../../lib/api"
import { saveRecentFile } from "../../lib/recentFiles"
import { getSessionId } from "../../lib/session"

// Upload is already complete when this page mounts, so the stepper tracks the
// lifecycle visible from /processing/:jobId rather than the upload flow.
const STEPS = ["queued", "processing", "finalizing", "done"]

function getStepIndex(status) {
  if (status === "PENDING") return 0
  if (status === "QUEUED") return 0
  if (status === "PROCESSING") return 1
  // The backend does not expose a dedicated Finalizing status; DONE is the
  // first terminal state the user can observe, so we map it to the last step.
  if (status === "DONE") return 3
  if (status === "FAILED") return -1
  return 0
}

function retentionLabelForJob(job, t) {
  if (job?.retention_choice === "extended") {
    return job?.user_id || job?.file_key?.startsWith("users/")
      ? t("processing.retentionRegistered")
      : t("processing.retentionAnonymous")
  }
  return t("processing.retentionDefault")
}

function displayOperation(job, fallback) {
  if (job?.operation_label) return job.operation_label
  if (!job?.operation) return fallback
  return job.operation.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase())
}

export function Processing() {
  const { jobId } = useParams()
  const navigate = useNavigate()
  const { t } = useI18n()
  const { job, loading, error } = useJob(jobId)
  const [now, setNow] = useState(Date.now())
  const [downloadFeedback, setDownloadFeedback] = useState("")
  const [isDeleting, setIsDeleting] = useState(false)
  const [isDeleted, setIsDeleted] = useState(false)
  const autoDownloadedRef = useRef(false)
  const isDone = job?.status === "DONE" && !isDeleted
  const canShareDownload = isDone && job?.download_url && typeof navigator !== "undefined" && typeof navigator.share === "function"

  useEffect(() => {
    if (!job || isDone || job.status === "FAILED") return
    // Tick once per second so the countdown can shrink as polling continues.
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [job, isDone])

  useEffect(() => {
    if (!isDone || !job?.download_url || autoDownloadedRef.current) return
    autoDownloadedRef.current = true
    if (navigator.userAgent.toLowerCase().includes("jsdom")) {
      setDownloadFeedback(t("processing.downloadReady"))
      return
    }
    try {
      const anchor = document.createElement("a")
      anchor.href = job.download_url
      anchor.download = ""
      anchor.rel = "noopener"
      anchor.target = "_blank"
      anchor.style.display = "none"
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      setDownloadFeedback(t("processing.downloadStarted"))
    } catch {
      setDownloadFeedback(t("processing.downloadReady"))
    }
  }, [isDone, job?.download_url, t])

  useEffect(() => {
    if (!isDone || !job?.download_url) return
    saveRecentFile({
      jobId,
      fileName: job.file_name || jobId,
      downloadUrl: job.download_url,
      operation: job.operation || "",
      operationLabel: job.operation_label || "",
      convertedAt: new Date().toISOString(),
      expiresAt: job.expires_at,
    })
  }, [isDone, job?.download_url, job?.file_name, job?.operation, jobId])

  if (loading && !job) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="w-8 h-8 border-3 border-primary/30 border-t-primary rounded-full animate-spin" />
        <p className="text-on-surface-variant text-sm">{t("processing.connecting")}</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <span className="material-symbols-outlined text-error text-[40px]">error</span>
        <p className="text-on-surface font-semibold">{error}</p>
        <button onClick={() => navigate("/")}
          className="px-5 py-2.5 rounded-xl bg-primary text-on-primary font-semibold text-sm hover:opacity-90 transition-opacity">
          <span className="material-symbols-outlined text-[16px] align-middle mr-1">arrow_back</span>
          {t("common.tryAgain")}
        </button>
      </div>
    )
  }

  if (!job) return null

  const isFailed = job.status === "FAILED"
  const stepIdx = getStepIndex(job.status)
  const HEAVY_OPERATIONS = ["docx_to_pdf", "docx_to_image", "xlsx_to_pdf", "pdf_to_docx"]
  const isHeavyOp = HEAVY_OPERATIONS.includes(job?.operation)
  const retentionLabel = retentionLabelForJob(job, t)
  const shortJobId = jobId ? `${jobId.slice(0, 8)}...` : t("common.unknown")
  const operationLabel = displayOperation(job, t("common.conversion"))
  const remainingSeconds = (() => {
    if (typeof job.estimated_seconds !== "number") return null
    if (typeof job.started_at !== "number") return job.estimated_seconds
    const elapsed = Math.max(Math.floor(now / 1000) - job.started_at, 0)
    return Math.max(job.estimated_seconds - elapsed, 0)
  })()
  const completionLabel = isDone
    ? (job.actual_seconds !== undefined && job.actual_seconds !== null
      ? t("processing.completedIn", { seconds: job.actual_seconds })
      : t("processing.completed"))
    : remainingSeconds === null
      ? t("processing.working")
      : remainingSeconds === 0
        ? t("processing.almost")
        : t("processing.estimated", { seconds: remainingSeconds })

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 md:py-12">
      <section className="rounded-2xl bg-surface-container-lowest border border-outline-variant/40 p-5 md:p-8 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-5 pb-6 border-b border-outline-variant/40">
          <div className="flex items-start gap-4 min-w-0">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
              isDone ? "bg-secondary-container text-on-secondary-container" :
              isFailed ? "bg-error-container text-on-error-container" :
              "bg-primary/15 text-primary"
            }`}>
              <span className="material-symbols-outlined text-[26px]">
                {isDone ? "check_circle" : isFailed ? "error" : "sync"}
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                {t("processing.receipt")}
              </p>
              <h1 className="mt-1 text-2xl md:text-3xl font-extrabold font-headline text-on-surface">
                {isDone ? t("processing.doneReady") : isFailed ? t("processing.failed") : t("processing.converting")}
              </h1>
              <p className="mt-2 text-sm text-on-surface-variant">
                {completionLabel}
              </p>
            </div>
          </div>
          <span className={`self-start px-3 py-1.5 text-xs font-bold rounded-full border ${
            isDone ? 'bg-secondary-container text-on-secondary-container border-secondary/30' :
            isFailed ? 'bg-error-container text-on-error-container border-error/30' :
            'bg-primary/15 text-primary border-primary/25'
          }`}>
            {job.status}
          </span>
        </div>

        <div className="grid md:grid-cols-[1fr_18rem] gap-6 py-6">
          <div className="space-y-5">
            <div>
              <h2 className="text-sm font-bold text-on-surface mb-3">{t("processing.status")}</h2>
              {typeof job.progress === "number" && !isDone && !isFailed ? (
                <div>
                  <div className="relative h-3 w-full rounded-full bg-outline-variant/25 overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-primary transition-all duration-500 ease-out"
                      style={{ width: `${Math.min(job.progress, 100)}%` }}
                    />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="text-xs text-on-surface-variant">
                      {job.progress_message || t("processing.working")}
                    </span>
                    <span className="text-xs font-bold tabular-nums text-primary">{job.progress}%</span>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-1 mb-2">
                    {STEPS.map((step, i) => (
                      <div key={step} className={`flex-1 h-2 rounded-full transition-all ${
                        i <= stepIdx ? 'bg-primary' : 'bg-outline-variant/45'
                      }`} />
                    ))}
                  </div>
                  <div className="flex justify-between text-[11px] text-on-surface-variant font-semibold">
                    {STEPS.map((step, i) => (
                      <span key={step} className={i <= stepIdx ? 'text-primary' : ''}>{t(`processing.${step}`)}</span>
                    ))}
                  </div>
                </>
              )}
            </div>

            <details className="group">
              <summary className="flex items-center gap-1.5 cursor-pointer text-xs font-bold text-on-surface-variant hover:text-on-surface transition-colors select-none">
                <span className="material-symbols-outlined text-[15px] transition-transform group-open:rotate-90">chevron_right</span>
                {t("processing.jobDetails")}
              </summary>
              <div className="mt-3 space-y-3">
                <div className="grid sm:grid-cols-3 gap-3">
                  <SummaryItem icon="description" label={t("processing.operation")} value={operationLabel} />
                  <SummaryItem icon="badge" label={t("processing.job")} value={shortJobId} />
                  <SummaryItem
                    icon="data_object"
                    label={t("processing.size")}
                    value={job.file_size_bytes ? `${(job.file_size_bytes / 1024 / 1024).toFixed(1)} MB` : t("common.unknown")}
                  />
                </div>
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-container border border-outline-variant/40">
                  <span className="material-symbols-outlined text-on-surface-variant text-[18px]">schedule</span>
                  <span className="text-sm text-on-surface-variant">
                    {t("processing.deletedAfter")} <strong className="text-on-surface">{retentionLabel}</strong>
                  </span>
                </div>
              </div>
            </details>
          </div>

          <aside className="rounded-xl bg-surface-container-low border border-outline-variant/40 p-4 h-fit">
            <p className="text-sm font-bold text-on-surface mb-1">{t("processing.download")}</p>
            <p className="text-sm text-on-surface-variant mb-4">
              {isDone && (job.download_url || job.download_urls)
                ? (downloadFeedback || t("processing.downloadReady"))
                : isFailed
                  ? t("processing.noOutput")
                  : t("processing.unlock")}
            </p>
            {isDone && job.download_urls ? (
              // Multi-output: video pipeline produces several files
              <div className="space-y-2">
                {Object.entries(job.download_urls).map(([key, url]) => (
                  <a key={key} href={url} download
                    className="group w-full sd-button-primary px-4 py-3 text-sm font-semibold">
                    <span className="material-symbols-outlined text-[18px] transition-transform group-hover:translate-y-0.5">download</span>
                    {t(`video.output.${key}`) !== `video.output.${key}` ? t(`video.output.${key}`) : key}
                  </a>
                ))}
              </div>
            ) : isDone && job.download_url ? (
              <>
                <a href={job.download_url} download
                  className="group relative w-full sd-button-primary px-6 py-4 text-base font-extrabold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                  <span aria-hidden="true" className="material-symbols-outlined text-[22px] transition-transform group-hover:translate-y-1">download</span>
                  {t("common.downloadFile")}
                </a>
                {canShareDownload ? (
                  <button
                    type="button"
                    onClick={() => navigator.share({ title: "SuperDoc download", url: job.download_url }).catch(() => {})}
                    className="mt-3 w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl border border-outline-variant/60 text-on-surface font-semibold text-sm transition-all hover:bg-surface-container hover:border-outline active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[17px]">ios_share</span>
                    Share
                  </button>
                ) : null}
              </>
            ) : (
              <>
                {isHeavyOp && (
                  <div className="flex items-start gap-2 mb-4 px-3 py-2.5 rounded-xl bg-surface-container border border-outline-variant/40">
                    <span className="material-symbols-outlined text-on-surface-variant text-[16px] shrink-0 mt-0.5">schedule</span>
                    <p className="text-xs text-on-surface-variant leading-relaxed">{t("processing.heavyOpHint")}</p>
                  </div>
                )}
                <button disabled
                  className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-outline-variant/35 text-on-surface-variant font-semibold text-sm cursor-not-allowed">
                  <span aria-hidden="true" className="material-symbols-outlined text-[18px] animate-pulse">download</span>
                  {t("processing.soon")}
                </button>
              </>
            )}
            <button onClick={() => navigate("/")}
              className="mt-3 w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl border border-outline-variant/60 text-on-surface font-semibold text-sm transition-all hover:bg-surface-container hover:border-outline active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
              <span aria-hidden="true" className="material-symbols-outlined text-[17px]">restart_alt</span>
              {t("common.convertAnother")}
            </button>
            {(job.download_url || job.download_urls) && (
              <button
                type="button"
                disabled={isDeleting || isDeleted}
                onClick={async () => {
                  setIsDeleting(true)
                  try {
                    await api.deleteJob(jobId, getSessionId())
                    setIsDeleted(true)
                    setDownloadFeedback(t("processing.deletedNow"))
                  } finally {
                    setIsDeleting(false)
                  }
                }}
                className="mt-3 w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl border border-error/45 text-error font-semibold text-sm transition-all hover:bg-error/10 disabled:opacity-60"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[17px]">delete</span>
                {job.download_urls ? t("processing.deleteAll") : t("processing.deleteFile")}
              </button>
            )}
          </aside>
        </div>

        {isFailed && job.error_message && (
          <p className="text-sm text-error bg-error-container/15 border border-error/25 px-4 py-3 rounded-lg">{job.error_message}</p>
        )}
        {Array.isArray(job.job_warnings) && job.job_warnings.length > 0 && (
          <div className="mt-4 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3">
            <p className="text-sm font-semibold text-on-surface">Conversion warnings</p>
            <ul className="mt-2 space-y-1">
              {job.job_warnings.map((warning, index) => (
                <li key={`${index}-${warning}`} className="text-xs text-on-surface-variant">{warning}</li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  )
}

function SummaryItem({ icon, label, value }) {
  return (
    <div className="rounded-xl bg-surface-container-low border border-outline-variant/40 px-4 py-3 min-w-0">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-on-surface-variant">
        <span className="material-symbols-outlined text-[15px]">{icon}</span>
        {label}
      </div>
      <p className="mt-1 font-semibold text-on-surface truncate">{value}</p>
    </div>
  )
}
