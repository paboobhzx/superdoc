import { useParams, useNavigate } from "react-router-dom";
import { useJob }       from "../../hooks/useJob";
import { ProgressBar }  from "../../components/ProgressBar/ProgressBar";
import styles           from "./Processing.module.css";

export function Processing() {
  const { jobId }  = useParams();
  const navigate   = useNavigate();
  const { job, loading, error } = useJob(jobId);

  if (loading && !job) {
    return (
      <div className={styles.centered}>
        <div className={styles.spinner} aria-label="Loading" />
        <p className={styles.loadingText}>Connecting to job…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.centered}>
        <p className={styles.errorText}>⚠ {error}</p>
        <button className={styles.retryBtn} onClick={() => navigate("/")}>
          ← Try again
        </button>
      </div>
    );
  }

  if (!job) return null;

  const isDone   = job.status === "DONE";
  const isFailed = job.status === "FAILED";

  return (
    <main className={styles.main}>
      <div className={styles.card}>
        {/* File info row */}
        <div className={styles.fileRow}>
          <div className={styles.fileIcon}>📄</div>
          <div className={styles.fileMeta}>
            <span className={styles.fileName}>
              {job.operation?.replace(/_/g, " ") ?? "Processing"}
            </span>
            <span className={styles.fileDetail}>
              Job {jobId?.slice(0, 8)}…
              {job.file_size_bytes
                ? ` · ${(job.file_size_bytes / 1024 / 1024).toFixed(1)} MB`
                : ""}
            </span>
          </div>
          <span className={`${styles.statusPill} ${styles[job.status?.toLowerCase()]}`}>
            {job.status}
          </span>
        </div>

        {/* Progress */}
        <div className={styles.progress}>
          <h2 className={styles.title}>
            {isDone   ? "File is ready!" :
             isFailed ? "Something went wrong" :
                        "Processing your file…"}
          </h2>

          {!isFailed && (
            <p className={styles.subtitle}>
              {isDone
                ? `Completed in ${job.actual_seconds}s · Download before 24h`
                : `Estimated: ~${job.estimated_seconds ?? "?"}s remaining`}
            </p>
          )}

          <ProgressBar
            status={job.status}
            estimatedSeconds={job.estimated_seconds}
            actualSeconds={job.actual_seconds}
          />
        </div>

        {/* Privacy notice */}
        <div className={styles.notice}>
          🔒 File automatically deleted after <strong>24 hours</strong>. We never store your data.
        </div>

        {/* Actions */}
        <div className={styles.actions}>
          {isDone && job.download_url ? (
            <a
              href={job.download_url}
              download
              className={styles.downloadBtn}
            >
              ⬇ Download file
            </a>
          ) : (
            <button className={styles.downloadBtnDisabled} disabled>
              ⬇ Download (ready soon)
            </button>
          )}

          <button
            className={styles.newBtn}
            onClick={() => navigate("/")}
          >
            Convert another file →
          </button>
        </div>

        {/* Error detail */}
        {isFailed && job.error_message && (
          <p className={styles.errorDetail}>{job.error_message}</p>
        )}
      </div>
    </main>
  );
}
