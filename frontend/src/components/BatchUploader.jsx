import { useEffect, useMemo, useState } from "react"
import { useAuth } from "../context/AuthContext"
import { useI18n } from "../context/I18nContext"
import { api } from "../lib/api"
import { interactiveSchemaFor, hasUnsupportedBatchParams, needsInteractiveParams } from "../lib/operationParams"
import { saveRecentFile } from "../lib/recentFiles"
import { getSessionId } from "../lib/session"
import { formatFileSize } from "../pages/Home/useConversionFlow"
import { ParamsPanel } from "./ParamsPanel"

const TERMINAL = new Set(["DONE", "FAILED"])
const POLL_MS = 2000
const MAX_POLL_ATTEMPTS = 90

function localId(file, index) {
  const random = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${index}`
  return `${file.name}-${file.size}-${random}`
}

function statusLabel(t, status) {
  return t(`batch.status.${status}`) || status
}

async function waitForJob(jobId, sessionId) {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
    const job = await api.getStatus(jobId, sessionId)
    if (TERMINAL.has(job.status)) return job
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
  throw new Error("Timed out waiting for conversion.")
}

export function BatchUploader({ files, gridChoices, loadingOps, inputType, onReset, retentionExtended, onRetentionExtendedChange }) {
  const auth = useAuth()
  const { t } = useI18n()
  const [items, setItems] = useState([])
  const [running, setRunning] = useState(false)
  const [selected, setSelected] = useState(null)
  const [pendingOp, setPendingOp] = useState(null)
  const maxItems = auth?.isAuthenticated ? 10 : 3
  const extendedRetentionLabel = auth?.isAuthenticated ? t("processing.retentionRegistered") : t("processing.retentionAnonymous")

  useEffect(() => {
    setSelected(null)
    setRunning(false)
    setPendingOp(null)
    setItems(files.map((file, index) => ({
      localId: localId(file, index),
      file,
      fileName: file.name,
      status: index >= maxItems ? "failed" : "queued",
      jobId: null,
      downloadUrl: null,
      error: index >= maxItems ? t("batch.errors.limit", { limit: maxItems }) : null,
    })))
  }, [files, maxItems, t])

  const choices = useMemo(() => {
    return gridChoices.filter((choice) => (
      choice.enabled &&
      choice.opMeta?.kind !== "client_editor" &&
      !hasUnsupportedBatchParams(choice.opMeta)
    ))
  }, [gridChoices])

  function updateItem(localItemId, patch) {
    setItems((prev) => prev.map((item) => item.localId === localItemId ? { ...item, ...patch } : item))
  }

  async function runBatch(opMeta) {
    if (!opMeta || running) return
    setSelected(opMeta)
    setRunning(true)
    const sessionId = getSessionId()
    const pendingPolls = []

    for (const item of items) {
      if (item.status === "failed" || item.status === "done") continue
      try {
        updateItem(item.localId, { status: "creating", error: null })
        const payload = {
          operation: opMeta.operation,
          file_size_bytes: item.file.size,
          file_name: item.file.name,
          retention_choice: retentionExtended ? "extended" : "default",
        }
        if (opMeta.params && Object.keys(opMeta.params).length > 0) {
          payload.params = opMeta.params
        }
        const data = auth?.isAuthenticated
          ? await api.createUserJob({ ...payload, session_id: sessionId })
          : await api.createJob({ ...payload, session_id: sessionId })

        updateItem(item.localId, { status: "uploading", jobId: data.job_id })
        await api.uploadToS3(data.upload || data.upload_url, item.file)
        updateItem(item.localId, { status: "processing" })
        await api.triggerProcess(data.job_id)
        pendingPolls.push(
          waitForJob(data.job_id, sessionId)
            .then((job) => {
              if (job.status === "DONE") {
                updateItem(item.localId, {
                  status: "done",
                  downloadUrl: job.download_url,
                  error: null,
                })
                saveRecentFile({
                  jobId: data.job_id,
                  fileName: item.file.name,
                  downloadUrl: job.download_url,
                  operation: opMeta.operation,
                  convertedAt: new Date().toISOString(),
                  expiresAt: job.expires_at,
                })
                return
              }
              updateItem(item.localId, {
                status: "failed",
                error: job.error || t("batch.errors.failed"),
              })
            })
            .catch((e) => {
              updateItem(item.localId, {
                status: "failed",
                error: e.message || t("batch.errors.failed"),
              })
            })
        )
      } catch (e) {
        updateItem(item.localId, {
          status: "failed",
          error: e.message || t("batch.errors.failed"),
        })
      }
    }

    await Promise.allSettled(pendingPolls)
    setRunning(false)
  }

  function handleChoice(opMeta) {
    if (running) return
    if (needsInteractiveParams(opMeta)) {
      setPendingOp(opMeta)
      return
    }
    runBatch(opMeta)
  }

  function confirmParams(extraParams) {
    if (!pendingOp) return
    const merged = { ...pendingOp, params: { ...(pendingOp.params || {}), ...extraParams } }
    setPendingOp(null)
    runBatch(merged)
  }

  return (
    <div className="p-5 md:p-10">
      <div className="mb-7 flex flex-col gap-3 rounded-[var(--radius-md)] border border-outline-variant bg-surface-container-low p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">{t("batch.title")}</p>
          <p className="mt-1 text-sm text-on-surface-variant">
            {t("batch.summary", { count: files.length, type: inputType.toUpperCase(), limit: maxItems })}
          </p>
        </div>
        <button
          type="button"
          onClick={onReset}
          disabled={running}
          className="sd-button-secondary px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
        >
          {t("common.back")}
        </button>
      </div>

      <div className="mb-7">
        <label className="mb-4 flex items-start gap-3 rounded-[var(--radius-md)] border border-outline-variant bg-surface-container-low px-4 py-3">
          <input
            type="checkbox"
            checked={retentionExtended}
            onChange={(e) => onRetentionExtendedChange(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-outline-variant"
          />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-on-surface">
              {t("home.retentionExtendedLabel", { time: extendedRetentionLabel })}
            </span>
            <span className="mt-1 block text-xs leading-5 text-on-surface-variant">
              {t("home.retentionDefaultHint", { time: t("processing.retentionDefault") })}
            </span>
          </span>
        </label>
        <div className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-outline">{t("batch.convertAllTo")}</div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {loadingOps ? (
            <div className="col-span-full rounded-[var(--radius-md)] border border-outline-variant bg-surface-container px-4 py-3 text-sm text-on-surface-variant">
              {t("common.loading")}...
            </div>
          ) : choices.map((choice) => {
            const active = selected?.operation === choice.opMeta?.operation && selected?.target === choice.opMeta?.target
            return (
              <button
                key={choice.target}
                type="button"
                disabled={running}
                onClick={() => handleChoice(choice.opMeta)}
                className={`min-h-[74px] rounded-[var(--radius-md)] border p-3 text-left transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 ${
                  active ? "border-primary bg-primary/15 text-primary ring-2 ring-primary/20" : "border-outline-variant bg-surface-container-low text-on-surface hover:border-primary/70 hover:bg-primary/10"
                }`}
              >
                <span className="flex items-center gap-2 font-headline text-sm font-bold">
                  {active && running ? <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span> : null}
                  {choice.label}
                </span>
                <span className="mt-0.5 block text-[11px] text-on-surface-variant">{choice.description}</span>
              </button>
            )
          })}
        </div>
      </div>

      {pendingOp ? (
        <div className="mb-7 rounded-[var(--radius-md)] border border-outline-variant bg-surface-container-low p-4">
          <ParamsPanel
            opMeta={{ ...pendingOp, params_schema: interactiveSchemaFor(pendingOp) }}
            onConfirm={confirmParams}
            onCancel={() => setPendingOp(null)}
          />
        </div>
      ) : null}

      <ul className="divide-y divide-outline-variant/10 overflow-hidden rounded-[var(--radius-lg)] border border-outline-variant bg-surface-container-lowest">
        {items.map((item) => (
          <li key={item.localId} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-on-surface">{item.fileName}</p>
              <p className="mt-0.5 text-xs text-on-surface-variant">{formatFileSize(item.file.size)}</p>
              {item.error ? <p className="mt-1 text-xs font-medium text-error">{item.error}</p> : null}
            </div>
            <span className={`w-fit rounded-full px-2 py-0.5 text-[10px] font-bold ${
              item.status === "failed" ? "bg-error-container text-on-error-container" :
              item.status === "done" ? "bg-primary/10 text-primary" :
              "bg-surface-container text-on-surface-variant"
            }`}>
              {statusLabel(t, item.status)}
            </span>
            {item.downloadUrl ? (
              <a
                href={item.downloadUrl}
                className="px-4 py-2 rounded-xl bg-primary text-on-primary font-bold text-sm hover:opacity-90 transition-opacity no-underline"
              >
                {t("common.download")}
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
