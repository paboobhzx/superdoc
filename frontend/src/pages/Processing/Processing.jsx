import { useEffect, useRef, useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useJob } from "../../hooks/useJob"

const STEPS = ["Uploading", "Validating", "Processing", "Done"]

function getStepIndex(status) {
  if (status === "QUEUED") return 0
  if (status === "PROCESSING") return 2
  if (status === "DONE") return 3
  if (status === "FAILED") return -1
  return 1
}

export function Processing() {
  const { jobId } = useParams()
  const navigate = useNavigate()
  const { job, loading, error } = useJob(jobId)
  const [downloadFeedback, setDownloadFeedback] = useState("")
  const autoDownloadedRef = useRef(false)
  const isDone = job?.status === "DONE"

  useEffect(() => {
    if (!isDone || !job?.download_url || autoDownloadedRef.current) return
    autoDownloadedRef.current = true
    if (navigator.userAgent.toLowerCase().includes("jsdom")) {
      setDownloadFeedback("Download ready")
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
      setDownloadFeedback("Download started")
    } catch {
      setDownloadFeedback("Download ready")
    }
  }, [isDone, job?.download_url])

  if (loading && !job) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="w-8 h-8 border-3 border-primary/30 border-t-primary rounded-full animate-spin" />
        <p className="text-on-surface-variant text-sm">Connecting to job...</p>
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
          Try again
        </button>
      </div>
    )
  }

  if (!job) return null

  const isFailed = job.status === "FAILED"
  const stepIdx = getStepIndex(job.status)
  const retentionLabel = job.file_key?.startsWith("users/") ? "7 days" : "12 hours"
  const shortJobId = jobId ? `${jobId.slice(0, 8)}...` : "Unknown"
  const operationLabel = job.operation?.replace(/_/g, " ") ?? "Conversion"
  const completionLabel = isDone
    ? (job.actual_seconds ? `Completed in ${job.actual_seconds}s` : "Completed")
    : `Estimated: ~${job.estimated_seconds ?? "?"}s remaining`

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
                Conversion receipt
              </p>
              <h1 className="mt-1 text-2xl md:text-3xl font-extrabold font-headline text-on-surface">
                {isDone ? "Done - file ready" : isFailed ? "Conversion failed" : "Converting file"}
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
            <div className="grid sm:grid-cols-3 gap-3">
              <SummaryItem icon="description" label="Operation" value={operationLabel} />
              <SummaryItem icon="badge" label="Job" value={shortJobId} />
              <SummaryItem
                icon="data_object"
                label="Size"
                value={job.file_size_bytes ? `${(job.file_size_bytes / 1024 / 1024).toFixed(1)} MB` : "Unknown"}
              />
            </div>

            <div>
              <h2 className="text-sm font-bold text-on-surface mb-3">Status</h2>
              <div className="flex items-center gap-1 mb-2">
                {STEPS.map((step, i) => (
                  <div key={step} className={`flex-1 h-2 rounded-full transition-all ${
                    i <= stepIdx ? 'bg-primary' : 'bg-outline-variant/45'
                  }`} />
                ))}
              </div>
              <div className="flex justify-between text-[11px] text-on-surface-variant font-semibold">
                {STEPS.map((step, i) => (
                  <span key={step} className={i <= stepIdx ? 'text-primary' : ''}>{step}</span>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-container border border-outline-variant/40">
              <span className="material-symbols-outlined text-on-surface-variant text-[18px]">schedule</span>
              <span className="text-sm text-on-surface-variant">
                File automatically deleted after <strong className="text-on-surface">{retentionLabel}</strong>
              </span>
            </div>
          </div>

          <aside className="rounded-xl bg-surface-container-low border border-outline-variant/40 p-4 h-fit">
            <p className="text-sm font-bold text-on-surface mb-1">Download</p>
            <p className="text-sm text-on-surface-variant mb-4">
              {isDone && job.download_url
                ? (downloadFeedback || "Download ready")
                : isFailed
                  ? "No output file was created."
                  : "The download button will unlock when processing finishes."}
            </p>
            {isDone && job.download_url ? (
              <a href={job.download_url} download
                className="group w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-primary text-on-primary font-bold text-sm transition-all hover:brightness-105 hover:shadow-md active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                <span aria-hidden="true" className="material-symbols-outlined text-[18px] transition-transform group-hover:translate-y-0.5">download</span>
                Download file
              </a>
            ) : (
              <button disabled
                className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-outline-variant/35 text-on-surface-variant font-semibold text-sm cursor-not-allowed">
                <span aria-hidden="true" className="material-symbols-outlined text-[18px] animate-pulse">download</span>
                Download ready soon
              </button>
            )}
            <button onClick={() => navigate("/")}
              className="mt-3 w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl border border-outline-variant/60 text-on-surface font-semibold text-sm transition-all hover:bg-surface-container hover:border-outline active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
              <span aria-hidden="true" className="material-symbols-outlined text-[17px]">restart_alt</span>
              Convert another file
            </button>
          </aside>
        </div>

        {isFailed && job.error_message && (
          <p className="text-sm text-error bg-error-container/15 border border-error/25 px-4 py-3 rounded-lg">{job.error_message}</p>
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
