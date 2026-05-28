import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "../../context/AuthContext"
import { useI18n } from "../../context/I18nContext"
import { api } from "../../lib/api"
import { needsInteractiveParams } from "../../lib/operationParams"
import { getSessionId } from "../../lib/session"
import { createAndUploadOnly, dispatchPick } from "./pickerRouting"
import { buildTargetGridChoices, findClientEditorOperation } from "./targetGrid"

export const SUPPORTED_FORMATS = ["PDF", "DOCX", "MD", "HTML", "PNG", "JPG", "WEBP", "GIF", "TIFF", "XLSX", "XLS", "TXT", "ZIP"]
export const ACCEPT = "application/pdf,.docx,.xlsx,.xls,.jpg,.jpeg,.png,.webp,.gif,.tiff,.md,.markdown,.html,.htm,.txt,.zip,application/zip"
export const KNOWN_CATALOG_TYPES = new Set(["pdf", "docx", "xlsx", "xls", "png", "jpg", "jpeg", "webp", "gif", "tiff", "md", "markdown", "txt", "html", "htm", "zip"])

// Operations that can be used to create a pre-uploaded PDF job for analysis.
const ANALYSIS_OPERATIONS = ["pdf_to_docx", "pdf_to_xls", "pdf_merge", "pdf_svg_annotate"]

