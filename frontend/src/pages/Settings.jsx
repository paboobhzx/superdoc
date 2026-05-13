import { useEffect, useState } from 'react'
import { useTheme } from '../context/ThemeContext'
import { useI18n } from '../context/I18nContext'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { LocaleSelector } from '../components/LocaleSelector'

export function Settings() {
  const { theme, setTheme, themes } = useTheme()
  const { t } = useI18n()
  const auth = useAuth()
  const [name, setName] = useState('')
  const [country, setCountry] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [emailNotif, setEmailNotif] = useState(true)
  const [quotaNotif, setQuotaNotif] = useState(true)
  const [savingNotif, setSavingNotif] = useState(false)

  // Seed all settings on first load
  useEffect(() => {
    if (!auth?.settings) return
    const s = auth.settings
    if (s.theme) setTheme(s.theme)
    if (s.name !== undefined) setName(s.name)
    if (s.country !== undefined) setCountry(s.country)
    if (s.notifications) {
      setEmailNotif(s.notifications.email_ready ?? true)
      setQuotaNotif(s.notifications.quota_alerts ?? true)
    }
  }, [auth?.settings]) // eslint-disable-line react-hooks/exhaustive-deps

  async function saveProfile() {
    if (!auth?.isAuthenticated) return
    setSavingProfile(true)
    try {
      await api.updateUserSettings({ name, country })
      auth.setSettings((prev) => ({ ...prev, name, country }))
    } catch { /* toast handled */ } finally {
      setSavingProfile(false)
    }
  }

  async function handleThemeChange(e) {
    const next = e.target.value
    setTheme(next)
    if (auth?.isAuthenticated) {
      try { await api.updateUserSettings({ theme: next }) } catch { /* toast handled */ }
    }
  }

  async function saveNotifications() {
    if (!auth?.isAuthenticated) return
    setSavingNotif(true)
    try {
      await api.updateUserSettings({ notifications: { email_ready: emailNotif, quota_alerts: quotaNotif } })
      auth.setSettings((prev) => ({ ...prev, notifications: { email_ready: emailNotif, quota_alerts: quotaNotif } }))
    } catch { /* toast handled */ } finally {
      setSavingNotif(false)
    }
  }

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
            {(name || auth?.user?.email || 'SD').split('@')[0].slice(0, 2).toUpperCase()}
            <button type="button" className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-primary text-on-primary flex items-center justify-center">
              <span className="material-symbols-outlined text-[14px]">photo_camera</span>
            </button>
          </div>
        </div>
        <div className="space-y-4">
          <input type="text" placeholder={t('settings.fullName')} value={name} onChange={(e) => setName(e.target.value)}
            className="sd-input px-4 py-3 text-sm" />
          <select value={country} onChange={(e) => setCountry(e.target.value)} className="sd-input px-4 py-3 text-sm">
            <option value="">{t('settings.country')}</option>
            <option value="US">United States</option>
            <option value="BR">Brazil</option>
            <option value="GB">United Kingdom</option>
            <option value="CA">Canada</option>
            <option value="AU">Australia</option>
            <option value="DE">Germany</option>
            <option value="FR">France</option>
            <option value="ES">Spain</option>
            <option value="IT">Italy</option>
            <option value="PT">Portugal</option>
            <option value="MX">Mexico</option>
            <option value="AR">Argentina</option>
            <option value="CL">Chile</option>
            <option value="CO">Colombia</option>
            <option value="NL">Netherlands</option>
            <option value="SE">Sweden</option>
            <option value="NO">Norway</option>
            <option value="DK">Denmark</option>
            <option value="FI">Finland</option>
            <option value="PL">Poland</option>
            <option value="JP">Japan</option>
            <option value="KR">South Korea</option>
            <option value="CN">China</option>
            <option value="IN">India</option>
            <option value="SG">Singapore</option>
            <option value="NZ">New Zealand</option>
            <option value="ZA">South Africa</option>
            <option value="NG">Nigeria</option>
            <option value="EG">Egypt</option>
            <option value="TR">Turkey</option>
            <option value="RU">Russia</option>
            <option value="UA">Ukraine</option>
            <option value="CH">Switzerland</option>
            <option value="AT">Austria</option>
            <option value="BE">Belgium</option>
            <option value="IE">Ireland</option>
            <option value="CZ">Czech Republic</option>
            <option value="HU">Hungary</option>
            <option value="RO">Romania</option>
            <option value="IL">Israel</option>
            <option value="AE">United Arab Emirates</option>
            <option value="SA">Saudi Arabia</option>
            <option value="PH">Philippines</option>
            <option value="ID">Indonesia</option>
            <option value="MY">Malaysia</option>
            <option value="TH">Thailand</option>
            <option value="VN">Vietnam</option>
            <option value="PK">Pakistan</option>
            <option value="BD">Bangladesh</option>
            <option value="PE">Peru</option>
            <option value="VE">Venezuela</option>
          </select>
          <input
            type="email"
            value={auth?.user?.email || ''}
            readOnly
            disabled
            className="sd-input px-4 py-3 text-sm opacity-60 cursor-not-allowed"
          />
          <button
            type="button"
            onClick={saveProfile}
            disabled={savingProfile || !auth?.isAuthenticated}
            className="sd-button-primary px-5 py-2.5 text-sm disabled:opacity-60"
          >
            {savingProfile ? t('common.saving') : t('settings.saveChanges')}
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
        {auth?.isAuthenticated && (
          <button
            onClick={saveNotifications}
            disabled={savingNotif}
            className="mt-4 sd-button-primary px-5 py-2.5 text-sm disabled:opacity-60"
          >
            {savingNotif ? t('common.saving') : t('settings.saveChanges')}
          </button>
        )}
      </section>

      {/* Appearance */}
      <section className="sd-panel p-6 mb-6">
        <h2 className="font-bold text-on-surface mb-4 flex items-center gap-2">
          <span className="material-symbols-outlined text-[20px]">contrast</span>
          {t('settings.appearance')}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-outline">{t('settings.theme')}</span>
            <select value={theme} onChange={handleThemeChange} className="sd-input px-4 py-3 text-sm">
              {themes.map((item) => (
                <option key={item.id} value={item.id}>{t(`theme.${item.id}`)}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-outline">{t('settings.language')}</span>
            <LocaleSelector className="flex" />
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
