import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "../../context/AuthContext"
import { useI18n } from "../../context/I18nContext"
import { api } from "../../lib/api"
import { getSessionId } from "../../lib/session"
import { dispatchPick } from "./pickerRouting"
import { buildTargetGridChoices, findClientEditorOperation } from "./targetGrid"

export const SUPPORTED_FORMATS = ["PDF", "DOCX", "MD", "HTML", "PNG", "JPG", "WEBP", "GIF", "TIFF", "XLSX", "CSV", "TXT"]
export const ACCEPT = "application/pdf,.docx,.xlsx,.csv,.jpg,.jpeg,.png,.webp,.gif,.tiff,.md,.markdown,.html,.htm,.txt"
export const KNOWN_CATALOG_TYPES = new Set(["pdf", "docx", "xlsx", "csv", "png", "jpg", "jpeg", "webp", "gif", "tiff", "md", "markdown", "txt", "html", "htm"])

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

  const inputType = extensionOf(pendingFile)
  const hasEmptyKnownCatalog = Boolean(pendingFile && !loadingOps && !err && operations.length === 0 && KNOWN_CATALOG_TYPES.has(inputType))

  const resetToDrop = useCallback(() => {
    setPendingFile(null)
    setOperations([])
    setStartingAction(null)
    setErr(null)
  }, [])

  const refreshOperations = useCallback(() => {
    if (!pendingFile) return
    setLoadingOps(true)
    setErr(null)
    api.getOperations(inputType)
      .then((data) => setOperations(data?.operations || []))
      .catch((e) => {
        setOperations([])
        setErr(e.message || t("home.errors.loadActions"))
      })
      .finally(() => setLoadingOps(false))
  }, [pendingFile, inputType, t])

  const handleFiles = useCallback((files) => {
    const list = Array.from(files || []).filter(Boolean)
    if (list.length === 0) return
    if (list.length > 1) {
      setErr(t("home.errors.multipleFiles"))
      return
    }
    setErr(null)
    setPendingFile(list[0])
  }, [t])

  useEffect(() => {
    if (!pendingFile) return
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
  }, [pendingFile, inputType, t])

  const gridChoices = useMemo(
    () => buildTargetGridChoices(inputType, operations),
    [inputType, operations],
  )
  const editOperation = useMemo(() => findClientEditorOperation(operations), [operations])

  const handlePick = useCallback(async (opMeta) => {
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

  return {
    pendingFile,
    operations,
    loadingOps,
    uploading,
    startingAction,
    err,
    inputType,
    hasEmptyKnownCatalog,
    gridChoices,
    editOperation,
    resetToDrop,
    refreshOperations,
    handleFiles,
    handlePick,
  }
}
