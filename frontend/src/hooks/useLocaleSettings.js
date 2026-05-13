import { useEffect } from "react"
import { useAuth } from "../context/AuthContext"
import { useI18n } from "../context/I18nContext"
import { api } from "../lib/api"

export function useLocaleSettings() {
  const auth = useAuth()
  const { locale, setLocale, locales, t } = useI18n()

  useEffect(() => {
    const savedLocale = auth?.settings?.locale
    if (savedLocale && savedLocale !== locale) {
      setLocale(savedLocale)
    }
  }, [auth?.settings?.locale, locale, setLocale])

  async function changeLocale(nextLocale) {
    setLocale(nextLocale)
    if (!auth?.isAuthenticated) return
    try {
      await api.updateUserSettings({ locale: nextLocale })
      auth.setSettings((prev) => ({ ...(prev || {}), locale: nextLocale }))
    } catch {
      // toast handled by api layer
    }
  }

  return {
    locale,
    locales,
    changeLocale,
    label: t("shell.localeLabel"),
  }
}
