import { useState } from 'react'
import { useTheme } from '../context/ThemeContext'
import { useI18n } from '../context/I18nContext'

export function Settings() {
  const { theme, setTheme, themes } = useTheme()
  const { locale, setLocale, locales, t } = useI18n()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [emailNotif, setEmailNotif] = useState(true)
  const [quotaNotif, setQuotaNotif] = useState(true)

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 md:py-10">
      <div className="mb-8">
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-primary">{t('settings.account')}</p>
        <h1 className="text-3xl font-bold font-headline text-on-surface">{t('settings.title')}</h1>
      </div>

      {/* Profile */}
      <section className="sd-panel p-6 mb-6">
        <h2 className="font-bold text-on-surface mb-4 flex items-center gap-2">
          <span className="material-symbols-outlined text-[20px]">person</span>
          {t('settings.profile')}
        </h2>
        <div className="flex items-center gap-4 mb-6">
          <div className="relative w-16 h-16 rounded-[18px] bg-primary-container flex items-center justify-center text-on-primary-container text-xl font-bold font-headline">
            SD
            <button className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-primary text-on-primary flex items-center justify-center">
              <span className="material-symbols-outlined text-[14px]">photo_camera</span>
            </button>
          </div>
        </div>
        <div className="space-y-4">
          <input type="text" placeholder={t('settings.fullName')} value={name} onChange={(e) => setName(e.target.value)}
            className="sd-input px-4 py-3 text-sm" />
          <input type="email" placeholder={t('settings.email')} value={email} onChange={(e) => setEmail(e.target.value)}
            className="sd-input px-4 py-3 text-sm" />
          <button className="sd-button-primary px-5 py-2.5 text-sm">
            {t('settings.saveChanges')}
          </button>
        </div>
      </section>

      {/* Security */}
      <section className="sd-panel p-6 mb-6">
        <h2 className="font-bold text-on-surface mb-4 flex items-center gap-2">
          <span className="material-symbols-outlined text-[20px]">lock</span>
          {t('settings.security')}
        </h2>
        <div className="space-y-4">
          <input type="password" placeholder={t('settings.currentPassword')} className="sd-input px-4 py-3 text-sm" />
          <input type="password" placeholder={t('settings.newPassword')} className="sd-input px-4 py-3 text-sm" />
          <input type="password" placeholder={t('settings.confirmNewPassword')} className="sd-input px-4 py-3 text-sm" />
          <button className="sd-button-secondary px-5 py-2.5 text-sm">
            {t('settings.updatePassword')}
          </button>
        </div>
      </section>

      {/* Notifications */}
      <section className="sd-panel p-6 mb-6">
        <h2 className="font-bold text-on-surface mb-4 flex items-center gap-2">
          <span className="material-symbols-outlined text-[20px]">notifications</span>
          {t('settings.notifications')}
        </h2>
        <div className="space-y-4">
          {[{ label: t('settings.emailReady'), value: emailNotif, set: setEmailNotif },
            { label: t('settings.quotaAlerts'), value: quotaNotif, set: setQuotaNotif }].map(({ label, value, set }) => (
            <label key={label} className="flex items-center justify-between cursor-pointer">
              <span className="text-sm text-on-surface">{label}</span>
              <button onClick={() => set(!value)}
                className={`w-11 h-6 rounded-full transition-colors relative ${value ? 'bg-primary' : 'bg-outline-variant/30'}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-5' : ''}`} />
              </button>
            </label>
          ))}
        </div>
      </section>

      {/* Theme */}
      <section className="sd-panel p-6 mb-6">
        <h2 className="font-bold text-on-surface mb-4 flex items-center gap-2">
          <span className="material-symbols-outlined text-[20px]">contrast</span>
          {t('settings.appearance')}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-outline">{t('settings.theme')}</span>
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              className="sd-input px-4 py-3 text-sm"
            >
              {themes.map((item) => (
                <option key={item.id} value={item.id}>{t(`theme.${item.id}`)}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-outline">{t('settings.language')}</span>
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
              className="sd-input px-4 py-3 text-sm"
            >
              {locales.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {/* Danger Zone */}
      <section className="rounded-[var(--radius-xl)] bg-error-container border border-error/10 p-6">
        <h2 className="font-bold text-on-surface mb-2 flex items-center gap-2">
          <span className="material-symbols-outlined text-error text-[20px]">warning</span>
          {t('settings.dangerZone')}
        </h2>
        <p className="text-sm text-on-surface-variant mb-4">{t('settings.dangerBody')}</p>
        <button className="px-5 py-2.5 rounded-[var(--radius-md)] bg-error text-on-error font-semibold text-sm hover:opacity-90 transition-opacity">
          {t('settings.deleteAccount')}
        </button>
      </section>
    </div>
  )
}
