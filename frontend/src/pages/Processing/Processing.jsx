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

  const isDone = job.status === "DONE"
  const isFailed = job.status === "FAILED"
  const stepIdx = getStepIndex(job.status)
  const retentionLabel = job.file_key?.startsWith("users/") ? "7 days" : "12 hours"

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <div className="rounded-2xl bg-surface-container-lowest border border-outline-variant/10 p-6 md:p-8">
        {/* File info */}
        <div className="flex items-center gap-4 pb-6 border-b border-outline-variant/10">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
            <span className="material-symbols-outlined text-primary text-[24px]">description</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-on-surface truncate">
              {job.operation?.replace(/_/g, " ") ?? "Processing"}
            </p>
            <p className="text-sm text-on-surface-variant">
              Job {jobId?.slice(0, 8)}...
              {job.file_size_bytes ? ` · ${(job.file_size_bytes / 1024 / 1024).toFixed(1)} MB` : ""}
            </p>
          </div>
          <span className={`px-3 py-1 text-xs font-bold rounded-full ${
            isDone ? 'bg-secondary-container text-on-secondary-container' :
            isFailed ? 'bg-error-container text-on-error-container' :
            'bg-primary/10 text-primary'
          }`}>
            {job.status}
          </span>
        </div>

        {/* Progress */}
        <div className="py-6">
          <h2 className="text-xl font-bold text-on-surface mb-1">
            {isDone ? "File is ready!" : isFailed ? "Something went wrong" : "Processing your file..."}
          </h2>
          {!isFailed && (
            <p className="text-sm text-on-surface-variant mb-6">
              {isDone
                ? `Completed in ${job.actual_seconds}s`
                : `Estimated: ~${job.estimated_seconds ?? "?"}s remaining`}
            </p>
          )}

          {/* Step progress bar */}
          <div className="flex items-center gap-1 mb-2">
            {STEPS.map((step, i) => (
              <div key={step} className={`flex-1 h-1.5 rounded-full transition-all ${
                i <= stepIdx ? 'bg-primary' : 'bg-outline-variant/20'
              }`} />
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-on-surface-variant font-medium">
            {STEPS.map((step, i) => (
              <span key={step} className={i <= stepIdx ? 'text-primary font-bold' : ''}>{step}</span>
            ))}
          </div>
        </div>

        {/* Notice */}
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-container border border-outline-variant/10 mb-6">
          <span className="material-symbols-outlined text-on-surface-variant text-[18px]">schedule</span>
          <span className="text-sm text-on-surface-variant">
            File automatically deleted after <strong className="text-on-surface">{retentionLabel}</strong>
          </span>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3">
          {isDone && job.download_url ? (
            <a href={job.download_url} download
              className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-primary text-on-primary font-bold text-sm hover:opacity-90 transition-opacity">
              <span className="material-symbols-outlined text-[18px]">download</span>
              Download file
            </a>
          ) : (
            <button disabled
              className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-outline-variant/20 text-on-surface-variant font-semibold text-sm cursor-not-allowed">
              <span className="material-symbols-outlined text-[18px]">download</span>
              Download (ready soon)
            </button>
          )}
          <button onClick={() => navigate("/")}
            className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl border border-outline-variant/20 text-on-surface font-semibold text-sm hover:bg-surface-container transition-colors">
            Convert another file
            <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
          </button>
        </div>

        {isFailed && job.error_message && (
          <p className="mt-4 text-sm text-error bg-error-container/10 px-4 py-2 rounded-lg">{job.error_message}</p>
        )}
      </div>
    </div>
  )
}
