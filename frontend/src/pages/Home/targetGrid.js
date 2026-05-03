export const TARGET_GRID = [
  { target: "pdf", label: "PDF", description: "Document" },
  { target: "docx", label: "DOCX", description: "Word" },
  { target: "png", label: "PNG", description: "Image" },
  { target: "jpg", label: "JPG", description: "Image" },
  { target: "webp", label: "WEBP", description: "Image" },
  { target: "gif", label: "GIF", description: "Image" },
  { target: "tiff", label: "TIFF", description: "Image" },
  { target: "md", label: "MD", description: "Markdown" },
  { target: "html", label: "HTML", description: "Webpage" },
  { target: "xlsx", label: "XLSX", description: "Spreadsheet" },
  { target: "csv", label: "CSV", description: "Spreadsheet" },
  { target: "txt", label: "TXT", description: "Plain text" },
]

const IMAGE_TYPES = new Set(["jpg", "jpeg", "png", "webp", "gif", "tiff"])
const DEPLOYED_IMAGE_TARGETS = ["png", "jpg", "jpeg", "webp", "gif"]

function normalizeTarget(value) {
  const target = String(value || "").toLowerCase()
  // JPEG and JPG are the same format. Collapse them to one internal slot so
  // the grid does not show duplicate targets for a single image worker.
  return target === "jpeg" ? "jpg" : target
}

function needsTargetFormat(op) {
  const targetSchema = op?.params_schema?.target_format
  return Boolean(
    targetSchema?.required === true ||
    op?.operation === "image_convert"
  )
}

function isSameImageConversion(inputType, target) {
  const input = normalizeTarget(inputType)
  const output = normalizeTarget(target)
  return IMAGE_TYPES.has(input) && IMAGE_TYPES.has(output) && input === output
}

function shortLabelFor(inputType, opMeta) {
  const operation = opMeta?.operation || ""
  if (operation === "pdf_to_image" || operation === "docx_to_image" || operation === "xlsx_to_image") {
    return "ZIP per page"
  }
  if (operation === "xlsx_to_pdf" || operation === "xlsx_to_csv" || operation === "xlsx_to_md" || operation === "xlsx_to_txt" || operation === "xlsx_to_html" || operation === "xlsx_to_docx") {
    return "First sheet"
  }
  if (operation === "markdown_convert" && normalizeTarget(inputType) === "txt") {
    return "Plain text source"
  }
  return undefined
}

function targetLabel(target) {
  return TARGET_GRID.find((item) => item.target === normalizeTarget(target))?.label || String(target || "").toUpperCase()
}

function expandedTargetLabel(target) {
  const normalized = normalizeTarget(target)
  if (normalized === "docx") return "Word"
  if (normalized === "txt") return "Text"
  if (normalized === "md") return "Markdown"
  if (normalized === "html") return "HTML"
  return targetLabel(normalized)
}

function sourceLabel(inputType, operation) {
  if (operation === "markdown_convert") return normalizeTarget(inputType) === "txt" ? "Text" : "Markdown"
  if (operation === "xlsx_to_csv" || operation === "xlsx_to_pdf" || operation === "xlsx_to_docx" || operation === "xlsx_to_image" || operation === "xlsx_to_md" || operation === "xlsx_to_txt" || operation === "xlsx_to_html") return "Spreadsheet"
  if (operation === "image_to_document") return "Image"
  if (operation === "pdf_to_image") return "PDF"
  if (operation === "docx_to_image") return "Word"
  if (operation === "html_convert") return "HTML"
  return "Convert"
}

function expandedLabel(inputType, op, target) {
  const normalized = normalizeTarget(target)
  if (op.operation === "pdf_to_image") return `PDF to ${targetLabel(normalized)} images (.zip)`
  if (op.operation === "docx_to_image") return `Word to ${targetLabel(normalized)} images (.zip)`
  if (op.operation === "xlsx_to_image") return `Spreadsheet to ${targetLabel(normalized)} images (.zip)`
  const source = sourceLabel(inputType, op.operation)
  return `${source} to ${expandedTargetLabel(normalized)}`
}

function disabledReasonFor(inputType, target) {
  // Same-format conversions are intentionally hidden behind a distinct
  // message so users don't confuse "do nothing" with "backend missing".
  const normalizedInput = normalizeTarget(inputType)
  const normalizedTarget = normalizeTarget(target)
  if (normalizedInput === normalizedTarget) {
    return "Same format"
  }
  // We do not try to distinguish "technically impossible" from
  // "not implemented yet" because both are simply unavailable to the user.
  return "Not supported"
}

function targetsForOperation(op) {
  if (Array.isArray(op?.targets) && op.targets.length > 0) return op.targets
  const schemaEnum = op?.params_schema?.target_format?.enum
  if (Array.isArray(schemaEnum) && schemaEnum.length > 0) return schemaEnum
  if (op?.operation === "pdf_to_image") return ["png"]
  if (op?.operation === "xlsx_to_image") return ["png"]
  if (op?.operation === "image_convert") return DEPLOYED_IMAGE_TARGETS
  if (op?.output_type) return [op.output_type]
  return []
}

function opForTarget(inputType, op, target) {
  const normalized = normalizeTarget(target)
  return {
    ...op,
    target: normalized,
    label: expandedLabel(inputType, op, normalized),
    params: {
      ...(op.params || {}),
      target_format: normalized,
    },
  }
}

function addChoice(map, target, opMeta) {
  const normalized = normalizeTarget(target)
  if (!TARGET_GRID.some((item) => item.target === normalized)) return
  if (map.has(normalized)) return
  map.set(normalized, opMeta)
}

export function buildTargetGridChoices(inputType, operations = []) {
  const byTarget = new Map()

  for (const op of operations) {
    if (!op || op.kind === "client_editor") continue
    if (op.intent && op.intent !== "convert") continue

    const targets = targetsForOperation(op)
    if (needsTargetFormat(op) && targets.length > 0) {
      for (const target of targets) {
        if (op.operation === "image_convert" && isSameImageConversion(inputType, target)) continue
        addChoice(byTarget, target, opForTarget(inputType, op, target))
      }
      continue
    }

    if (targets.length > 0) {
      const target = targets[0]
      if (op.operation === "image_convert" && isSameImageConversion(inputType, target)) continue
      addChoice(byTarget, target, { ...op, target: normalizeTarget(target) })
    }
  }

  return TARGET_GRID.map((item) => {
    const opMeta = byTarget.get(item.target)
    // Prefer the conversion-specific blurb when the catalog exposes an
    // operation; otherwise keep the static grid description.
    const description = (opMeta && shortLabelFor(inputType, opMeta)) || item.description
    return {
      ...item,
      description,
      enabled: Boolean(opMeta),
      opMeta: opMeta || null,
      disabledReason: opMeta ? "" : disabledReasonFor(inputType, item.target),
    }
  })
}

export function findClientEditorOperation(operations = []) {
  return operations.find((op) => op?.kind === "client_editor") || null
}
