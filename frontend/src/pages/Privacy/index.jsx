import { useI18n } from "../../context/I18nContext"

export function Privacy() {
  const { t } = useI18n()
  const sections = t("privacy.sections") || []

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 md:py-14">
      <div className="mb-10 max-w-2xl">
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-primary">{t("privacy.eyebrow")}</p>
        <h1 className="font-headline text-3xl font-bold text-on-surface md:text-4xl">{t("privacy.title")}</h1>
        <p className="mt-4 text-sm leading-7 text-on-surface-variant">{t("privacy.intro")}</p>
      </div>

      <div className="space-y-4">
        {sections.map((section) => (
          <section key={section.title} className="rounded-[var(--radius-lg)] border border-outline-variant bg-surface-container-lowest p-5 md:p-6">
            <h2 className="font-headline text-lg font-semibold text-on-surface">{section.title}</h2>
            <p className="mt-2 text-sm leading-7 text-on-surface-variant">{section.body}</p>
          </section>
        ))}
      </div>
    </div>
  )
}
