// frontend/src/pages/Home/Home.jsx
import { useState, useCallback, useRef } from "react"
import { useNavigate, Link } from "react-router-dom"
import { TOOLS } from "../../config/tools"
import { api } from "../../lib/api"
import { useAuth } from "../../context/AuthContext"
import { OperationPicker } from "./OperationPicker"
import { dispatchPick } from "./pickerRouting"

const SUPPORTED_FORMATS = ["PDF", "DOCX", "XLSX", "JPG", "PNG", "MP4", "WEBP", "GIF"]
const ACCEPT = "application/pdf,.docx,.xlsx,.jpg,.jpeg,.png,.webp,.gif,.mp4,.webm"
const MAX_ITERATION_BYTES = 100 * 1024 * 1024


// Fallback used only when the picker is skipped (batch upload of >1 file).
// Single-file uploads always go through the picker now.
function fallbackOperation(file) {
  const ext = (file.name || "").split(".").pop().toLowerCase()
  const map = {
    pdf: "pdf_to_docx",
    jpg: "image_convert", jpeg: "image_convert", png: "image_convert",
    gif: "image_convert", webp: "image_convert",
    mp4: "video_process", webm: "video_process",
    xlsx: "doc_edit", xls: "doc_edit", docx: "doc_edit",
  }
  return map[ext] || "pdf_to_docx"
}


export function Home() {
  const navigate = useNavigate()
  const auth = useAuth()

  const [phase, setPhase] = useState("drop")
  const [pendingFile, setPendingFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [created, setCreated] = useState([])
  const inputRef = useRef(null)

  const resetToDrop = useCallback(() => {
    setPhase("drop")
    setPendingFile(null)
    setErr(null)
  }, [])

  // Batch-upload path - unchanged from Round 2. Used when user drops
  // multiple files; each goes through backend_job with fallback operation.
  const batchUpload = useCallback(async (files) => {
    setErr(null)
    setCreated([])
    const list = Array.from(files || []).filter(Boolean)
    if (list.length === 0) {
      return
    }
    const maxFiles = auth?.isAuthenticated ? 10 : 4
    if (list.length > maxFiles) {
      setErr(`Too many files. Max ${maxFiles} at a time.`)
      return
    }
    const totalBytes = list.reduce((sum, f) => sum + (f?.size || 0), 0)
    if (totalBytes > MAX_ITERATION_BYTES) {
      setErr("Batch too large. Max 100MB per upload batch.")
      return
    }

    setUploading(true)
    try {
      const session_id = sessionStorage.getItem("superdoc_session") || crypto.randomUUID()
      sessionStorage.setItem("superdoc_session", session_id)

      const createdJobs = []
      for (const file of list) {
        const operation = fallbackOperation(file)
        const payload = { operation, file_size_bytes: file.size, file_name: file.name }
        let data
        if (auth?.isAuthenticated) {
          data = await api.createUserJob(payload)
        } else {
          data = await api.createJob({ ...payload, session_id })
        }
        await api.uploadToS3(data.upload || data.upload_url, file)
        await api.triggerProcess(data.job_id)
        createdJobs.push({ job_id: data.job_id, file_name: file.name })
      }

      setCreated(createdJobs)
      if (createdJobs.length === 1) {
        navigate(`/processing/${createdJobs[0].job_id}`)
      }
    } catch (e) {
      setErr(e.message || "Upload failed - please try again")
    } finally {
      setUploading(false)
    }
  }, [navigate, auth?.isAuthenticated])

  const handleFiles = useCallback((files) => {
    const list = Array.from(files || []).filter(Boolean)
    if (list.length === 0) {
      return
    }
    if (list.length > 1) {
      batchUpload(list)
      return
    }
    setPendingFile(list[0])
    setPhase("pick")
  }, [batchUpload])

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
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/5 border border-primary/10 text-primary text-xs font-semibold mb-6">
          <span className="material-symbols-outlined text-[16px]">verified</span>
          Free forever · No account needed · No dark patterns
        </div>
        <h1 className="text-4xl md:text-5xl font-extrabold font-headline text-on-surface leading-tight mb-4">
          Convert, Edit &<br />
          <span className="text-primary">Transform Any File.</span>
        </h1>
        <p className="text-on-surface-variant max-w-xl mx-auto mb-8">
          Upload a PDF, Word doc, image or video and choose what to do.
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
        <input ref={inputRef} type="file" accept={ACCEPT} multiple className="hidden"
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
              <span key={fmt} className="px-2.5 py-0.5 text-xs font-medium rounded-full bg-surface-container text-on-surface-variant border border-outline-variant/10">
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

      {created.length > 1 && (
        <div className="rounded-2xl bg-surface-container-lowest border border-outline-variant/10 p-5 mb-10">
          <div className="flex items-center justify-between gap-3 mb-3">
            <span className="font-bold text-on-surface">Batch started</span>
            {auth?.isAuthenticated ? (
              <a href="/dashboard" className="text-sm text-primary font-semibold no-underline hover:underline">
                View all in Files
              </a>
            ) : null}
          </div>
          <ul className="space-y-2">
            {created.map((j) => (
              <li key={j.job_id} className="flex items-center justify-between gap-3">
                <span className="text-sm text-on-surface truncate">{j.file_name}</span>
                <a href={`/processing/${j.job_id}`} className="text-sm text-primary font-semibold no-underline hover:underline">
                  Open
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <section className="mb-12">
        <h2 className="text-2xl font-bold font-headline text-on-surface mb-2">Everything you need</h2>
        <p className="text-on-surface-variant mb-6">No bloat, no subscriptions. Just tools that work.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {TOOLS.map((tool) => (
            <Link key={tool.title} to="/tools"
              className="group relative flex items-start gap-4 p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant/10 hover:border-primary/20 hover:shadow-sm transition-all cursor-pointer no-underline text-inherit">
              <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-primary text-[22px]">{tool.icon}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-on-surface">{tool.title}</h3>
                  {tool.badge && (
                    <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-tertiary-container text-on-tertiary-container">
                      {tool.badge}
                    </span>
                  )}
                </div>
                <p className="text-sm text-on-surface-variant mt-0.5">{tool.desc}</p>
              </div>
              <span className="material-symbols-outlined text-on-surface-variant text-[18px] group-hover:text-primary transition-colors mt-1">
                arrow_forward
              </span>
            </Link>
          ))}
        </div>
      </section>

      <p className="text-center text-xs text-on-surface-variant pb-8">
        <span className="material-symbols-outlined text-[14px] align-middle mr-1">lock</span>
        Anonymous files delete after 12 hours. Registered users keep up to 10 files for 7 days.
      </p>
    </div>
  )
}
