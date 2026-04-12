import { Link, useLocation } from 'react-router-dom'
import { useTheme } from '../../context/ThemeContext'

const NAV_ITEMS = [
  { to: '/',           icon: 'home',              label: 'Home'       },
  { to: '/tools',      icon: 'construction',      label: 'Tools'      },
  { to: '/dashboard',  icon: 'folder_open',       label: 'Files'      },
  { to: '/settings',   icon: 'settings',          label: 'Settings'   },
]

const BOTTOM_NAV = [
  { to: '/',           icon: 'home',         label: 'Home'     },
  { to: '/tools',      icon: 'construction', label: 'Tools'    },
  { to: '/dashboard',  icon: 'folder_open',  label: 'Files'    },
  { to: '/settings',   icon: 'settings',     label: 'Settings' },
]

function ThemeSwitcher() {
  const { theme, setTheme, themes } = useTheme()
  return (
    <div className="flex gap-1.5 p-1.5 bg-surface-container rounded-full border border-outline-variant/10">
      {themes.map(({ id, color }) => (
        <button
          key={id}
          onClick={() => setTheme(id)}
          title={id}
          className={`w-4 h-4 rounded-full transition-all ${
            theme === id
              ? 'ring-2 ring-offset-1 ring-outline scale-110'
              : 'opacity-40 hover:opacity-100'
          }`}
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  )
}

function NavItems({ pathname }) {
  return NAV_ITEMS.map(({ to, icon, label }) => {
    const active = pathname === to || (to !== '/' && pathname.startsWith(to))
    return (
      <Link
        key={to}
        to={to}
        className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all ${
          active
            ? 'bg-primary/10 text-primary'
            : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
        }`}
      >
        <span
          className="material-symbols-outlined text-[20px]"
          style={{ fontVariationSettings: active ? "'FILL' 1" : "'FILL' 0" }}
        >
          {icon}
        </span>
        {label}
      </Link>
    )
  })
}

function BottomNavItems({ pathname }) {
  return BOTTOM_NAV.map(({ to, icon, label }) => {
    const active = pathname === to || (to !== '/' && pathname.startsWith(to))
    return (
      <Link
        key={to}
        to={to}
        className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl text-[10px] font-semibold transition-all ${
          active ? 'text-primary' : 'text-on-surface-variant'
        }`}
      >
        <span
          className="material-symbols-outlined text-[22px]"
          style={{ fontVariationSettings: active ? "'FILL' 1" : "'FILL' 0" }}
        >
          {icon}
        </span>
        {label}
      </Link>
    )
  })
}

export default function AppShell({ children }) {
  const { pathname } = useLocation()

  return (
    <div className="min-h-screen bg-background text-on-surface">
      <header className="sticky top-0 z-50 bg-surface-container-low/80 backdrop-blur-md border-b border-outline-variant/10 flex items-center justify-between px-6 h-16">
        <Link to="/" className="flex items-center gap-2 no-underline">
          <span
            className="material-symbols-outlined text-primary text-3xl"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            bolt
          </span>
          <span className="text-xl font-extrabold tracking-tight text-primary font-headline">
            SuperDoc
          </span>
        </Link>
        <div className="flex items-center gap-3">
          <ThemeSwitcher />
          <div className="w-8 h-8 rounded-full bg-primary-container flex items-center justify-center text-on-primary-container text-xs font-bold">
            SD
          </div>
        </div>
      </header>

      <div className="flex">
        <aside className="hidden md:flex flex-col w-64 sticky top-16 h-[calc(100vh-4rem)] border-r border-outline-variant/10 bg-surface-container-low/50 p-4 gap-1 overflow-y-auto">
          <NavItems pathname={pathname} />
        </aside>

        <main className="flex-1 pb-24 md:pb-0">
          {children}
        </main>
      </div>

      <nav className="md:hidden fixed bottom-0 left-0 w-full z-50 flex justify-around items-center px-2 pb-6 pt-3 bg-surface-container-lowest/90 backdrop-blur-xl border-t border-outline-variant/10 rounded-t-2xl">
        <BottomNavItems pathname={pathname} />
      </nav>
    </div>
  )
}
