import { createContext, useContext, useEffect, useState } from 'react'

const THEMES = [
  { id: 'azure',  color: '#0b70d8', label: 'Azure Blue'  },
  { id: 'orange', color: '#ea580c', label: 'Warm Orange'  },
  { id: 'gray',   color: '#6b7280', label: 'Slate Gray'   },
  { id: 'brown',  color: '#92400e', label: 'Warm Brown'   },
  { id: 'dark',   color: '#0c0c0e', label: 'Dark'         },
]
const VALID_THEME_IDS = new Set(THEMES.map((t) => t.id))

const ThemeContext = createContext(null)

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(
    () => {
      const saved = localStorage.getItem('superdoc-theme')
      if (saved === 'light') return 'azure'
      return VALID_THEME_IDS.has(saved) ? saved : 'azure'
    }
  )

  useEffect(() => {
    const root = document.documentElement
    const nextTheme = theme === 'light' ? 'azure' : theme
    root.classList.remove('theme-dark', 'theme-azure', 'theme-orange', 'theme-gray', 'theme-brown', 'dark')
    root.removeAttribute('data-theme')
    root.classList.add(`theme-${nextTheme}`)
    root.setAttribute('data-theme', nextTheme)
    if (nextTheme === 'dark') root.classList.add('dark')
    const metaTheme = document.querySelector('meta[name="theme-color"]')
    if (metaTheme) {
      metaTheme.setAttribute('content', nextTheme === 'dark' ? '#0c0c0e' : '#0b70d8')
    }
    if (nextTheme !== theme) setTheme(nextTheme)
    localStorage.setItem('superdoc-theme', nextTheme)
  }, [theme])

  return (
    <ThemeContext.Provider value={{ theme, setTheme, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)
