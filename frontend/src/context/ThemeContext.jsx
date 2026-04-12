import { createContext, useContext, useEffect, useState } from 'react'

const THEMES = [
  { id: 'azure',  color: '#0078d4', label: 'Azure'  },
  { id: 'dark',   color: '#262a31', label: 'Dark'   },
  { id: 'orange', color: '#ff9159', label: 'Orange' },
  { id: 'galaxy', color: '#9b59b6', label: 'Galaxy' },
  { id: 'brasil', color: '#00752a', label: 'Brasil' },
]

const DARK_THEMES = ['dark', 'orange', 'galaxy']

const ThemeContext = createContext(null)

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(
    () => localStorage.getItem('superdoc-theme') || 'azure'
  )

  useEffect(() => {
    const root = document.documentElement
    THEMES.forEach(t => root.classList.remove(`theme-${t.id}`))
    root.classList.remove('dark')
    root.classList.add(`theme-${theme}`)
    if (DARK_THEMES.includes(theme)) root.classList.add('dark')
    localStorage.setItem('superdoc-theme', theme)
  }, [theme])

  return (
    <ThemeContext.Provider value={{ theme, setTheme, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)
