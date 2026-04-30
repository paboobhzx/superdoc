// frontend/src/pages/Home/Home.jsx
import { useState, useCallback, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "../../context/AuthContext"
import { OperationPicker } from "./OperationPicker"
import { dispatchPick } from "./pickerRouting"

const SUPPORTED_FORMATS = ["PDF", "DOCX", "XLSX", "JPG", "PNG", "WEBP", "GIF"]
const ACCEPT = "application/pdf,.docx,.xlsx,.jpg,.jpeg,.png,.webp,.gif"


export function Home() {
  const navigate = useNavigate()
  const auth = useAuth()

  const [phase, setPhase] = useState("drop")
  const [pendingFile, setPendingFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef(null)

  const resetToDrop = useCallback(() => {
    setPhase("drop")
    setPendingFile(null)
    setErr(null)
  }, [])

  const handleFiles = useCallback((files) => {
    const list = Array.from(files || []).filter(Boolean)
    if (list.length === 0) {
      return
    }
    if (list.length > 1) {
      setErr("Multiple-file workflows are not available yet. Upload one file at a time.")
      return
    }
    setErr(null)
    setPendingFile(list[0])
    setPhase("pick")
  }, [])

  // Called by OperationPicker when the user selects an operation. Routes
  // via dispatchPick which knows about backend_job / client_editor /
  // paid_backend_job kinds.
  const handlePick = useCallback(async (opMeta) => {
    if (!pendingFile) {
      resetToDrop()
      return
    }
    setErr(null)
    setUploading(true)
    try {
      const session_id = sessionStorage.getItem("superdoc_session") || crypto.randomUUID()
      sessionStorage.setItem("superdoc_session", session_id)

      const target = await dispatchPick(opMeta, {
        file: pendingFile,
        auth,
        sessionId: session_id,
      })

      setPhase("drop")
      setPendingFile(null)

      if (target.type === "external") {
        window.location.href = target.url
        return
      }
      navigate(target.path)
    } catch (e) {
      setErr(e.message || "Action failed - please try again")
      // Stay on the picker so the user can try a different operation.
    } finally {
      setUploading(false)
    }
  }, [pendingFile, auth, navigate, resetToDrop])

  if (phase === "pick" && pendingFile) {
    return (
      <OperationPicker
        file={pendingFile}
        onPick={handlePick}
        onBack={resetToDrop}
      />
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 md:py-14">
      <section className="text-center mb-12">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/25 text-primary text-xs font-semibold mb-6">
          <span className="material-symbols-outlined text-[16px]">verified</span>
          Free forever · No account needed · No dark patterns
        </div>
        <h1 className="text-4xl md:text-5xl font-extrabold font-headline text-on-surface leading-tight mb-4">
          Convert, Edit &<br />
          <span className="text-primary">Transform Any File.</span>
        </h1>
        <p className="text-on-surface-variant max-w-xl mx-auto mb-8">
          Upload a PDF, Word doc, spreadsheet, or image and choose what to do.
          Serverless, honest, and fast - no forced signups, no hidden fees.
        </p>
      </section>

      <div
        className={`relative rounded-2xl border-2 border-dashed transition-all cursor-pointer mb-12 ${
          dragging
            ? 'border-primary bg-primary/5 scale-[1.01]'
            : 'border-outline-variant/30 bg-surface-container-lowest hover:border-primary/40'
        } ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
        aria-label="File upload drop zone"
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false) }}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
        onClick={() => !uploading && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && !uploading && inputRef.current?.click()}
      >
        <input ref={inputRef} type="file" accept={ACCEPT} className="hidden"
          onChange={(e) => { handleFiles(e.target.files); e.target.value = "" }} />
        <div className="flex flex-col items-center py-12 gap-3">
          <span className="material-symbols-outlined text-[40px] text-on-surface-variant">
            {dragging ? 'file_download' : 'upload_file'}
          </span>
          <p className="text-lg font-semibold text-on-surface">
            {uploading ? 'Uploading...' : dragging ? 'Release to upload' : 'Drop any file here'}
          </p>
          <p className="text-sm text-on-surface-variant">or click to browse</p>
          <div className="flex flex-wrap justify-center gap-2 mt-2">
            {SUPPORTED_FORMATS.map((fmt) => (
              <span key={fmt} className="px-2.5 py-0.5 text-xs font-medium rounded-full bg-surface-container text-on-surface-variant border border-outline-variant/40">
                {fmt}
              </span>
            ))}
          </div>
        </div>
      </div>

      {err && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-error-container/20 border border-error/20 text-on-error-container mb-8">
          <span className="material-symbols-outlined text-error text-[20px]">warning</span>
          <span className="text-sm font-medium">{err}</span>
        </div>
      )}

      <p className="text-center text-xs text-on-surface-variant pb-8">
        <span className="material-symbols-outlined text-[14px] align-middle mr-1">lock</span>
        Anonymous files delete after 12 hours. Registered users keep up to 10 files for 7 days.
      </p>
    </div>
  )
}