function preferredAnalysisOperation(operations = []) {
  for (const opName of ANALYSIS_OPERATIONS) {
    const found = operations.find((op) => op?.operation === opName)
    if (found) return found
  }
  return null
}

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
  const [activeWork, setActiveWork] = useState(null)
  const [err, setErr] = useState(null)
  const [pendingOp, setPendingOp] = useState(null)
  const [batchFiles, setBatchFiles] = useState([])
  const [retentionExtended, setRetentionExtended] = useState(false)

  // Pre-analysis state: "idle" | "uploading" | "analyzing" | "ready" | "error"
  const [analysisState, setAnalysisState] = useState("idle")
  const [analysisResult, setAnalysisResult] = useState(null)
  const [analysisStartedAt, setAnalysisStartedAt] = useState(null)
  const [integrityDecision, setIntegrityDecision] = useState(null)
  // Ref for the pre-uploaded job metadata (avoids stale closure issues in callbacks)
  // Shape: { jobId: string, operation: string } | null
  const preUploadedJobRef = useRef(null)
  const analysisCancelRef = useRef(false)
  const analysisRunKeyRef = useRef("")

  const activeFile = pendingFile || batchFiles[0] || null
  const inputType = extensionOf(activeFile)
  const hasEmptyKnownCatalog = Boolean(activeFile && !loadingOps && !err && operations.length === 0 && KNOWN_CATALOG_TYPES.has(inputType))

  const resetToDrop = useCallback(() => {
    setPendingFile(null)
    setBatchFiles([])
    setOperations([])
    setStartingAction(null)
    setActiveWork(null)
    setErr(null)
    setPendingOp(null)
    setAnalysisState("idle")
    setAnalysisResult(null)
    setAnalysisStartedAt(null)
    setIntegrityDecision(null)
    setRetentionExtended(false)
    preUploadedJobRef.current = null
    analysisCancelRef.current = true
    analysisRunKeyRef.current = ""
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
    analysisCancelRef.current = true
    preUploadedJobRef.current = null
    setAnalysisState("idle")
    setAnalysisResult(null)
    setAnalysisStartedAt(null)
    setIntegrityDecision(null)
    analysisRunKeyRef.current = ""
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
      setRetentionExtended(false)
      return
    }
    setErr(null)
    setBatchFiles([])
    setPendingFile(list[0])
    setRetentionExtended(false)
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

  const _runPreAnalysis = useCallback(async (opMeta, file, runKey) => {
    analysisCancelRef.current = false
    preUploadedJobRef.current = null
    setAnalysisState("uploading")
    setAnalysisResult(null)
    setAnalysisStartedAt(Date.now())
    setIntegrityDecision(null)

    try {
      const { job_id } = await createAndUploadOnly({
        file,
        operation: opMeta.operation,
        auth,
        sessionId: getSessionId(),
        retentionChoice: retentionExtended ? "extended" : "default",
      })
      if (analysisCancelRef.current || analysisRunKeyRef.current !== runKey) return
      preUploadedJobRef.current = { jobId: job_id, operation: opMeta.operation }
      setAnalysisState("analyzing")

      const result = await api.analyzePdf(job_id, getSessionId())
      if (analysisCancelRef.current || analysisRunKeyRef.current !== runKey) return
      if (result) {
        setAnalysisResult(result)
        setAnalysisState("ready")
      } else {
        setAnalysisResult(null)
        setAnalysisState("error")
      }
    } catch {
      if (analysisCancelRef.current || analysisRunKeyRef.current !== runKey) return
      // Non-fatal: user can still convert with manually selected params
      setAnalysisState("error")
    }
  }, [auth, retentionExtended])

  useEffect(() => {
    if (!pendingFile || extensionOf(pendingFile) !== "pdf") return
    if (batchFiles.length > 0) return
    if (loadingOps || operations.length === 0) return
    const analysisOp = preferredAnalysisOperation(operations)
    if (!analysisOp) return

    const runKey = `${pendingFile.name}:${pendingFile.size}:${pendingFile.lastModified}:${analysisOp.operation}:${retentionExtended ? "extended" : "default"}`
    if (analysisRunKeyRef.current === runKey) return
    analysisRunKeyRef.current = runKey
    _runPreAnalysis(analysisOp, pendingFile, runKey)
  }, [pendingFile, batchFiles.length, loadingOps, operations, retentionExtended, _runPreAnalysis])

  const _startConvert = useCallback(async (opMeta, preUploadedJob = null) => {
    if (!pendingFile || !opMeta || uploading) return
    setErr(null)
    setUploading(true)
    setStartingAction(opMeta.target ? `${opMeta.operation}:${opMeta.target}` : opMeta.operation)
    setActiveWork({
      label: opMeta.label || opMeta.operation?.replaceAll("_", " "),
      fileName: pendingFile.name,
      phase: "uploading",
    })
    try {
      const selectedOperation = opMeta.operation || ""
      const preJobId = preUploadedJob?.jobId || null
      const preJobOperation = preUploadedJob?.operation || null
      const finalAnalysisResult = opMeta.analysisResult || (analysisState === "ready" ? {
        ...analysisResult,
        integrity_decision: integrityDecision || null,
      } : null)

      if (preJobId && preJobOperation && preJobOperation !== selectedOperation) {
        console.debug("[conversion] skipping pre-uploaded job reuse due to operation mismatch", {
          selected_operation: selectedOperation,
          pre_job_operation: preJobOperation,
          final_operation: selectedOperation,
        })
      }

      if (preJobId && preJobOperation === selectedOperation) {
        console.debug("[conversion] reusing pre-uploaded job for selected operation", {
          selected_operation: selectedOperation,
          pre_job_operation: preJobOperation,
          final_operation: selectedOperation,
        })
        // File already in S3 — trigger with final user-chosen params
        setActiveWork((current) => current ? { ...current, phase: "processing" } : current)
        await api.triggerProcess(preJobId, opMeta.params || null, finalAnalysisResult)
        setPendingFile(null)
        setOperations([])
        navigate(`/processing/${preJobId}`)
        return
      }

      const target = await dispatchPick(opMeta, {
        file: pendingFile,
        auth,
        sessionId: getSessionId(),
        retentionChoice: retentionExtended ? "extended" : "default",
        analysisResult: finalAnalysisResult,
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
      setActiveWork(null)
    } finally {
      setUploading(false)
      setStartingAction(null)
    }
  }, [pendingFile, auth, navigate, retentionExtended, uploading, t, analysisState, analysisResult, integrityDecision])

  const handlePick = useCallback((opMeta) => {
    if (!pendingFile || !opMeta || uploading) return
    if (needsInteractiveParams(opMeta)) {
      setErr(null)
      setPendingOp(opMeta)
      return
    }
    _startConvert(opMeta)
  }, [pendingFile, _startConvert, uploading])

  const confirmConvert = useCallback((extraParams) => {
    if (!pendingOp) return
    const merged = {
      ...pendingOp,
      params: { ...(pendingOp.params || {}), ...extraParams },
      analysisResult: analysisState === "ready" ? {
        ...analysisResult,
        integrity_decision: integrityDecision || null,
      } : null,
    }
    setPendingOp(null)
    analysisCancelRef.current = true
    const preUploadedJob = preUploadedJobRef.current
    preUploadedJobRef.current = null
    console.debug("[conversion] confirm convert", {
      selected_operation: pendingOp.operation || "",
      pre_job_operation: preUploadedJob?.operation || null,
      final_operation: merged.operation || "",
    })
    setAnalysisState("idle")
    setAnalysisResult(null)
    setIntegrityDecision(null)
    _startConvert(merged, preUploadedJob)
  }, [pendingOp, _startConvert, analysisState, analysisResult, integrityDecision])

  const cancelPending = useCallback(() => {
    setPendingOp(null)
    analysisCancelRef.current = true
    setAnalysisState("idle")
    setAnalysisResult(null)
    setIntegrityDecision(null)
    preUploadedJobRef.current = null
  }, [])

  const repairPendingPdf = useCallback(async () => {
    const jobId = preUploadedJobRef.current?.jobId
    if (!jobId) return
    const repaired = await api.repairPdf(jobId, getSessionId())
    if (repaired?.pdf_integrity) {
      setAnalysisResult((current) => ({ ...(current || {}), pdf_integrity: repaired.pdf_integrity }))
    }
    setIntegrityDecision("repaired")
  }, [])

  const continueWithoutRepair = useCallback(() => {
    setIntegrityDecision("continue_without_repair")
  }, [])

  return {
    pendingFile,
    batchFiles,
    retentionExtended,
    setRetentionExtended,
    operations,
    loadingOps,
    uploading,
    startingAction,
    activeWork,
    err,
    inputType,
    hasEmptyKnownCatalog,
    gridChoices,
    editOperation,
    pendingOp,
    analysisState,
    analysisResult,
    analysisStartedAt,
    integrityDecision,
    resetToDrop,
    refreshOperations,
    handleFiles,
    handlePick,
    confirmConvert,
    cancelPending,
    repairPendingPdf,
    continueWithoutRepair,
  }
}
