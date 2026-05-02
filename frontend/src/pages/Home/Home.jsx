import { useState, useCallback, useEffect, useMemo, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "../../context/AuthContext"
import { api } from "../../lib/api"
import { dispatchPick } from "./pickerRouting"
import { buildTargetGridChoices, findClientEditorOperation, TARGET_GRID } from "./targetGrid"

const SUPPORTED_FORMATS = ["PDF", "DOCX", "MD", "HTML", "PNG", "JPG", "XLSX", "TXT"]
const ACCEPT = "application/pdf,.docx,.xlsx,.jpg,.jpeg,.png,.webp,.gif,.md,.markdown,.html,.htm,.txt"
const KNOWN_CATALOG_TYPES = new Set(["pdf", "docx", "xlsx", "png", "jpg", "jpeg", "webp", "gif", "md", "markdown", "txt"])

const FORMAT_CARDS = [
  { from: "PDF", to: "DOCX", label: "PDF to Word", desc: "Editable Word document from a PDF." },
  { from: "DOCX", to: "PDF", label: "Word to PDF", desc: "A clean, shareable PDF from Word files." },
  { from: "MD", to: "DOCX", label: "Markdown to Word", desc: "Formatted .docx from Markdown source." },
  { from: "HTML", to: "DOCX", label: "HTML to Word", desc: "Word documents from HTML snippets." },
  { from: "IMG", to: "PDF", label: "Images to PDF", desc: "Wrap images into document-ready PDFs." },
  { from: "PDF", to: "PNG", label: "PDF to Image", desc: "Render pages as high-resolution images." },
]

const HOW_STEPS = [
  { icon: "upload_file", n: "01", title: "Drop your file", body: "Drag a file onto the converter or browse from your device." },
  { icon: "view_module", n: "02", title: "Choose format", body: "SuperDoc detects the input and enables the formats the backend supports." },
  { icon: "download", n: "03", title: "Download result", body: "Processing runs as a real job, then unlocks your download when it is ready." },
]

const TRUST_ITEMS = [
  { icon: "lock", title: "Private by default", body: "Anonymous files are short-lived. Saved files require your account." },
  { icon: "bolt", title: "Fast jobs", body: "Upload, processing, and download progress stay visible." },
  { icon: "public", title: "Browser based", body: "Use it on desktop or mobile without installing an app." },
  { icon: "restart_alt", title: "Honest targets", body: "Unsupported formats stay visible but disabled until the backend supports them." },
]

const FAQ_ITEMS = [
  { q: "Is SuperDoc really free?", a: "Yes. Core conversion works without an account. Accounts are only needed for saved files." },
  { q: "What happens to unsupported formats?", a: "Unavailable targets remain visible but disabled for the selected file. Enabled actions come from the deployed operation catalog." },
  { q: "Can I edit files too?", a: "Yes. When the catalog exposes a browser editor for the selected file, the Edit action appears next to the converter." },
  { q: "Do routes and saved files still work?", a: "Yes. Uploads, job polling, editor routing, authentication, and dashboard files use the existing backend flow." },
]

function extensionOf(file) {
  const name = file?.name || ""
  const dot = name.lastIndexOf(".")
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ""
}

function formatFileSize(bytes) {
  if (!bytes) return "-"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function Home() {
  const navigate = useNavigate()
  const auth = useAuth()

  const [pendingFile, setPendingFile] = useState(null)
  const [operations, setOperations] = useState([])
  const [loadingOps, setLoadingOps] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [startingAction, setStartingAction] = useState(null)
  const [err, setErr] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [openFaq, setOpenFaq] = useState(null)
  const inputRef = useRef(null)

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
        setErr(e.message || "Could not load available actions")
      })
      .finally(() => setLoadingOps(false))
  }, [pendingFile, inputType])

  const handleFiles = useCallback((files) => {
    const list = Array.from(files || []).filter(Boolean)
    if (list.length === 0) return
    if (list.length > 1) {
      setErr("Multiple-file workflows are not available yet. Upload one file at a time.")
      return
    }
    setErr(null)
    setPendingFile(list[0])
  }, [])

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
        setErr(e.message || "Could not load available actions")
      })
      .finally(() => {
        if (!cancelled) setLoadingOps(false)
      })

    return () => { cancelled = true }
  }, [pendingFile, inputType])

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
      const sessionId = sessionStorage.getItem("superdoc_session") || crypto.randomUUID()
      sessionStorage.setItem("superdoc_session", sessionId)

      const target = await dispatchPick(opMeta, {
        file: pendingFile,
        auth,
        sessionId,
      })

      setPendingFile(null)
      setOperations([])

      if (target.type === "external") {
        window.location.href = target.url
        return
      }
      navigate(target.path)
    } catch (e) {
      setErr(e.message || "Action failed - please try again")
    } finally {
      setUploading(false)
      setStartingAction(null)
    }
  }, [pendingFile, auth, navigate, uploading])

  return (
    <div className="min-h-[calc(100vh-60px)]">
      <section className="mx-auto w-full max-w-6xl px-4 pb-12 pt-10 md:pb-16 md:pt-16">
        <div className="mb-10 grid animate-[fade-up_0.6s_ease_both] items-center gap-8 md:grid-cols-[1.05fr_0.95fr]">
          <div className="flex flex-col items-start gap-5 text-left">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/50 bg-primary/10 px-3.5 py-1.5 text-xs font-bold uppercase tracking-[0.12em] text-primary">
              <span className="material-symbols-outlined text-[14px]">bolt</span>
              Free · No signup required
            </div>
            <h1 className="max-w-3xl font-headline text-[clamp(2.55rem,7vw,5rem)] font-extrabold leading-[1.02] text-on-surface">
              SuperDoc<br />
              <span className="text-primary">file workbench.</span>
            </h1>
            <p className="max-w-xl text-[17px] font-light leading-7 text-on-surface-variant">
              PDF, DOCX, Markdown, HTML, images, and spreadsheets. Drop a file and pick the exact output SuperDoc can create today.
            </p>
          </div>
          <div className="relative min-h-[260px] overflow-hidden rounded-[var(--radius-xl)] border border-outline-variant bg-surface-container-lowest shadow-[var(--shadow-glow)] md:min-h-[360px]">
            <img
              src="/document-workbench.svg"
              alt=""
              className="h-full min-h-[260px] w-full object-cover md:min-h-[360px]"
              aria-hidden="true"
            />
            <div className="absolute bottom-4 left-4 right-4 hidden items-center justify-between gap-3 rounded-[var(--radius-md)] border border-primary/30 px-4 py-3 shadow-[var(--shadow)] sm:flex" style={{ background: "var(--bg)" }}>
              <span className="text-xs font-bold uppercase tracking-[0.12em] text-primary">Live catalog</span>
              <span className="text-xs leading-5 text-on-surface-variant">Enabled targets are API-backed</span>
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-[var(--radius-xl)] border border-outline-variant bg-surface-container-lowest shadow-[var(--shadow-glow)] animate-[fade-up_0.7s_0.1s_ease_both]">
          {!pendingFile ? (
            <div
              className={`m-0 flex cursor-pointer flex-col items-center gap-4 rounded-[var(--radius-xl)] border-2 border-dashed px-5 py-12 text-center transition-all md:px-10 md:py-14 ${
                dragging ? "border-primary bg-primary/10" : "border-transparent hover:bg-surface-container-low"
              } ${uploading ? "pointer-events-none opacity-50" : ""}`}
              aria-label="File upload drop zone"
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false) }}
              onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
              onClick={() => !uploading && inputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && !uploading && inputRef.current?.click()}
            >
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => { handleFiles(e.target.files); e.target.value = "" }}
              />
              <div className={`flex h-[72px] w-[72px] items-center justify-center rounded-[var(--radius-lg)] border transition-all ${
                dragging
                  ? "animate-[float-soft_1.2s_ease-in-out_infinite] border-primary/50 bg-primary/20 text-primary"
                  : "border-outline-variant bg-surface-container-low text-outline"
              }`}>
                <span className="material-symbols-outlined text-[30px]">
                  {dragging ? "file_download" : "upload_file"}
                </span>
              </div>
              <div>
                <h2 className="mb-1 font-headline text-lg font-semibold text-on-surface">
                  {dragging ? "Drop it" : "Drop your file here"}
                </h2>
                <p className="text-sm text-on-surface-variant">
                  or <span className="text-primary underline underline-offset-4">browse to upload</span>
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {SUPPORTED_FORMATS.map((fmt) => (
                  <span key={fmt} className="rounded-full border border-outline-variant bg-surface-container-low px-2.5 py-1 text-[11px] font-bold tracking-[0.08em] text-outline">
                    {fmt}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-5 md:p-10">
              <div className="mb-7 flex items-center gap-3 rounded-[var(--radius-md)] border border-outline-variant bg-surface-container-low p-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border border-primary/50 bg-primary/10 text-primary">
                  <span className="material-symbols-outlined text-[22px]">description</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-on-surface">{pendingFile.name}</p>
                  <p className="mt-0.5 text-xs text-on-surface-variant">{inputType.toUpperCase()} · {formatFileSize(pendingFile.size)}</p>
                </div>
                <button
                  type="button"
                  onClick={resetToDrop}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-outline-variant text-outline transition-colors hover:border-error hover:text-error"
                  aria-label="Clear selected file"
                >
                  <span className="material-symbols-outlined text-[17px]">close</span>
                </button>
              </div>

              {hasEmptyKnownCatalog ? (
                <div className="mb-7 rounded-[var(--radius-md)] border border-error/20 bg-error-container px-4 py-4 text-on-error-container" aria-live="polite">
                  <div className="flex items-start gap-3">
                    <span className="material-symbols-outlined text-error text-[20px]">sync_problem</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">Actions are temporarily unavailable for .{inputType} files.</p>
                      <p className="mt-1 text-xs leading-5">This file type is supported, but the operation catalog returned no actions.</p>
                    </div>
                    <button
                      type="button"
                      onClick={refreshOperations}
                      className="shrink-0 rounded-[8px] border border-error/30 px-3 py-1.5 text-xs font-bold transition-colors active:scale-95 hover:bg-error/10"
                    >
                      Retry
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="mb-7">
                <div className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-outline">Convert to</div>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  {(loadingOps || hasEmptyKnownCatalog ? TARGET_GRID.map((item) => ({ ...item, enabled: false, disabledReason: loadingOps ? "Loading" : "Unavailable" })) : gridChoices).map((choice) => {
                    const actionKey = choice.opMeta ? (choice.opMeta.target ? `${choice.opMeta.operation}:${choice.opMeta.target}` : choice.opMeta.operation) : choice.target
                    const isStarting = startingAction === actionKey
                    return (
                    <button
                      key={choice.target}
                      type="button"
                      disabled={!choice.enabled || uploading || loadingOps}
                      aria-busy={isStarting ? "true" : undefined}
                      onClick={() => handlePick(choice.opMeta)}
                      className={`min-h-[74px] rounded-[var(--radius-md)] border p-3 text-left transition-all active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                        isStarting
                          ? "border-primary bg-primary/15 text-primary shadow-sm ring-2 ring-primary/20"
                          : ""
                      } ${
                        choice.enabled
                          ? "border-outline-variant bg-surface-container-low text-on-surface hover:border-primary/70 hover:bg-primary/10 disabled:border-primary/40 disabled:bg-primary/10 disabled:text-primary"
                          : "cursor-not-allowed border-outline-variant bg-surface-container-low text-outline opacity-55 grayscale"
                      }`}
                    >
                      <span className="flex items-center gap-2 font-headline text-sm font-bold">
                        {isStarting ? <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span> : null}
                        {choice.label}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-on-surface-variant">
                        {isStarting ? "Starting..." : choice.enabled ? choice.description : choice.disabledReason}
                      </span>
                    </button>
                  )})}
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                {(() => {
                  const editKey = editOperation?.operation
                  const isStartingEdit = Boolean(editKey && startingAction === editKey)
                  return (
                <button
                  type="button"
                  disabled={!editOperation || uploading || loadingOps || hasEmptyKnownCatalog}
                  aria-busy={isStartingEdit ? "true" : undefined}
                  onClick={() => handlePick(editOperation)}
                  className={`sd-button-secondary min-h-12 px-5 active:scale-[0.98] disabled:cursor-not-allowed disabled:border-outline-variant disabled:bg-surface-container disabled:text-outline disabled:opacity-60 ${
                    isStartingEdit ? "border-primary bg-primary/15 text-primary ring-2 ring-primary/20" : ""
                  }`}
                >
                  <span className={`material-symbols-outlined text-[18px] ${isStartingEdit ? "animate-spin" : ""}`}>{isStartingEdit ? "progress_activity" : "edit"}</span>
                  {isStartingEdit ? "Starting..." : editOperation ? "Edit" : "Edit unavailable"}
                </button>
                  )
                })()}
                <div className="flex-1 rounded-[var(--radius-md)] border border-outline-variant bg-surface-container px-4 py-3 text-xs text-on-surface-variant">
                  <span aria-live="polite">
                    {uploading ? "Starting..." : loadingOps ? "Checking available operations..." : hasEmptyKnownCatalog ? "Catalog returned no actions. Retry before starting." : "Pick an enabled target to start a real conversion job."}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {err && (
          <div className="mt-6 flex items-center gap-3 rounded-[var(--radius-md)] border border-error/20 bg-error-container px-4 py-3 text-on-error-container">
            <span className="material-symbols-outlined text-error text-[20px]">warning</span>
            <span className="text-sm font-medium">{err}</span>
          </div>
        )}
      </section>

      <section id="formats" className="mx-auto w-full max-w-5xl px-4 py-14">
        <div className="mb-8">
          <div className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-primary">Supported conversions</div>
          <h2 className="font-headline text-3xl font-bold leading-tight text-on-surface md:text-4xl">Every format you need</h2>
          <p className="mt-3 max-w-xl text-sm leading-7 text-on-surface-variant">
            Everyday office docs, developer formats, and images use the same direct conversion surface.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FORMAT_CARDS.map((card) => (
            <div key={card.label} className="rounded-[var(--radius-lg)] border border-outline-variant bg-surface-container-lowest p-5 transition-all hover:border-primary/50 hover:bg-primary/5">
              <div className="mb-3 flex items-center gap-2">
                <span className="rounded-[6px] bg-primary/10 px-2.5 py-1 font-headline text-xs font-extrabold text-primary">{card.from}</span>
                <span className="material-symbols-outlined text-[16px] text-outline">arrow_forward</span>
                <span className="rounded-[6px] bg-primary/10 px-2.5 py-1 font-headline text-xs font-extrabold text-primary">{card.to}</span>
              </div>
              <h3 className="font-headline font-semibold text-on-surface">{card.label}</h3>
              <p className="mt-1 text-sm leading-6 text-on-surface-variant">{card.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="how" className="mx-auto w-full max-w-5xl px-4 py-14">
        <div className="rounded-[var(--radius-xl)] border border-outline-variant bg-surface-container-lowest p-6 md:p-10">
          <div className="mb-8">
            <div className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-primary">Process</div>
            <h2 className="font-headline text-3xl font-bold leading-tight text-on-surface">Three steps, done.</h2>
          </div>
          <div className="grid gap-7 md:grid-cols-3">
            {HOW_STEPS.map((step) => (
              <div key={step.n}>
                <div className="mb-4 flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-primary/50 bg-primary/10 text-primary">
                    <span className="material-symbols-outlined text-[19px]">{step.icon}</span>
                  </span>
                  <span className="font-headline text-sm font-extrabold tracking-[0.08em] text-outline">{step.n}</span>
                </div>
                <h3 className="font-headline text-lg font-semibold text-on-surface">{step.title}</h3>
                <p className="mt-2 text-sm leading-7 text-on-surface-variant">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-4 py-8">
        <div className="grid gap-3 md:grid-cols-4">
          {TRUST_ITEMS.map((item) => (
            <div key={item.title} className="flex gap-3 rounded-[var(--radius-lg)] border border-outline-variant bg-surface-container-lowest p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] border border-primary/50 bg-primary/10 text-primary">
                <span className="material-symbols-outlined text-[17px]">{item.icon}</span>
              </span>
              <div>
                <h3 className="text-sm font-semibold text-on-surface">{item.title}</h3>
                <p className="mt-1 text-xs leading-5 text-on-surface-variant">{item.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="faq" className="mx-auto w-full max-w-5xl px-4 py-14">
        <div className="mb-7">
          <div className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-primary">FAQ</div>
          <h2 className="font-headline text-3xl font-bold leading-tight text-on-surface">Common questions</h2>
        </div>
        <div className="space-y-2">
          {FAQ_ITEMS.map((item, index) => (
            <div key={item.q} className={`overflow-hidden rounded-[var(--radius-md)] border bg-surface-container-lowest transition-colors ${openFaq === index ? "border-primary/50" : "border-outline-variant"}`}>
              <button
                type="button"
                onClick={() => setOpenFaq(openFaq === index ? null : index)}
                className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
              >
                <span className="font-headline text-sm font-semibold text-on-surface">{item.q}</span>
                <span className={`material-symbols-outlined text-[19px] text-outline transition-transform ${openFaq === index ? "rotate-180" : ""}`}>expand_more</span>
              </button>
              {openFaq === index && (
                <p className="px-5 pb-5 text-sm leading-7 text-on-surface-variant animate-[fade-in_0.2s_ease]">{item.a}</p>
              )}
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-outline-variant px-4 py-7">
        <div className="mx-auto flex max-w-5xl flex-col justify-between gap-4 text-sm text-outline sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <span className="flex h-[22px] w-[22px] items-center justify-center rounded-[5px] bg-primary">
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M3 2h7l3 3v9H3V2z" fill="#0c0c0e" /></svg>
            </span>
            <span className="font-headline font-bold text-on-surface">SuperDoc</span>
            <span>© 2026</span>
          </div>
          <div className="flex gap-5">
            <a className="text-outline no-underline hover:text-on-surface" href="#formats">Formats</a>
            <a className="text-outline no-underline hover:text-on-surface" href="#how">Process</a>
            <a className="text-outline no-underline hover:text-on-surface" href="#faq">FAQ</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
