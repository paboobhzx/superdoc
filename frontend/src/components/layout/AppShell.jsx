import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTheme } from '../../context/ThemeContext'
import { useI18n } from '../../context/I18nContext'
import { useAuth } from '../../context/AuthContext'

function LogoMark({ small = false }) {
  const size = small ? 22 : 30
  return (
    <span
      className="inline-flex items-center justify-center shrink-0"
      style={{
        width: size,
        height: size,
        borderRadius: small ? 5 : 8,
        background: 'var(--amber)',
      }}
      aria-hidden="true"
    >
      <svg width={small ? 11 : 16} height={small ? 11 : 16} viewBox="0 0 16 16" fill="none">
        <path d="M3 2h7l3 3v9H3V2z" fill="#0c0c0e" />
        <path d="M10 2v3h3" stroke="#0c0c0e" strokeWidth="1.2" />
        {!small && (
          <path d="M6 8l2 2 4-4" stroke="#f5f0e8" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
    </span>
  )
}

function ThemeToggle() {
  const { theme, setTheme, themes } = useTheme()
  const { t } = useI18n()
  const idx = themes.findIndex((th) => th.id === theme)
  const next = themes[(idx + 1) % themes.length]
  return (
    <button
      type="button"
      onClick={() => setTheme(next.id)}
      className="inline-flex h-9 w-9 items-center justify-center rounded-[8px] border border-outline-variant bg-surface-container-lowest text-on-surface-variant transition-colors hover:border-primary/60 hover:text-primary"
      aria-label={t('theme.switchTo', { theme: next.label })}
      title={t('theme.switchTo', { theme: next.label })}
    >
      <span className="material-symbols-outlined text-[18px]">palette</span>
    </button>
  )
}

function AvatarMenu({ initials, email, t, signOut }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-[8px] border border-outline-variant bg-surface-container-lowest text-on-surface-variant text-xs font-bold transition-colors hover:border-primary/60 hover:text-primary"
        title={email || ''}
        aria-label={t('shell.nav.account')}
        aria-expanded={open}
      >
        {initials}
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-50 min-w-[160px] rounded-[10px] border border-outline-variant/30 bg-surface-container-lowest shadow-lg py-1">
          <div className="px-3 py-2 border-b border-outline-variant/10 mb-1">
            <p className="text-xs text-on-surface-variant truncate max-w-[140px]">{email}</p>
          </div>
          <Link
            to="/settings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-on-surface no-underline hover:bg-surface-container transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">person</span>
            {t('shell.nav.profile')}
          </Link>
          <button
            type="button"
            onClick={() => { setOpen(false); signOut() }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-on-surface hover:bg-surface-container transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">logout</span>
            {t('dashboard.signOut')}
          </button>
        </div>
      )}
    </div>
  )
}

export default function AppShell({ children }) {
  const { pathname } = useLocation()
  const { t } = useI18n()
  const { isAuthenticated, authChecked, user, settings, signOut } = useAuth()
  const isHome = pathname === '/'

  const displayName = settings?.name || user?.email || ''
  const initials = displayName
    ? displayName.split('@')[0].slice(0, 2).toUpperCase()
    : 'SD'
  const sectionHref = (hash) => isHome ? hash : `/${hash}`

  return (
    <div className="min-h-screen bg-background text-on-surface">
      <header className="sticky top-0 z-50 h-[60px] border-b border-outline-variant bg-background/95 backdrop-blur-xl">
        <div className="mx-auto flex h-full max-w-6xl items-center justify-between gap-4 px-4 md:px-6">
          <Link to="/" className="flex items-center gap-2.5 no-underline" aria-label={t('common.appHome')}>
            <LogoMark />
            <span className="font-headline text-[17px] font-bold text-on-surface">
              SuperDoc
            </span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label={t('common.primaryNavigation')}>
            <a className="rounded-[8px] px-3 py-1.5 text-sm text-on-surface-variant no-underline transition-colors hover:bg-surface-container-lowest hover:text-on-surface" href={sectionHref('#formats')}>
              {t('shell.nav.formats')}
            </a>
            <a className="rounded-[8px] px-3 py-1.5 text-sm text-on-surface-variant no-underline transition-colors hover:bg-surface-container-lowest hover:text-on-surface" href={sectionHref('#how')}>
              {t('shell.nav.how')}
            </a>
            <a className="rounded-[8px] px-3 py-1.5 text-sm text-on-surface-variant no-underline transition-colors hover:bg-surface-container-lowest hover:text-on-surface" href={sectionHref('#faq')}>
              {t('shell.nav.faq')}
            </a>
            <Link className="rounded-[8px] px-3 py-1.5 text-sm text-on-surface-variant no-underline transition-colors hover:bg-surface-container-lowest hover:text-on-surface" to="/dashboard">
              {t('shell.nav.files')}
            </Link>
            <Link
              className="rounded-[8px] px-3 py-1.5 text-xs text-on-surface-variant no-underline transition-colors hover:bg-surface-container-lowest hover:text-on-surface"
              to="/support"
            >
              <span className="inline-flex items-center gap-1">
                <span className="material-symbols-outlined text-[15px]">favorite</span>
                {t('shell.nav.support')}
              </span>
            </Link>
          </nav>

          <div className="flex items-center gap-2">
            {authChecked && !isAuthenticated && (
              <>
                <Link
                  to="/auth/login"
                  className="hidden md:inline-flex rounded-[8px] px-3 py-1.5 text-sm text-on-surface-variant no-underline transition-colors hover:bg-surface-container-lowest hover:text-on-surface"
                >
                  {t('auth.signIn')}
                </Link>
                <Link
                  to="/auth/register"
                  className="hidden md:inline-flex rounded-[8px] border border-primary/50 bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary no-underline transition-colors hover:bg-primary/20"
                >
                  {t('auth.createFreeAccount')}
                </Link>
              </>
            )}
            {authChecked && isAuthenticated && (
              <AvatarMenu
                initials={initials}
                email={user?.email || ''}
                t={t}
                signOut={signOut}
              />
            )}
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main>{children}</main>
    </div>
  )
}
