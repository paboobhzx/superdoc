import styles from "./ToolCard.module.css";

export function ToolCard({ icon, title, desc, accent, bgColor, badge, onClick }) {
  return (
    <div
      className={styles.card}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick?.()}
      style={{ "--accent": accent, "--bg": bgColor }}
    >
      <div className={styles.iconWrap}>
        <span className={styles.icon}>{icon}</span>
      </div>

      <div className={styles.content}>
        <div className={styles.titleRow}>
          <span className={styles.title}>{title}</span>
          {badge && <span className={styles.badge}>{badge}</span>}
        </div>
        <p className={styles.desc}>{desc}</p>
      </div>

      <span className={styles.arrow}>→</span>
    </div>
  );
}
