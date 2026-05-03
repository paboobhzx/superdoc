import { useState, useRef } from "react"
import { useI18n } from "../../context/I18nContext"
import { TARGET_GRID } from "./targetGrid"
import { useConversionFlow } from "./useConversionFlow"

const SUPPORTED_FORMATS = ["PDF", "DOCX", "MD", "HTML", "PNG", "JPG", "WEBP", "GIF", "TIFF", "XLSX", "CSV", "TXT"]
// MIME types and extensions that the file picker accepts. Keep this in sync
// with the supported inputs in operations.py so new backend capabilities can
// actually be uploaded from the Home surface.
const ACCEPT = "application/pdf,.docx,.xlsx,.csv,.jpg,.jpeg,.png,.webp,.gif,.tiff,.md,.markdown,.html,.htm,.txt"
// Catalog gate used by Home.jsx to decide when an empty response is a real
// problem instead of a format we do not support yet.
const KNOWN_CATALOG_TYPES = new Set(["pdf", "docx", "xlsx", "csv", "png", "jpg", "jpeg", "webp", "gif", "tiff", "md", "markdown", "txt", "html", "htm"])

const FORMAT_CARDS = [
  { from: "PDF", to: "DOCX", key: "pdfWord" },
  { from: "DOCX", to: "PDF", key: "wordPdf" },
  { from: "MD", to: "DOCX", key: "mdWord" },
  { from: "HTML", to: "DOCX", key: "htmlWord" },
  { from: "IMG", to: "PDF", key: "imgPdf" },
  { from: "PDF", to: "PNG", key: "pdfImage" },
]

const HOW_STEPS = [
  { icon: "upload_file", n: "01", key: "drop" },
  { icon: "view_module", n: "02", key: "choose" },
  { icon: "download", n: "03", key: "download" },
]

const TRUST_ITEMS = [
  { icon: "lock", key: "private" },
  { icon: "bolt", key: "fast" },
  { icon: "public", key: "browser" },
  { icon: "restart_alt", key: "honest" },
]

