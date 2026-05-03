import { useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { useI18n } from "../../context/I18nContext"
import { ACCEPT, SUPPORTED_FORMATS, formatFileSize, useConversionFlow } from "./useConversionFlow"

const DESKTOP_PREF_KEY = "superdoc_desktop_preference"

export function setDesktopPreference() {
  try {
    localStorage.setItem(DESKTOP_PREF_KEY, "1")
  } catch {
    // Storage can be unavailable in privacy modes.
  }
}

export function hasDesktopPreference() {
  try {
    return localStorage.getItem(DESKTOP_PREF_KEY) === "1"
  } catch {
    return false
  }
}

export function MobileHome() {
  const { t } = useI18n()
  const inputRef = useRef(null)
  const [selected, setSelected] = useState("")
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
    handleFiles,
    handlePick,
  } = useConversionFlow()

  const options = useMemo(() => {
    const enabled = gridChoices
      .filter((choice) => choice.enabled && choice.opMeta)
      .map((choice) => ({
        key: choice.opMeta.target ? `${choice.opMeta.operation}:${choice.opMeta.target}` : choice.opMeta.operation,
        label: choice.label,
        detail: choice.description,
        opMeta: choice.opMeta,
      }))
    if (editOperation) {
      enabled.unshift({
        key: editOperation.operation,
        label: t("home.edit"),
        detail: editOperation.label || t("home.edit"),
        opMeta: editOperation,
      })
    }
    return enabled
  }, [gridChoices, editOperation, t])

  const selectedOption = options.find((option) => option.key === selected)
  const isStarting = Boolean(selectedOption && startingAction === selectedOption.key)

  return (
    <main className="min-h-[calc(100svh-60px)] bg-surface">
      <section className="flex min-h-[calc(100svh-60px)] flex-col px-4 py-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">{t("home.badge")}</p>
            <h1 className="font-headline text-2xl font-extrabold leading-tight text-on-surface">SuperDoc</h1>
          </div>
          <Link
            to="/"
            onClick={setDesktopPreference}
            className="rounded-[8px] border border-outline-variant px-3 py-2 text-xs font-bold text-on-surface transition-colors active:scale-95"
          >
            Desktop version
          </Link>
        </div>

        {!pendingFile ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="flex flex-1 flex-col items-center justify-center gap-6 rounded-[var(--radius-lg)] border-2 border-dashed border-primary/45 bg-surface-container-lowest px-5 py-10 text-center shadow-[var(--shadow-glow)] active:scale-[0.99] disabled:opacity-50"
            aria-label={t("home.dropZone")}
          >
            <input
              ref={inputRef}
              type="file"
              aria-label={t("home.dropZone")}
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => { handleFiles(e.target.files); e.target.value = "" }}
            />
            <span className="flex h-20 w-20 items-center justify-center rounded-[var(--radius-lg)] border border-primary/40 bg-primary/10 text-primary">
              <span className="material-symbols-outlined text-[36px]">upload_file</span>
            </span>
            <span>
              <span className="block font-headline text-3xl font-extrabold leading-tight text-on-surface">{t("home.dropHere")}</span>
              <span className="mt-3 block text-sm leading-6 text-on-surface-variant">{t("home.browsePrefix")} {t("home.browse")}</span>
            </span>
            <span className="flex flex-wrap justify-center gap-2">
              {SUPPORTED_FORMATS.slice(0, 8).map((fmt) => (
                <span key={fmt} className="rounded-full border border-outline-variant bg-surface-container-low px-2.5 py-1 text-[11px] font-bold text-outline">
                  {fmt}
                </span>
              ))}
            </span>
          </button>
        ) : (
          <div className="flex flex-1 flex-col gap-4">
            <div className="rounded-[var(--radius-lg)] border border-outline-variant bg-surface-container-lowest p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border border-primary/40 bg-primary/10 text-primary">
                  <span className="material-symbols-outlined text-[22px]">description</span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-on-surface">{pendingFile.name}</p>
                  <p className="mt-0.5 text-xs text-on-surface-variant">{inputType.toUpperCase()} · {formatFileSize(pendingFile.size)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => { setSelected(""); resetToDrop() }}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border border-outline-variant text-outline"
                  aria-label={t("home.clearFile")}
                >
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              </div>
            </div>

            <label className="block">
              <span className="mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-outline">{t("home.convertTo")}</span>
              <select
                value={selected}
                disabled={loadingOps || uploading || hasEmptyKnownCatalog || options.length === 0}
                onChange={(e) => setSelected(e.target.value)}
                className="h-14 w-full rounded-[var(--radius-md)] border border-outline-variant bg-surface-container-lowest px-4 text-base font-semibold text-on-surface disabled:opacity-60"
              >
                <option value="">{loadingOps ? t("common.loading") : t("home.pickTarget")}</option>
                {options.map((option) => (
                  <option key={option.key} value={option.key}>{option.label}</option>
                ))}
              </select>
            </label>

            <button
              type="button"
              disabled={!selectedOption || uploading}
              onClick={() => selectedOption && handlePick(selectedOption.opMeta)}
              className="flex h-14 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-primary px-5 text-sm font-bold text-on-primary transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-outline-variant disabled:text-on-surface-variant"
            >
              <span className={`material-symbols-outlined text-[18px] ${isStarting ? "animate-spin" : ""}`}>{isStarting ? "progress_activity" : "arrow_forward"}</span>
              {isStarting ? t("common.starting") : t("common.process")}
            </button>

            <div className="rounded-[var(--radius-md)] border border-outline-variant bg-surface-container px-4 py-3 text-sm leading-6 text-on-surface-variant" aria-live="polite">
              {err || (selectedOption?.detail) || (hasEmptyKnownCatalog ? t("home.catalogEmpty") : t("home.pickTarget"))}
            </div>
          </div>
        )}
      </section>
    </main>
  )
}
