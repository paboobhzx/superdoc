import { Link } from 'react-router-dom'
import { useTheme } from '../../context/ThemeContext'

function ThemeSwitcher() {
  const { theme, setTheme, themes } = useTheme()
  return (
    <div className="flex gap-1.5 p-1.5 bg-surface-container rounded-full border border-outline-variant/40">
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

export default function AppShell({ children }) {
  return (
    <div className="min-h-screen bg-background text-on-surface">
      <header className="sticky top-0 z-50 bg-surface-container-low/90 backdrop-blur-md border-b border-outline-variant/40 flex items-center justify-between px-4 md:px-6 h-16">
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

      <main>{children}</main>
    </div>
  )
}
