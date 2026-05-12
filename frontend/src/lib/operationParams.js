const SUPPORTED_INTERACTIVE_PARAMS = new Set(["paper_size", "high_fidelity", "fallback_strategy"])

export function interactiveSchemaFor(opMeta) {
  const schema = opMeta?.params_schema || {}
  const next = {}
  for (const key of Object.keys(schema)) {
    if (SUPPORTED_INTERACTIVE_PARAMS.has(key)) next[key] = schema[key]
  }
  return next
}

export function needsInteractiveParams(opMeta) {
  return Object.keys(interactiveSchemaFor(opMeta)).length > 0
}

export function hasUnsupportedBatchParams(opMeta) {
  const schema = opMeta?.params_schema || {}
  return Object.keys(schema).some((key) => !SUPPORTED_INTERACTIVE_PARAMS.has(key) && schema[key])
}
