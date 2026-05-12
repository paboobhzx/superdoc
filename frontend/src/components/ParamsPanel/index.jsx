import { useEffect, useRef, useState } from "react"
import { useI18n } from "../../context/I18nContext"

const PAPER_SIZES = [
  { id: "A4", label: "A4", sub: "210×297 mm" },
  { id: "Letter", label: "Letter", sub: '8.5×11"' },
  { id: "A3", label: "A3", sub: "297×420 mm" },
  { id: "Legal", label: "Legal", sub: '8.5×14"' },
  { id: "A5", label: "A5", sub: "148×210 mm" },
]

function AnalysisStrip({ analysisState, analysisResult, analysisStartedAt }) {
  const { t } = useI18n()
  const [elapsed, setElapsed] = useState(0)
  const intervalRef = useRef(null)

  useEffect(() => {
    if (analysisState === "uploading" || analysisState === "analyzing") {
      setElapsed(0)
      intervalRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - (analysisStartedAt || Date.now())) / 1000))
      }, 100)
    } else {
      clearInterval(intervalRef.current)
    }
    return () => clearInterval(intervalRef.current)
  }, [analysisState, analysisStartedAt])

  if (!analysisState || analysisState === "idle" || analysisState === "error") return null

  if (analysisState === "uploading" || analysisState === "analyzing") {
    return (
      <div className="mb-4 rounded-xl border border-outline-variant/20 bg-surface-container px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent shrink-0" />
          <span className="text-sm font-semibold text-on-surface">
            {t("params.pdfAnalyze.waitingTitle")}
          </span>
          <span className="ml-auto text-xs tabular-nums text-on-surface-variant">
            {elapsed}{t("params.pdfAnalyze.seconds")}
          </span>
        </div>
        <p className="mt-1.5 text-xs text-on-surface-variant leading-relaxed">
          {t("params.pdfAnalyze.waitingHint")}
        </p>
      </div>
    )
  }

  if (analysisState === "ready" && analysisResult) {
    const isImage = analysisResult.recommendation === "image"
    const recLabel = isImage
      ? t("params.pdfAnalyze.recommendImage")
      : t("params.pdfAnalyze.recommendText")
    const estimatedSecs = isImage
      ? analysisResult.estimated_seconds?.image
      : analysisResult.estimated_seconds?.text
    const rationaleKey = (analysisResult.rationale_keys || [])[0]
    const rationaleText = rationaleKey
      ? t(`params.pdfAnalyze.rationale.${rationaleKey}`, { defaultValue: "" })
      : ""

    return (
      <div className="mb-4 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <span className="material-symbols-outlined text-primary text-[16px]">auto_awesome</span>
          <span className="text-sm font-semibold text-on-surface">
            {t("params.pdfAnalyze.recommendation")}{": "}
            <span className="text-primary">{recLabel}</span>
          </span>
          {estimatedSecs && (
            <span className="ml-auto text-xs text-on-surface-variant tabular-nums">
              {t("params.pdfAnalyze.estimate", { seconds: estimatedSecs })}
            </span>
          )}
        </div>
        {rationaleText && (
          <p className="text-xs text-on-surface-variant leading-relaxed">{rationaleText}</p>
        )}
      </div>
    )
  }

  return null
}

export function ParamsPanel({ opMeta, onConfirm, onCancel, analysisState, analysisResult, analysisStartedAt }) {
  const { t } = useI18n()
  const schema = opMeta?.params_schema || {}
  const hasPaperSize = Boolean(schema.paper_size)
  const hasHighFidelity = Boolean(schema.high_fidelity)
  const isPdfToDocx = opMeta?.operation === "pdf_to_docx"
  const defaultHighFidelity = isPdfToDocx ? false : schema.high_fidelity?.default === true

  const [paperSize, setPaperSize] = useState("A4")
  const [highFidelity, setHighFidelity] = useState(defaultHighFidelity)

  useEffect(() => {
    setPaperSize(schema.paper_size?.default || "A4")
    setHighFidelity(defaultHighFidelity)
  }, [opMeta?.operation, schema.paper_size?.default, defaultHighFidelity])

  // When analysis arrives, auto-set checkbox to match the recommendation
  useEffect(() => {
    if (analysisState === "ready" && analysisResult?.recommendation) {
      setHighFidelity(analysisResult.recommendation === "image")
    }
  }, [analysisState, analysisResult])

  function handleConfirm() {
    const params = {}
    if (hasPaperSize) params.paper_size = paperSize
    if (hasHighFidelity) params.high_fidelity = highFidelity
    onConfirm(params)
  }

  return (
    <div className="animate-[fade-in_0.2s_ease]">
      {isPdfToDocx && (
        <AnalysisStrip
          analysisState={analysisState}
          analysisResult={analysisResult}
          analysisStartedAt={analysisStartedAt}
        />
      )}

      {hasPaperSize && (
        <>
          <div className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-outline">{t("paramsPanel.pageSize")}</div>
          <div className="mb-5 flex flex-wrap gap-2">
            {PAPER_SIZES.map((size) => (
              <button
                key={size.id}
                type="button"
                onClick={() => setPaperSize(size.id)}
                className={`flex flex-col items-start rounded-[var(--radius-md)] border px-4 py-3 text-left transition-all active:scale-[0.97] ${
                  paperSize === size.id
                    ? "border-primary bg-primary/15 text-primary ring-2 ring-primary/20"
                    : "border-outline-variant bg-surface-container-low text-on-surface hover:border-primary/60 hover:bg-primary/8"
                }`}
              >
                <span className="font-headline text-sm font-bold">{size.label}</span>
                <span className="mt-0.5 text-[11px] text-on-surface-variant">{size.sub}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {hasHighFidelity && (
        <div className={`${hasPaperSize ? "mt-4 pt-4 border-t border-outline-variant/20" : ""} mb-5`}>
          <label className="flex items-start gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={highFidelity}
              onChange={(e) => setHighFidelity(e.target.checked)}
              className="mt-0.5 accent-primary h-4 w-4 shrink-0"
            />
            <div>
              <span className="text-sm font-semibold text-on-surface">{t("params.highFidelity")}</span>
              <p className="text-xs text-on-surface-variant mt-0.5 leading-relaxed">
                {t(isPdfToDocx ? "params.highFidelityPdfHint" : "params.highFidelityHint")}
              </p>
            </div>
          </label>
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={handleConfirm}
          className="sd-button-primary min-h-11 flex-1 px-5 active:scale-[0.98]"
        >
          <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
          {t("paramsPanel.convert")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="sd-button-secondary min-h-11 px-5 active:scale-[0.98]"
        >
          {t("common.back")}
        </button>
      </div>
    </div>
  )
}
