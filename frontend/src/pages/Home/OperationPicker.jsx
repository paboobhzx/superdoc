// frontend/src/pages/Home/OperationPicker.jsx
//
// Two-step picker:
//   Step 1 (intent):  user chooses "Edit" or "Convert" when the input has
//                     ops in both buckets. Skipped if only one bucket exists.
//   Step 2 (action):  user picks the specific operation within that bucket.
//
// Rationale: a flat list of 9 ops for .pdf looked like a wall of text and
// mixed two mental models ("I want to edit this" vs "I want a different
// format"). Separating them shrinks the visible decision to 2 cards first,
// then 2-6 cards second — easier on anyone not already a power user.

import { useEffect, useState, useRef, useMemo } from "react"
import { api } from "../../lib/api"
import { uiFor } from "./picker"

const CACHE_KEY = "superdoc_operations_cache"
const CACHE_TTL_MS = 10 * 60 * 1000


function readCache(inputType) {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || !parsed.byType) return null
    const entry = parsed.byType[inputType || "__all__"]
    if (!entry) return null
    if (Date.now() - entry.ts > CACHE_TTL_MS) return null
    return entry.data
  } catch {
    return null
  }
}


function writeCache(inputType, data) {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    let parsed = { byType: {} }
    if (raw) {
      try {
        parsed = JSON.parse(raw) || { byType: {} }
        if (!parsed.byType) parsed.byType = {}
      } catch {
        parsed = { byType: {} }
      }
    }
    parsed.byType[inputType || "__all__"] = { ts: Date.now(), data }
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(parsed))
  } catch {
    // sessionStorage can fail in private browsing; silently continue.
  }
}


// Copy for the two top-level intents shown on Step 1.
const INTENT_META = {
  edit: {
    icon: "edit",
    title: "Edit",
    description: "Change the file without converting to a different format.",
  },
  convert: {
    icon: "sync_alt",
    title: "Convert",
    description: "Produce a different format (PDF to Word, image to PDF, etc).",
  },
}


// Walks the ops list and returns { edit: [...], convert: [...] }.
// Ops with unknown intent default to "edit".
function groupByIntent(ops) {
  const buckets = { edit: [], convert: [] }
  for (const op of ops) {
    const intent = op.intent === "convert" ? "convert" : "edit"
    buckets[intent].push(op)
  }
  return buckets
}


function formatTarget(target) {
  if (target === "jpg" || target === "jpeg") return "JPEG"
  if (target === "png") return "PNG"
  if (target === "webp") return "WebP"
  if (target === "gif") return "GIF"
  if (target === "pdf") return "PDF"
  if (target === "docx") return "Word (.docx)"
  if (target === "txt") return "Text (.txt)"
  if (target === "csv") return "CSV"
  return String(target || "").toUpperCase()
}


function sameImageType(inputType, target) {
  const input = inputType === "jpeg" ? "jpg" : inputType
  const output = target === "jpeg" ? "jpg" : target
  return input === output
}


function buildChoices(actions, inputType) {
  const choices = []
  for (const op of actions) {
    if (op.operation === "image_convert") {
      const targets = Array.isArray(op.targets) ? op.targets : []
      for (const target of targets) {
        if (sameImageType(inputType, target)) continue
        choices.push({
          key: `${op.operation}:${target}`,
          op: {
            ...op,
            target,
            label: `Image to ${formatTarget(target)}`,
            params: { target_format: target },
          },
        })
      }
      continue
    }
    choices.push({ key: op.operation, op })
  }
  return choices
}


