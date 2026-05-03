import { Link, useLocation } from 'react-router-dom'
import { useTheme } from '../../context/ThemeContext'
import { useI18n } from '../../context/I18nContext'

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
  const { theme, setTheme } = useTheme()
  const { t } = useI18n()
  const next = theme === 'dark' ? 'azure' : 'dark'
  const nextLabel = t(`theme.${next}`)
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      className="inline-flex h-9 w-9 items-center justify-center rounded-[8px] border border-outline-variant bg-surface-container-lowest text-on-surface-variant transition-colors hover:border-primary/60 hover:text-primary"
      aria-label={t('theme.switchTo', { theme: nextLabel })}
      title={t('theme.switchTo', { theme: nextLabel })}
    >
      <span className="material-symbols-outlined text-[18px]">
        {theme === 'dark' ? 'light_mode' : 'dark_mode'}
      </span>
    </button>
  )
}

export default function AppShell({ children }) {
  const { pathname } = useLocation()
  const { t } = useI18n()
  const isHome = pathname === '/'
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
          </nav>

          <div className="flex items-center gap-2">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main>{children}</main>
    </div>
  )
}
