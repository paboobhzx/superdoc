import { useTheme } from "../../hooks/useTheme";
import styles from "./NavBar.module.css";

const NAV_LINKS = ["Convert", "PDF Tools", "Images", "Video"];

export function NavBar({ onLogoClick }) {
  const { dark, toggle } = useTheme();

  return (
    <nav className={styles.nav}>
      <div className={styles.inner}>
        <button className={styles.logo} onClick={onLogoClick}>
          ⚡ SuperDoc
        </button>

        <div className={styles.links}>
          {NAV_LINKS.map((item) => (
            <button key={item} className={styles.link}>
              {item}
            </button>
          ))}
        </div>

        <button
          className={styles.themeToggle}
          onClick={toggle}
          aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
        >
          {dark ? "☀️ Light" : "🌙 Dark"}
        </button>
      </div>
    </nav>
  );
}
