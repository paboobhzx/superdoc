import { useState } from 'react'
import { useTheme } from '../context/ThemeContext'

export function Settings() {
  const { theme, setTheme } = useTheme()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [emailNotif, setEmailNotif] = useState(true)
  const [quotaNotif, setQuotaNotif] = useState(true)

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 md:py-10">
      <div className="mb-8">
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-primary">Account</p>
        <h1 className="text-3xl font-bold font-headline text-on-surface">Settings</h1>
      </div>

      {/* Profile */}
      <section className="sd-panel p-6 mb-6">
        <h2 className="font-bold text-on-surface mb-4 flex items-center gap-2">
          <span className="material-symbols-outlined text-[20px]">person</span>
          Profile
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
          <input type="text" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)}
            className="sd-input px-4 py-3 text-sm" />
          <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)}
            className="sd-input px-4 py-3 text-sm" />
          <button className="sd-button-primary px-5 py-2.5 text-sm">
            Save Changes
          </button>
        </div>
      </section>

      {/* Security */}
      <section className="sd-panel p-6 mb-6">
        <h2 className="font-bold text-on-surface mb-4 flex items-center gap-2">
          <span className="material-symbols-outlined text-[20px]">lock</span>
          Security
        </h2>
        <div className="space-y-4">
          <input type="password" placeholder="Current password" className="sd-input px-4 py-3 text-sm" />
          <input type="password" placeholder="New password" className="sd-input px-4 py-3 text-sm" />
          <input type="password" placeholder="Confirm new password" className="sd-input px-4 py-3 text-sm" />
          <button className="sd-button-secondary px-5 py-2.5 text-sm">
            Update Password
          </button>
        </div>
      </section>

      {/* Notifications */}
      <section className="sd-panel p-6 mb-6">
        <h2 className="font-bold text-on-surface mb-4 flex items-center gap-2">
          <span className="material-symbols-outlined text-[20px]">notifications</span>
          Notifications
        </h2>
        <div className="space-y-4">
          {[{ label: 'Email when file is ready', value: emailNotif, set: setEmailNotif },
            { label: 'Quota alerts', value: quotaNotif, set: setQuotaNotif }].map(({ label, value, set }) => (
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
          Appearance
        </h2>
        <button
          type="button"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="sd-button-secondary min-h-11 px-5 text-sm"
        >
          <span className="material-symbols-outlined text-[18px]">{theme === 'dark' ? 'light_mode' : 'dark_mode'}</span>
          {theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
        </button>
      </section>

      {/* Danger Zone */}
      <section className="rounded-[var(--radius-xl)] bg-error-container border border-error/10 p-6">
        <h2 className="font-bold text-on-surface mb-2 flex items-center gap-2">
          <span className="material-symbols-outlined text-error text-[20px]">warning</span>
          Danger Zone
        </h2>
        <p className="text-sm text-on-surface-variant mb-4">Once deleted, your account cannot be recovered.</p>
        <button className="px-5 py-2.5 rounded-[var(--radius-md)] bg-error text-on-error font-semibold text-sm hover:opacity-90 transition-opacity">
          Delete Account
        </button>
      </section>
    </div>
  )
}
