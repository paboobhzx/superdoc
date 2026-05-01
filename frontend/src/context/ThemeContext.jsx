import { createContext, useContext, useEffect, useState } from 'react'

const THEMES = [
  { id: 'dark', color: '#0c0c0e', label: 'Dark' },
  { id: 'light', color: '#f5f3ef', label: 'Light' },
]

const ThemeContext = createContext(null)

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(
    () => {
      const saved = localStorage.getItem('superdoc-theme')
      return saved === 'light' || saved === 'dark' ? saved : 'dark'
    }
  )

  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('theme-dark', 'theme-light', 'dark')
    root.removeAttribute('data-theme')
    root.classList.add(`theme-${theme}`)
    root.setAttribute('data-theme', theme)
    if (theme === 'dark') root.classList.add('dark')
    localStorage.setItem('superdoc-theme', theme)
  }, [theme])

  return (
    <ThemeContext.Provider value={{ theme, setTheme, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)
