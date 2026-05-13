import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "../../context/AuthContext"
import { useI18n } from "../../context/I18nContext"
import { api } from "../../lib/api"
import { needsInteractiveParams } from "../../lib/operationParams"
import { getSessionId } from "../../lib/session"
import { createAndUploadOnly, dispatchPick } from "./pickerRouting"
import { buildTargetGridChoices, findClientEditorOperation } from "./targetGrid"

export const SUPPORTED_FORMATS = ["PDF", "DOCX", "MD", "HTML", "PNG", "JPG", "WEBP", "GIF", "TIFF", "XLSX", "XLS", "TXT"]
export const ACCEPT = "application/pdf,.docx,.xlsx,.xls,.jpg,.jpeg,.png,.webp,.gif,.tiff,.md,.markdown,.html,.htm,.txt"
export const KNOWN_CATALOG_TYPES = new Set(["pdf", "docx", "xlsx", "xls", "png", "jpg", "jpeg", "webp", "gif", "tiff", "md", "markdown", "txt", "html", "htm"])

// Operations that benefit from pre-analysis (PDF complexity scoring)
const ANALYSIS_OPERATIONS = new Set(["pdf_to_docx"])

export function extensionOf(file) {
  const name = file?.name || ""
  const dot = name.lastIndexOf(".")
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ""
}

