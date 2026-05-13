import { useLocaleSettings } from "../hooks/useLocaleSettings"

export function LocaleSelector({ compact = false, className = "" }) {
  const { locale, locales, changeLocale, label } = useLocaleSettings()

  return (
    <label className={`inline-flex items-center ${className}`}>
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={locale}
        onChange={(e) => changeLocale(e.target.value)}
        className={compact
          ? "h-9 rounded-[8px] border border-outline-variant bg-surface-container-lowest px-2.5 text-xs font-semibold text-on-surface-variant transition-colors hover:border-primary/60 hover:text-primary"
          : "sd-input px-4 py-3 text-sm"
        }
      >
        {locales.map((item) => (
          <option key={item.id} value={item.id}>{item.label}</option>
        ))}
      </select>
    </label>
  )
}
