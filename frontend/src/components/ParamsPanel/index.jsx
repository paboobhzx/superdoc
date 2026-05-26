import { useEffect, useRef, useState } from "react"
import { useI18n } from "../../context/I18nContext"

const PAPER_SIZES = [
  { id: "A4", label: "A4", sub: "210×297 mm" },
  { id: "Letter", label: "Letter", sub: '8.5×11"' },
  { id: "A3", label: "A3", sub: "297×420 mm" },
  { id: "Legal", label: "Legal", sub: '8.5×14"' },
  { id: "A5", label: "A5", sub: "148×210 mm" },
]

const BESPOKE_KEYS = new Set(["paper_size", "high_fidelity", "target_format"])

function schemaOptions(definition) {
  return definition?.values || definition?.enum || []
}

function labelFor(key, definition, t) {
  if (key === "fallback_strategy") return t("paramsPanel.fallbackStrategyLabel")
  return definition?.label || key.replaceAll("_", " ")
}

function defaultValueFor(definition) {
  if (definition?.type === "boolean") return definition.default === true
  if (definition?.default !== undefined) return definition.default
  const options = schemaOptions(definition)
  if (options.length > 0) return options[0]
  if (definition?.type === "integer" || definition?.type === "float") return ""
  return ""
}

function AnalysisStrip({ analysisState, analysisResult, analysisStartedAt, integrityDecision, onRepairPdf, onContinueWithoutRepair }) {
  const { t } = useI18n()
  const [elapsed, setElapsed] = useState(0)
  const [reportOpen, setReportOpen] = useState(false)
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
    const recommendation = analysisResult.recommendation
    const recLabel = recommendation === "xlsx"
      ? t("params.pdfAnalyze.modeXlsx")
      : recommendation === "image"
        ? t("params.pdfAnalyze.modeHighFidelity")
        : t("params.pdfAnalyze.modeRegular")
    const estimatedSecs = recommendation === "image"
      ? analysisResult.estimated_seconds?.image
      : analysisResult.estimated_seconds?.text
    const rationaleTexts = [...new Set(analysisResult.rationale_keys || [])]
      .map((key) => t(`params.pdfAnalyze.rationale.${key}`, { defaultValue: "" }))
      .filter(Boolean)
    const primaryRationale = rationaleTexts[0] || ""
    const secondaryRationales = rationaleTexts.slice(1, 3)
    const signals = analysisResult.signals || {}
    const percent = (value) => typeof value === "number" ? `${Math.round(value * 100)}%` : t("common.unknown")
    const numberValue = (value) => value === 0 || value ? String(value) : t("common.unknown")
    const boolValue = (value) => value === true ? t("common.yes") : value === false ? t("common.no") : t("common.unknown")
    const reportRows = [
      [t("params.pdfAnalyze.report.complexity"), numberValue(analysisResult.complexity_score)],
      [t("params.pdfAnalyze.report.pages"), numberValue(analysisResult.page_count)],
      [t("params.pdfAnalyze.report.fileSize"), analysisResult.file_size_mb === 0 || analysisResult.file_size_mb ? `${analysisResult.file_size_mb} MB` : t("common.unknown")],
      [t("params.pdfAnalyze.report.producer"), signals.producer || t("common.unknown")],
      [t("params.pdfAnalyze.report.xobjects"), numberValue(signals.mean_xobjects_per_page)],
      [t("params.pdfAnalyze.report.textRatio"), percent(signals.text_extractable_ratio)],
      [t("params.pdfAnalyze.report.imageCoverage"), percent(signals.image_coverage_ratio)],
      [t("params.pdfAnalyze.report.columns"), numberValue(signals.column_count_hint)],
      [t("params.pdfAnalyze.report.highFidelityViable"), boolValue(analysisResult.high_fidelity_viable)],
      [t("params.pdfAnalyze.report.regularViable"), boolValue(analysisResult.regular_text_viable)],
      [t("params.pdfAnalyze.report.highFidelityEstimate"), analysisResult.estimated_seconds?.image ? t("params.pdfAnalyze.estimate", { seconds: analysisResult.estimated_seconds.image }) : t("common.unknown")],
      [t("params.pdfAnalyze.report.regularEstimate"), analysisResult.estimated_seconds?.text ? t("params.pdfAnalyze.estimate", { seconds: analysisResult.estimated_seconds.text }) : t("common.unknown")],
    ]
    const composition = analysisResult.classification?.summary || null

    const integrity = analysisResult.pdf_integrity || null
    const integrityNeedsDecision = integrity && Number(integrity.score) < 100 && !integrityDecision
    return (
      <div className="mb-4 rounded-[var(--radius-md)] border border-primary/20 bg-primary/5 px-4 py-3">
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
        {primaryRationale && (
          <p className="text-xs text-on-surface-variant leading-relaxed">{primaryRationale}</p>
        )}
        {secondaryRationales.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs leading-relaxed text-on-surface-variant">
            {secondaryRationales.map((text) => (
              <li key={text} className="flex gap-2">
                <span className="mt-[0.45em] h-1 w-1 shrink-0 rounded-full bg-primary/70" />
                <span>{text}</span>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={() => setReportOpen((value) => !value)}
          aria-expanded={reportOpen}
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-primary transition-colors hover:text-on-surface"
        >
          <span className="material-symbols-outlined text-[15px]">{reportOpen ? "expand_less" : "expand_more"}</span>
          {reportOpen ? t("params.pdfAnalyze.hideReport") : t("params.pdfAnalyze.viewReport")}
        </button>
        {reportOpen && (
          <dl className="mt-3 grid grid-cols-1 gap-2 border-t border-outline-variant/20 pt-3 sm:grid-cols-2">
            {reportRows.map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-outline">{label}</dt>
                <dd className="mt-0.5 truncate text-xs font-semibold text-on-surface" title={value}>{value}</dd>
              </div>
            ))}
          </dl>
        )}
        {composition && (
          <div className="mt-3 rounded-lg border border-outline-variant/25 bg-surface-container px-3 py-2">
            <p className="text-xs font-semibold text-on-surface">{t("params.pdfAnalyze.compositionTitle")}</p>
            <p className="mt-1 text-xs text-on-surface-variant">
              {t("params.pdfAnalyze.compositionValue", {
                text: composition.text_pages,
                scanned: composition.scanned_image_pages,
                hybrid: composition.hybrid_pages,
                ambiguous: composition.ambiguous_pages,
              })}
            </p>
          </div>
        )}
        {analysisResult.needs_ocr && (
          <div className="mt-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2">
            <p className="text-xs font-semibold text-on-surface">{t("params.pdfAnalyze.scannedTitle")}</p>
            <p className="mt-1 text-xs text-on-surface-variant">{t("params.pdfAnalyze.scannedBody")}</p>
          </div>
        )}
        {integrity && Number(integrity.score) < 100 ? (
          <div className="mt-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2">
            <p className="text-xs font-semibold text-on-surface">PDF integrity score: {integrity.score}/100</p>
            {Array.isArray(integrity.warnings) && integrity.warnings.length > 0 ? (
              <p className="mt-1 text-xs text-on-surface-variant">{integrity.warnings[0]}</p>
            ) : null}
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={onRepairPdf} className="sd-button-secondary min-h-9 px-3 text-xs">Repair PDF</button>
              <button type="button" onClick={onContinueWithoutRepair} className="sd-button-secondary min-h-9 px-3 text-xs">Continue without repair</button>
            </div>
            {integrityNeedsDecision ? (
              <p className="mt-2 text-xs text-error">Choose repair or continue before processing.</p>
            ) : null}
          </div>
        ) : null}
      </div>
    )
  }

  return null
}

export function ParamsPanel({
  opMeta, onConfirm, onCancel, analysisState, analysisResult, analysisStartedAt,
  integrityDecision, onRepairPdf, onContinueWithoutRepair,
}) {
  const { t } = useI18n()
  const schema = opMeta?.params_schema || {}
  const hasPaperSize = Boolean(schema.paper_size)
  const hasHighFidelity = Boolean(schema.high_fidelity)
  const isPdfOperation = String(opMeta?.operation || "").startsWith("pdf_")
  const isPdfToDocx = opMeta?.operation === "pdf_to_docx"
  const defaultHighFidelity = isPdfToDocx ? false : schema.high_fidelity?.default === true

  const [paperSize, setPaperSize] = useState("A4")
  const [highFidelity, setHighFidelity] = useState(defaultHighFidelity)
  const [genericParams, setGenericParams] = useState({})
  const [watermarkImageFile, setWatermarkImageFile] = useState(null)

  useEffect(() => {
    setPaperSize(schema.paper_size?.default || "A4")
    setHighFidelity(defaultHighFidelity)
    const next = {}
    for (const [key, definition] of Object.entries(schema)) {
      if (!BESPOKE_KEYS.has(key)) next[key] = defaultValueFor(definition)
    }
    setGenericParams(next)
    setWatermarkImageFile(null)
  }, [opMeta?.operation, schema, schema.paper_size?.default, defaultHighFidelity])

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
    for (const [key, definition] of Object.entries(schema)) {
      if (BESPOKE_KEYS.has(key)) continue
      const value = genericParams[key]
      if (definition?.type === "boolean") {
        params[key] = Boolean(value)
      } else if (definition?.type === "integer") {
        if (value !== "" && value !== null && value !== undefined) params[key] = Number.parseInt(value, 10)
      } else if (definition?.type === "float") {
        if (value !== "" && value !== null && value !== undefined) params[key] = Number.parseFloat(value)
      } else if (value !== undefined && value !== null) {
        params[key] = String(value)
      }
    }
    if (opMeta?.operation === "pdf_annotate" && params.watermark_type === "image") {
      if (!watermarkImageFile) return
      params.__extraFiles = [{ role: "watermark_image", file: watermarkImageFile }]
    }
    onConfirm(params)
  }

  function updateGenericParam(key, value) {
    setGenericParams((current) => ({ ...current, [key]: value }))
  }

  const genericEntries = Object.entries(schema).filter(([key]) => !BESPOKE_KEYS.has(key))
  const needsWatermarkImage = opMeta?.operation === "pdf_annotate" && genericParams.watermark_type === "image"

  const integrity = analysisResult?.pdf_integrity || null
  const requiresIntegrityDecision = Boolean(
    isPdfOperation && analysisState === "ready" && integrity && Number(integrity.score) < 100 && !integrityDecision
  )

  return (
    <div className="animate-[fade-in_0.2s_ease]">
      {isPdfOperation && (
        <AnalysisStrip
          analysisState={analysisState}
          analysisResult={analysisResult}
          analysisStartedAt={analysisStartedAt}
          integrityDecision={integrityDecision}
          onRepairPdf={onRepairPdf}
          onContinueWithoutRepair={onContinueWithoutRepair}
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

      {genericEntries.length > 0 ? (
        <div className={`${hasPaperSize || hasHighFidelity ? "mt-4 pt-4 border-t border-outline-variant/20" : ""} mb-5 space-y-4`}>
          {genericEntries.map(([key, definition]) => {
            const options = schemaOptions(definition)
            const type = options.length > 0 ? "enum" : definition?.type
            const label = labelFor(key, definition, t)
            if (type === "boolean") {
              return (
                <label key={key} className="flex items-start gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={Boolean(genericParams[key])}
                    onChange={(e) => updateGenericParam(key, e.target.checked)}
                    className="mt-0.5 accent-primary h-4 w-4 shrink-0"
                  />
                  <span className="text-sm font-semibold capitalize text-on-surface">{label}</span>
                </label>
              )
            }
            if (type === "enum") {
              return (
                <label key={key} className="block">
                  <span className="mb-1.5 block text-xs font-bold uppercase tracking-[0.1em] text-outline">{label}</span>
                  <select
                    value={genericParams[key] ?? ""}
                    onChange={(e) => updateGenericParam(key, e.target.value)}
                    className="min-h-11 w-full rounded-[var(--radius-md)] border border-outline-variant bg-surface-container-low px-3 text-sm text-on-surface"
                  >
                    {options.map((option) => (
                      <option key={option} value={option}>{String(option)}</option>
                    ))}
                  </select>
                </label>
              )
            }
            if (type === "integer" || type === "float") {
              return (
                <label key={key} className="block">
                  <span className="mb-1.5 block text-xs font-bold uppercase tracking-[0.1em] text-outline">{label}</span>
                  <input
                    type="number"
                    step={type === "float" ? "0.01" : "1"}
                    min={definition?.minimum}
                    max={definition?.maximum}
                    value={genericParams[key] ?? ""}
                    onChange={(e) => updateGenericParam(key, e.target.value)}
                    className="min-h-11 w-full rounded-[var(--radius-md)] border border-outline-variant bg-surface-container-low px-3 text-sm text-on-surface"
                  />
                </label>
              )
            }
            return (
              <label key={key} className="block">
                <span className="mb-1.5 block text-xs font-bold uppercase tracking-[0.1em] text-outline">{label}</span>
                <input
                  type="text"
                  value={genericParams[key] ?? ""}
                  onChange={(e) => updateGenericParam(key, e.target.value)}
                  className="min-h-11 w-full rounded-[var(--radius-md)] border border-outline-variant bg-surface-container-low px-3 text-sm text-on-surface"
                />
              </label>
            )
          })}
        </div>
      ) : null}

      {needsWatermarkImage ? (
        <div className="mb-5 rounded-[var(--radius-md)] border border-outline-variant bg-surface-container-low px-4 py-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-bold uppercase tracking-[0.1em] text-outline">Watermark image</span>
            <input
              type="file"
              accept="image/png,image/jpeg"
              onChange={(e) => setWatermarkImageFile(e.target.files?.[0] || null)}
              className="block w-full text-sm text-on-surface file:mr-3 file:rounded-[8px] file:border file:border-outline-variant file:bg-surface-container-lowest file:px-3 file:py-2 file:text-sm file:font-semibold file:text-on-surface"
            />
          </label>
          {watermarkImageFile ? (
            <p className="mt-2 truncate text-xs text-on-surface-variant">{watermarkImageFile.name}</p>
          ) : (
            <p className="mt-2 text-xs text-error">Choose a PNG or JPEG image before starting.</p>
          )}
        </div>
      ) : null}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={(needsWatermarkImage && !watermarkImageFile) || requiresIntegrityDecision}
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