export function OperationPicker({ file, onPick, onBack }) {
  const [operations, setOperations] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [chosenIntent, setChosenIntent] = useState(null)
  const firstButtonRef = useRef(null)

  const inputType = file && file.name ? file.name.split(".").pop().toLowerCase() : ""

  useEffect(() => {
    let cancelled = false

    const cached = readCache(inputType)
    if (cached) {
      setOperations(cached)
      setLoading(false)
      setError(null)
      return () => { cancelled = true }
    }

    setLoading(true)
    setError(null)

    api.getOperations(inputType)
      .then((data) => {
        if (cancelled) return
        const ops = (data && data.operations) ? data.operations : []
        setOperations(ops)
        writeCache(inputType, ops)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e.message || "Could not load available actions")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [inputType])

  useEffect(() => {
    if (firstButtonRef.current) firstButtonRef.current.focus()
  }, [chosenIntent, operations])

  const grouped = useMemo(() => groupByIntent(operations || []), [operations])
  const availableIntents = useMemo(() => {
    const list = []
    if (grouped.edit.length > 0) list.push("edit")
    if (grouped.convert.length > 0) list.push("convert")
    return list
  }, [grouped])

  // Auto-pick the only intent if there's no real choice to make.
  useEffect(() => {
    if (operations && availableIntents.length === 1 && chosenIntent === null) {
      setChosenIntent(availableIntents[0])
    }
  }, [operations, availableIntents, chosenIntent])

  // ── Loading / error / empty ────────────────────────────────────────────

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <PickerHeader file={file} onBack={onBack} />
        <div className="space-y-2 mt-6" aria-live="polite" aria-label="Loading options">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[76px] rounded-xl bg-surface-container animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (error && !operations) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <PickerHeader file={file} onBack={onBack} />
        <div className="mt-6 flex items-center gap-3 px-4 py-3 rounded-xl bg-error-container/20 border border-error/20 text-on-error-container">
          <span className="material-symbols-outlined text-error text-[20px]">error</span>
          <span className="text-sm font-medium">{error}</span>
        </div>
      </div>
    )
  }

  const list = operations || []
  if (list.length === 0) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <PickerHeader file={file} onBack={onBack} />
        <div className="mt-6 flex items-start gap-3 px-4 py-4 rounded-xl bg-surface-container-lowest border border-outline-variant/20">
          <span className="material-symbols-outlined text-on-surface-variant text-[22px]">info</span>
          <div>
            <p className="font-semibold text-on-surface">
              No actions available for .{inputType} files yet
            </p>
            <p className="text-sm text-on-surface-variant mt-0.5">
              Try another file, or let us know what you wanted to do with it.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ── Step 1: intent picker ──────────────────────────────────────────────

  if (chosenIntent === null && availableIntents.length > 1) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <PickerHeader file={file} onBack={onBack} />
        <ul className="space-y-2 mt-6" role="list">
          {availableIntents.map((intent, idx) => {
            const meta = INTENT_META[intent]
            const count = grouped[intent].length
            return (
              <li key={intent}>
                <button
                  ref={idx === 0 ? firstButtonRef : null}
                  type="button"
                  onClick={() => setChosenIntent(intent)}
                  className="w-full flex items-center gap-4 p-4 rounded-xl bg-surface-container-lowest border border-outline-variant/40 hover:border-primary/50 hover:shadow-sm active:scale-[0.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary transition-all text-left group"
                >
                  <div className="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-primary text-[24px]">
                      {meta.icon}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-on-surface">{meta.title}</h3>
                    <p className="text-sm text-on-surface-variant mt-0.5">
                      {meta.description}
                    </p>
                    <p className="text-xs text-on-surface-variant mt-1">
                      {count} option{count === 1 ? "" : "s"}
                    </p>
                  </div>
                  <span className="material-symbols-outlined text-on-surface-variant group-hover:text-primary transition-colors">
                    chevron_right
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    )
  }

  // ── Step 2: action picker (filtered by chosen intent) ──────────────────

  const effectiveIntent = chosenIntent || availableIntents[0]
  const actions = grouped[effectiveIntent] || []
  const choices = buildChoices(actions, inputType)

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <PickerHeader file={file} onBack={onBack} />

      {availableIntents.length > 1 ? (
        <button
          type="button"
          onClick={() => setChosenIntent(null)}
          className="mt-4 flex items-center gap-1 text-sm text-on-surface-variant hover:text-primary font-medium no-underline hover:underline"
        >
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          Back
        </button>
      ) : null}

      <ul className="space-y-2 mt-4" role="list">
        {choices.map((choice, idx) => {
          const op = choice.op
          const ui = uiFor(op.operation)
          return (
            <li key={choice.key}>
              <button
                ref={idx === 0 ? firstButtonRef : null}
                type="button"
                onClick={() => onPick(op)}
                className="w-full flex items-center gap-4 p-4 rounded-xl bg-surface-container-lowest border border-outline-variant/40 hover:border-primary/50 hover:shadow-sm active:scale-[0.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary transition-all text-left group"
              >
                <div className="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-primary text-[24px]">
                    {ui.icon}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-on-surface">{op.label}</h3>
                  <p className="text-sm text-on-surface-variant mt-0.5 line-clamp-2">
                    {ui.description}
                  </p>
                </div>
                <span className="material-symbols-outlined text-on-surface-variant group-hover:text-primary transition-colors">
                  chevron_right
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}


function PickerHeader({ file, onBack }) {
  const name = file && file.name ? file.name : "your file"
  return (
    <div className="text-center">
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-container text-on-surface-variant text-xs font-medium mb-3 max-w-full">
        <span className="material-symbols-outlined text-[14px]">description</span>
        <span className="truncate max-w-[24rem]">{name}</span>
      </div>
      <h1 className="text-2xl md:text-3xl font-bold font-headline text-on-surface">
        What do you want to do?
      </h1>
      <button
        type="button"
        onClick={onBack}
        className="mt-3 text-sm text-on-surface-variant hover:text-primary font-medium no-underline hover:underline"
      >
        Choose another file
      </button>
    </div>
  )
}
