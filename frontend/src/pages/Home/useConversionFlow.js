import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "../../context/AuthContext"
import { useI18n } from "../../context/I18nContext"
import { api } from "../../lib/api"
import { getSessionId } from "../../lib/session"
import { dispatchPick } from "./pickerRouting"
import { buildTargetGridChoices, findClientEditorOperation } from "./targetGrid"

export const SUPPORTED_FORMATS = ["PDF", "DOCX", "MD", "HTML", "PNG", "JPG", "WEBP", "GIF", "TIFF", "XLSX", "XLS", "TXT"]
export const ACCEPT = "application/pdf,.docx,.xlsx,.xls,.jpg,.jpeg,.png,.webp,.gif,.tiff,.md,.markdown,.html,.htm,.txt"
export const KNOWN_CATALOG_TYPES = new Set(["pdf", "docx", "xlsx", "xls", "png", "jpg", "jpeg", "webp", "gif", "tiff", "md", "markdown", "txt", "html", "htm"])

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

  const _startConvert = useCallback(async (opMeta) => {
    if (!pendingFile || !opMeta || uploading) return
    setErr(null)
    setUploading(true)
    setStartingAction(opMeta.target ? `${opMeta.operation}:${opMeta.target}` : opMeta.operation)
    try {
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
    if (opMeta?.params_schema?.paper_size) {
      setErr(null)
      setPendingOp(opMeta)
      return
    }
    _startConvert(opMeta)
  }, [pendingFile, _startConvert, uploading])

  const confirmConvert = useCallback((extraParams) => {
    if (!pendingOp) return
    const merged = { ...pendingOp, params: { ...(pendingOp.params || {}), ...extraParams } }
    setPendingOp(null)
    _startConvert(merged)
  }, [pendingOp, _startConvert])

  const cancelPending = useCallback(() => setPendingOp(null), [])

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
    resetToDrop,
    refreshOperations,
    handleFiles,
    handlePick,
    confirmConvert,
    cancelPending,
  }
}
