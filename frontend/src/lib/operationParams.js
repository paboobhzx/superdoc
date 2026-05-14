const EXCLUDED_INTERACTIVE_PARAMS = new Set(["target_format"])

function isInteractiveParam(schema) {
  const type = schema?.type
  return (
    type === "string" ||
    type === "enum" ||
    type === "boolean" ||
    type === "integer" ||
    type === "float" ||
    Array.isArray(schema?.enum) ||
    Array.isArray(schema?.values)
  )
}

export function interactiveSchemaFor(opMeta) {
  const schema = opMeta?.params_schema || {}
  const next = {}
  for (const key of Object.keys(schema)) {
    if (!EXCLUDED_INTERACTIVE_PARAMS.has(key) && isInteractiveParam(schema[key])) next[key] = schema[key]
  }
  return next
}

export function needsInteractiveParams(opMeta) {
  return Object.keys(interactiveSchemaFor(opMeta)).length > 0
}

export function hasUnsupportedBatchParams(opMeta) {
  const schema = opMeta?.params_schema || {}
  return Object.keys(schema).some((key) => !EXCLUDED_INTERACTIVE_PARAMS.has(key) && !isInteractiveParam(schema[key]))
}
