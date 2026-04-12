import styles from "./ProgressBar.module.css";

const STEPS = ["Uploading", "Validating", "Processing", "Done"];

function statusToStep(status) {
  switch (status) {
    case "QUEUED":     return 0;
    case "PROCESSING": return 2;
    case "DONE":       return 3;
    case "FAILED":     return -1;
    default:           return 0;
  }
}

function stepToPercent(step) {
  const map = { 0: 10, 1: 35, 2: 65, 3: 100 };
  return map[step] ?? 0;
}

export function ProgressBar({ status, estimatedSeconds, actualSeconds }) {
  const step    = statusToStep(status);
  const percent = stepToPercent(step);
  const failed  = status === "FAILED";

  return (
    <div className={styles.wrap}>
      {/* Step labels */}
      <div className={styles.steps}>
        {STEPS.map((label, i) => (
          <span
            key={label}
            className={`${styles.step} ${i <= step && !failed ? styles.active : ""} ${i === step && !failed ? styles.current : ""}`}
          >
            {i < step && !failed ? "✓ " : ""}{label}
          </span>
        ))}
      </div>

      {/* Bar */}
      <div className={styles.track}>
        <div
          className={`${styles.fill} ${failed ? styles.failed : ""}`}
          style={{ width: failed ? "100%" : `${percent}%` }}
        />
      </div>

      {/* ETA */}
      {!failed && status !== "DONE" && estimatedSeconds > 0 && (
        <p className={styles.eta}>
          ⏱ ~{estimatedSeconds}s remaining
          {estimatedSeconds > 30 && (
            <span className={styles.etaNote}> · based on similar files</span>
          )}
        </p>
      )}

      {status === "DONE" && actualSeconds > 0 && (
        <p className={styles.etaDone}>
          ✅ Completed in {actualSeconds}s
        </p>
      )}

      {failed && (
        <p className={styles.etaFailed}>
          ❌ Processing failed — please try again
        </p>
      )}
    </div>
  );
}