const FAQ_ITEMS = [
  { key: "free" },
  { key: "unsupported" },
  { key: "edit" },
  { key: "routes" },
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
  const { t } = useI18n()
  const [dragging, setDragging] = useState(false)
  const [openFaq, setOpenFaq] = useState(null)
  const inputRef = useRef(null)
  const {
    pendingFile,
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
  } = useConversionFlow()

  return (
    <div className="min-h-[calc(100vh-60px)]">
      <section className="mx-auto w-full max-w-6xl px-4 pb-12 pt-10 md:pb-16 md:pt-16">
        <div className="mb-10 grid animate-[fade-up_0.6s_ease_both] items-center gap-8 md:grid-cols-[1.05fr_0.95fr]">
          <div className="flex flex-col items-start gap-5 text-left">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/50 bg-primary/10 px-3.5 py-1.5 text-xs font-bold uppercase tracking-[0.12em] text-primary">
              <span className="material-symbols-outlined text-[14px]">bolt</span>
              {t("home.badge")}
            </div>
            <h1 className="max-w-3xl font-headline text-[clamp(2.55rem,7vw,5rem)] font-extrabold leading-[1.02] text-on-surface">
              {t("home.headlineLine1")}<br />
              <span className="text-primary">{t("home.headlineLine2")}</span>
            </h1>
            <p className="max-w-xl text-[17px] font-light leading-7 text-on-surface-variant">
              {t("home.intro")}
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
              <span className="text-xs font-bold uppercase tracking-[0.12em] text-primary">{t("home.liveCatalog")}</span>
              <span className="text-xs leading-5 text-on-surface-variant">{t("home.apiBacked")}</span>
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-[var(--radius-xl)] border border-outline-variant bg-surface-container-lowest shadow-[var(--shadow-glow)] animate-[fade-up_0.7s_0.1s_ease_both]">
          {!pendingFile ? (
            <div
              className={`m-0 flex cursor-pointer flex-col items-center gap-4 rounded-[var(--radius-xl)] border-2 border-dashed px-5 py-12 text-center transition-all md:px-10 md:py-14 ${
                dragging ? "border-primary bg-primary/10" : "border-transparent hover:bg-surface-container-low"
              } ${uploading ? "pointer-events-none opacity-50" : ""}`}
              aria-label={t("home.dropZone")}
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
                  {dragging ? t("home.dropIt") : t("home.dropHere")}
                </h2>
                <p className="text-sm text-on-surface-variant">
                  {t("home.browsePrefix")} <span className="text-primary underline underline-offset-4">{t("home.browse")}</span>
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
                  aria-label={t("home.clearFile")}
                >
                  <span className="material-symbols-outlined text-[17px]">close</span>
                </button>
              </div>

              {hasEmptyKnownCatalog ? (
                <div className="mb-7 rounded-[var(--radius-md)] border border-error/20 bg-error-container px-4 py-4 text-on-error-container" aria-live="polite">
                  <div className="flex items-start gap-3">
                    <span className="material-symbols-outlined text-error text-[20px]">sync_problem</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{t("home.emptyCatalogTitle", { type: inputType })}</p>
                      <p className="mt-1 text-xs leading-5">{t("home.emptyCatalogBody")}</p>
                    </div>
                    <button
                      type="button"
                      onClick={refreshOperations}
                      className="shrink-0 rounded-[8px] border border-error/30 px-3 py-1.5 text-xs font-bold transition-colors active:scale-95 hover:bg-error/10"
                    >
                      {t("common.retry")}
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="mb-7">
                <div className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-outline">{t("home.convertTo")}</div>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  {(loadingOps || hasEmptyKnownCatalog ? TARGET_GRID.map((item) => ({ ...item, enabled: false, disabledReason: loadingOps ? t("common.loading") : t("common.unavailable") })) : gridChoices).map((choice) => {
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
                        {isStarting ? t("common.starting") : choice.enabled ? choice.description : choice.disabledReason}
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
                  {isStartingEdit ? t("common.starting") : editOperation ? t("home.edit") : t("home.editUnavailable")}
                </button>
                  )
                })()}
                <div className="flex-1 rounded-[var(--radius-md)] border border-outline-variant bg-surface-container px-4 py-3 text-xs text-on-surface-variant">
                  <span aria-live="polite">
                    {uploading ? t("common.starting") : loadingOps ? t("home.checkingOperations") : hasEmptyKnownCatalog ? t("home.catalogEmpty") : t("home.pickTarget")}
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
          <div className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-primary">{t("home.supportedConversions")}</div>
          <h2 className="font-headline text-3xl font-bold leading-tight text-on-surface md:text-4xl">{t("home.everyFormat")}</h2>
          <p className="mt-3 max-w-xl text-sm leading-7 text-on-surface-variant">
            {t("home.formatsBody")}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FORMAT_CARDS.map((card) => (
            <div key={card.key} className="rounded-[var(--radius-lg)] border border-outline-variant bg-surface-container-lowest p-5 transition-all hover:border-primary/50 hover:bg-primary/5">
              <div className="mb-3 flex items-center gap-2">
                <span className="rounded-[6px] bg-primary/10 px-2.5 py-1 font-headline text-xs font-extrabold text-primary">{card.from}</span>
                <span className="material-symbols-outlined text-[16px] text-outline">arrow_forward</span>
                <span className="rounded-[6px] bg-primary/10 px-2.5 py-1 font-headline text-xs font-extrabold text-primary">{card.to}</span>
              </div>
              <h3 className="font-headline font-semibold text-on-surface">{t(`home.formatCards.${card.key}.label`)}</h3>
              <p className="mt-1 text-sm leading-6 text-on-surface-variant">{t(`home.formatCards.${card.key}.desc`)}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="how" className="mx-auto w-full max-w-5xl px-4 py-14">
        <div className="rounded-[var(--radius-xl)] border border-outline-variant bg-surface-container-lowest p-6 md:p-10">
          <div className="mb-8">
            <div className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-primary">{t("home.processEyebrow")}</div>
            <h2 className="font-headline text-3xl font-bold leading-tight text-on-surface">{t("home.threeSteps")}</h2>
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
                <h3 className="font-headline text-lg font-semibold text-on-surface">{t(`home.steps.${step.key}.title`)}</h3>
                <p className="mt-2 text-sm leading-7 text-on-surface-variant">{t(`home.steps.${step.key}.body`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-4 py-8">
        <div className="grid gap-3 md:grid-cols-4">
          {TRUST_ITEMS.map((item) => (
            <div key={item.key} className="flex gap-3 rounded-[var(--radius-lg)] border border-outline-variant bg-surface-container-lowest p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] border border-primary/50 bg-primary/10 text-primary">
                <span className="material-symbols-outlined text-[17px]">{item.icon}</span>
              </span>
              <div>
                <h3 className="text-sm font-semibold text-on-surface">{t(`home.trust.${item.key}.title`)}</h3>
                <p className="mt-1 text-xs leading-5 text-on-surface-variant">{t(`home.trust.${item.key}.body`)}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="faq" className="mx-auto w-full max-w-5xl px-4 py-14">
        <div className="mb-7">
          <div className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-primary">{t("common.faq")}</div>
          <h2 className="font-headline text-3xl font-bold leading-tight text-on-surface">{t("home.faqTitle")}</h2>
        </div>
        <div className="space-y-2">
          {FAQ_ITEMS.map((item, index) => (
            <div key={item.key} className={`overflow-hidden rounded-[var(--radius-md)] border bg-surface-container-lowest transition-colors ${openFaq === index ? "border-primary/50" : "border-outline-variant"}`}>
              <button
                type="button"
                onClick={() => setOpenFaq(openFaq === index ? null : index)}
                className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
              >
                <span className="font-headline text-sm font-semibold text-on-surface">{t(`home.faqItems.${item.key}.q`)}</span>
                <span className={`material-symbols-outlined text-[19px] text-outline transition-transform ${openFaq === index ? "rotate-180" : ""}`}>expand_more</span>
              </button>
              {openFaq === index && (
                <p className="px-5 pb-5 text-sm leading-7 text-on-surface-variant animate-[fade-in_0.2s_ease]">{t(`home.faqItems.${item.key}.a`)}</p>
              )}
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-outline-variant px-4 py-7">
        <div className="mx-auto flex max-w-5xl flex-col justify-between gap-4 text-sm text-outline sm:flex-row sm:items-center">
          <p className="m-0 text-sm text-outline">
            {t("home.footer.developedBy")} -{" "}
            <a className="text-outline no-underline hover:text-on-surface" href="http://pablobhz.cloud">http://pablobhz.cloud</a>{" "}
            -{" "}
            <a className="text-outline no-underline hover:text-on-surface" href="http://linkedin.com/in/pablobhz">LinkedIn</a>
          </p>
          <div className="flex gap-5">
            <a className="text-outline no-underline hover:text-on-surface" href="#formats">{t("common.formats")}</a>
            <a className="text-outline no-underline hover:text-on-surface" href="#how">{t("common.process")}</a>
            <a className="text-outline no-underline hover:text-on-surface" href="#faq">{t("common.faq")}</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
