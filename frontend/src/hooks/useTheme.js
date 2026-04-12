import { useState, useEffect } from "react";

export function useTheme() {
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem("superdoc-theme") === "dark";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    try { localStorage.setItem("superdoc-theme", dark ? "dark" : "light"); } catch {}
  }, [dark]);

  return { dark, toggle: () => setDark((d) => !d) };
}
