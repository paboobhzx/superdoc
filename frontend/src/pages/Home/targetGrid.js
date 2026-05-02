export const TARGET_GRID = [
  { target: "pdf", label: "PDF", description: "Document" },
  { target: "docx", label: "DOCX", description: "Word" },
  { target: "png", label: "PNG", description: "Image" },
  { target: "jpg", label: "JPG", description: "Image" },
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

function targetLabel(target) {
  return TARGET_GRID.find((item) => item.target === normalizeTarget(target))?.label || String(target || "").toUpperCase()
}

function targetsForOperation(op) {
  if (Array.isArray(op?.targets) && op.targets.length > 0) return op.targets
  const schemaEnum = op?.params_schema?.target_format?.enum
  if (Array.isArray(schemaEnum) && schemaEnum.length > 0) return schemaEnum
  if (op?.operation === "pdf_to_image") return ["png"]
  if (op?.operation === "image_convert") return DEPLOYED_IMAGE_TARGETS
  if (op?.output_type) return [op.output_type]
  return []
}

function opForTarget(op, target) {
  const normalized = normalizeTarget(target)
  return {
    ...op,
    target: normalized,
    label: `${op.label || "Convert"} to ${targetLabel(normalized)}`,
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
        addChoice(byTarget, target, opForTarget(op, target))
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
    return {
      ...item,
      enabled: Boolean(opMeta),
      opMeta: opMeta || null,
      disabledReason: opMeta ? "" : "Unavailable for this file",
    }
  })
}

export function findClientEditorOperation(operations = []) {
  return operations.find((op) => op?.kind === "client_editor") || null
}
