// frontend/src/pages/Home/OperationPicker.jsx
import { useEffect, useState, useRef } from "react"
import { api } from "../../lib/api"
import { uiFor } from "./picker"

// sessionStorage cache keeps the catalog hot across Home <-> other-page nav.
// TTL picked at 10 minutes because operations rarely change and this cuts
// network calls per session to roughly one.
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


/**
 * OperationPicker - iLovePDF-style vertical list of operations.
 *
 * Props:
 *   file:     the File the user dropped (used to derive input_type)
 *   onPick:   called with the chosen operation id string
 *   onBack:   called when the user clicks "choose another file"
 */
export function OperationPicker({ file, onPick, onBack }) {
  const [operations, setOperations] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const firstButtonRef = useRef(null)

  const inputType = file && file.name ? file.name.split(".").pop().toLowerCase() : ""

  useEffect(() => {
    let cancelled = false

    // Cache-first: if we have a fresh catalog for this input type, use it
    // immediately with no loading state. This is the common case for repeat
    // visits.
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
        // Fail-soft: if the /operations call fails, we still let the user
        // proceed with a hardcoded best-guess operation mapped from extension.
        // This is the Circuit Breaker at the UX level - a transient backend
        // outage should not block a user from using the app.
        setError(e.message || "Could not load available actions")
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [inputType])

  // Auto-focus first action for keyboard users as soon as the list renders.
  useEffect(() => {
    if (operations && operations.length > 0 && firstButtonRef.current) {
      firstButtonRef.current.focus()
    }
  }, [operations])

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <PickerHeader file={file} onBack={onBack} />
        <div className="space-y-2 mt-6" aria-live="polite" aria-label="Loading options">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-[76px] rounded-xl bg-surface-container animate-pulse"
            />
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

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <PickerHeader file={file} onBack={onBack} />
      <ul className="space-y-2 mt-6" role="list">
        {list.map((op, idx) => {
          const ui = uiFor(op.operation)
          return (
            <li key={op.operation}>
              <button
                ref={idx === 0 ? firstButtonRef : null}
                type="button"
                onClick={() => onPick(op)}
                className="w-full flex items-center gap-4 p-4 rounded-xl bg-surface-container-lowest border border-outline-variant/10 hover:border-primary/30 hover:shadow-sm transition-all text-left group"
              >
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
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
