import { Link } from "react-router-dom"
import { useI18n } from "../context/I18nContext"

const SUPPORT_ITEMS = ["card1", "card2", "card3"]

export function Support() {
  const { t } = useI18n()

  return (
    <div className="min-h-[calc(100vh-60px)] bg-background">
      <section className="mx-auto grid max-w-6xl gap-10 px-4 py-12 md:grid-cols-[1.05fr_0.95fr] md:px-6 md:py-16">
        <div className="max-w-2xl">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-primary">{t("support.eyebrow")}</p>
          <h1 className="max-w-xl font-headline text-[clamp(2.4rem,6vw,4.6rem)] font-extrabold leading-[1.02] text-on-surface">
            {t("support.title")}
          </h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-on-surface-variant">
            {t("support.intro")}
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a
              href="https://ko-fi.com/superdoc"
              target="_blank"
              rel="noopener noreferrer"
              className="sd-button-primary px-5 py-3 text-sm no-underline"
            >
              {t("support.primaryCta")}
            </a>
            <Link to="/" className="sd-button-secondary px-5 py-3 text-sm no-underline">
              {t("support.secondaryCta")}
            </Link>
          </div>
        </div>

        <div className="grid gap-4 self-start">
          {SUPPORT_ITEMS.map((item) => (
            <div key={item} className="border-b border-outline-variant/40 pb-4 last:border-b-0">
              <h2 className="text-lg font-bold text-on-surface">{t(`support.${item}Title`)}</h2>
              <p className="mt-2 text-sm leading-6 text-on-surface-variant">{t(`support.${item}Body`)}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