export function formatFileSize(bytes) {
  if (!bytes) return "-"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function useConversionFlow() {
  const navigate = useNavigate()
  const auth = useAuth()
  const { t } = useI18n()

  const [pendingFile, setPendingFile] = useState(null)
  const [operations, setOperations] = useState([])
  const [loadingOps, setLoadingOps] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [startingAction, setStartingAction] = useState(null)
  const [err, setErr] = useState(null)
  const [pendingOp, setPendingOp] = useState(null)
  const [batchFiles, setBatchFiles] = useState([])

  // Pre-analysis state: "idle" | "uploading" | "analyzing" | "ready" | "error"
  const [analysisState, setAnalysisState] = useState("idle")
  const [analysisResult, setAnalysisResult] = useState(null)
  const [analysisStartedAt, setAnalysisStartedAt] = useState(null)
  // Ref for the pre-uploaded job_id (avoids stale closure issues in callbacks)
  const preUploadedJobIdRef = useRef(null)
  const analysisCancelRef = useRef(false)

  const activeFile = pendingFile || batchFiles[0] || null
  const inputType = extensionOf(activeFile)
  const hasEmptyKnownCatalog = Boolean(activeFile && !loadingOps && !err && operations.length === 0 && KNOWN_CATALOG_TYPES.has(inputType))

  const resetToDrop = useCallback(() => {
    setPendingFile(null)
    setBatchFiles([])
    setOperations([])
    setStartingAction(null)
    setErr(null)
    setPendingOp(null)
    setAnalysisState("idle")
    setAnalysisResult(null)
    setAnalysisStartedAt(null)
    preUploadedJobIdRef.current = null
    analysisCancelRef.current = true
  }, [])

  const refreshOperations = useCallback(() => {
    if (!activeFile) return
    setLoadingOps(true)
    setErr(null)
    api.getOperations(inputType)
      .then((data) => setOperations(data?.operations || []))
      .catch((e) => {
        setOperations([])
        setErr(e.message || t("home.errors.loadActions"))
      })
      .finally(() => setLoadingOps(false))
  }, [activeFile, inputType, t])

  const handleFiles = useCallback((files) => {
    const list = Array.from(files || []).filter(Boolean)
    if (list.length === 0) return
    if (list.length > 1) {
      const firstType = extensionOf(list[0])
      const mixed = list.some((file) => extensionOf(file) !== firstType)
      if (mixed) {
        setErr(t("batch.errors.mixedTypes"))
        return
      }
      setErr(null)
      setPendingFile(null)
      setPendingOp(null)
      setBatchFiles(list)
      return
    }
    setErr(null)
    setBatchFiles([])
    setPendingFile(list[0])
  }, [t])

  useEffect(() => {
    if (!activeFile) return
    let cancelled = false
    setLoadingOps(true)
    setErr(null)

    api.getOperations(inputType)
      .then((data) => {
        if (cancelled) return
        setOperations(data?.operations || [])
      })
      .catch((e) => {
        if (cancelled) return
        setOperations([])
        setErr(e.message || t("home.errors.loadActions"))
      })
      .finally(() => {
        if (!cancelled) setLoadingOps(false)
      })

    return () => { cancelled = true }
  }, [activeFile, inputType, t])

  const gridChoices = useMemo(
    () => buildTargetGridChoices(inputType, operations),
    [inputType, operations],
  )
  const editOperation = useMemo(() => findClientEditorOperation(operations), [operations])

  /**
   * Upload the file proactively (no params, no trigger) and then call /analyze.
   * Non-blocking — ParamsPanel is shown immediately; analysis result arrives
   * asynchronously and updates the panel's recommendation.
   */
  const _runPreAnalysis = useCallback(async (opMeta, file) => {
    analysisCancelRef.current = false
    preUploadedJobIdRef.current = null
    setAnalysisState("uploading")
    setAnalysisResult(null)
    setAnalysisStartedAt(Date.now())

    try {
      const { job_id } = await createAndUploadOnly({
        file,
        operation: opMeta.operation,
        auth,
        sessionId: getSessionId(),
      })
      if (analysisCancelRef.current) return
      preUploadedJobIdRef.current = job_id
      setAnalysisState("analyzing")

      const result = await api.analyzePdf(job_id, getSessionId())
      if (analysisCancelRef.current) return
      if (result?.recommendation) {
        setAnalysisResult(result)
        setAnalysisState("ready")
      } else {
        setAnalysisResult(null)
        setAnalysisState("error")
      }
    } catch {
      if (analysisCancelRef.current) return
      // Non-fatal: user can still convert with manually selected params
      setAnalysisState("error")
    }
  }, [auth])

  const _startConvert = useCallback(async (opMeta, preJobId = null) => {
    if (!pendingFile || !opMeta || uploading) return
    setErr(null)
    setUploading(true)
    setStartingAction(opMeta.target ? `${opMeta.operation}:${opMeta.target}` : opMeta.operation)
    try {
      if (preJobId) {
        // File already in S3 — trigger with final user-chosen params
        await api.triggerProcess(preJobId, opMeta.params || null, opMeta.analysisResult || null)
        setPendingFile(null)
        setOperations([])
        navigate(`/processing/${preJobId}`)
        return
      }

      const target = await dispatchPick(opMeta, {
        file: pendingFile,
        auth,
        sessionId: getSessionId(),
      })

      setPendingFile(null)
      setOperations([])

      if (target.type === "external") {
        window.location.href = target.url
        return
      }
      navigate(target.path)
    } catch (e) {
      setErr(e.message || t("home.errors.actionFailed"))
    } finally {
      setUploading(false)
      setStartingAction(null)
    }
  }, [pendingFile, auth, navigate, uploading, t])

  const handlePick = useCallback((opMeta) => {
    if (!pendingFile || !opMeta || uploading) return
    if (needsInteractiveParams(opMeta)) {
      setErr(null)
      setPendingOp(opMeta)
      // Proactively upload + analyze for qualifying operations
      if (ANALYSIS_OPERATIONS.has(opMeta.operation)) {
        _runPreAnalysis(opMeta, pendingFile)
      }
      return
    }
    _startConvert(opMeta)
  }, [pendingFile, _startConvert, _runPreAnalysis, uploading])

  const confirmConvert = useCallback((extraParams) => {
    if (!pendingOp) return
    const merged = {
      ...pendingOp,
      params: { ...(pendingOp.params || {}), ...extraParams },
      analysisResult: analysisState === "ready" ? analysisResult : null,
    }
    setPendingOp(null)
    analysisCancelRef.current = true
    const preJobId = preUploadedJobIdRef.current
    preUploadedJobIdRef.current = null
    setAnalysisState("idle")
    setAnalysisResult(null)
    _startConvert(merged, preJobId)
  }, [pendingOp, _startConvert])

  const cancelPending = useCallback(() => {
    setPendingOp(null)
    analysisCancelRef.current = true
    setAnalysisState("idle")
    setAnalysisResult(null)
    preUploadedJobIdRef.current = null
  }, [])

  return {
    pendingFile,
    batchFiles,
    operations,
    loadingOps,
    uploading,
    startingAction,
    err,
    inputType,
    hasEmptyKnownCatalog,
    gridChoices,
    editOperation,
    pendingOp,
    analysisState,
    analysisResult,
    analysisStartedAt,
    resetToDrop,
    refreshOperations,
    handleFiles,
    handlePick,
    confirmConvert,
    cancelPending,
  }
}
