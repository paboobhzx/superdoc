import { createContext, useContext, useMemo, useState } from "react"
import enUS from "../i18n/en-US.json"
import ptBR from "../i18n/pt-BR.json"

export const LOCALES = [
  { id: "en-US", label: "English (US)" },
  { id: "pt-BR", label: "Português (Brasil)" },
]

const STORAGE_KEY = "superdoc-locale"
const messages = {
  "en-US": enUS,
  "pt-BR": ptBR,
}

const I18nContext = createContext(null)

function normalizeLocale(locale) {
  const value = String(locale || "").toLowerCase()
  if (value === "pt-br" || value.startsWith("pt")) return "pt-BR"
  if (value === "en-us" || value.startsWith("en")) return "en-US"
  return ""
}

function resolveInitialLocale() {
  try {
    const saved = normalizeLocale(localStorage.getItem(STORAGE_KEY))
    if (saved) return saved
  } catch {
    // ignore storage failures
  }

  if (typeof navigator !== "undefined") {
    const candidates = [navigator.language, ...(navigator.languages || [])]
    for (const candidate of candidates) {
      const locale = normalizeLocale(candidate)
      if (locale) return locale
    }
  }

  return "en-US"
}

function readPath(source, key) {
  return key.split(".").reduce((node, part) => {
    if (!node || typeof node !== "object") return undefined
    return node[part]
  }, source)
}

function interpolate(value, params) {
  if (typeof value !== "string") return value
  return value.replace(/\{\{(\w+)\}\}/g, (_, name) => {
    const next = params?.[name]
    return next === undefined || next === null ? "" : String(next)
  })
}

export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(resolveInitialLocale)

  function setLocale(nextLocale) {
    const normalized = normalizeLocale(nextLocale) || "en-US"
    setLocaleState(normalized)
    try {
      localStorage.setItem(STORAGE_KEY, normalized)
    } catch {
      // ignore storage failures
    }
  }

  const value = useMemo(() => {
    function t(key, params) {
      const localized = readPath(messages[locale], key)
      const fallback = readPath(messages["en-US"], key)
      const value = localized ?? fallback ?? key
      return interpolate(value, params)
    }

    return { locale, setLocale, locales: LOCALES, t }
  }, [locale])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider")
  return ctx
}
