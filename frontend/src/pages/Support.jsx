import { useEffect, useMemo, useState } from "react"
import { Link, useLocation } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import { useI18n } from "../context/I18nContext"
import { api } from "../lib/api"

const FIXED_TIERS = [
  { cents: 200,  label: "Starter",    display: "$2" },
  { cents: 500,  label: "Supporter",  display: "$5" },
  { cents: 1000, label: "Champion",   display: "$10" },
  { cents: 5000, label: null,         display: "$50", huge: true },
]

function formatWhen(ts, locale) {
  if (!ts) return ""
  const date = new Date(Number(ts) * 1000)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleString(locale)
}

export function Support() {
  const auth = useAuth()
  const { t, locale } = useI18n()
  const { search } = useLocation()
  const [loading, setLoading] = useState(false)
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const [credits, setCredits] = useState(null)
  const [err, setErr] = useState("")
  const [selectedCents, setSelectedCents] = useState(500)
  const [customStr, setCustomStr] = useState("")
  const params = useMemo(() => new URLSearchParams(search), [search])
  const checkoutState = params.get("checkout")

  useEffect(() => {
    if (!auth?.isAuthenticated) {
      setCredits(null)
      return
    }

    let active = true
    setLoading(true)
    setErr("")
    api.getUserCredits()
      .then((data) => { if (active) setCredits(data) })
      .catch((e) => { if (active) setErr(e.message || t("support.loadFailed")) })
      .finally(() => { if (active) setLoading(false) })

    return () => { active = false }
  }, [auth?.isAuthenticated, t])

  function resolvedCents() {
    if (selectedCents === "custom") {
      const n = parseFloat(customStr)
      if (!Number.isFinite(n) || n < 1) return null
      return Math.round(n * 100)
    }
    return selectedCents
  }

  async function onBuyCredits() {
    const amountCents = resolvedCents()
    if (!amountCents) return
    setErr("")
    setCheckoutLoading(true)
    try {
      const origin = window.location.origin
      const data = await api.createCreditsCheckout({
        success_url: `${origin}/support?checkout=success`,
        cancel_url: `${origin}/support?checkout=cancelled`,
        amount_cents: amountCents,
      })
      window.location.assign(data.checkout_url)
    } catch (e) {
      setErr(e.message || t("support.checkoutFailed"))
      setCheckoutLoading(false)
    }
  }

  const recentEvents = credits?.recent_events || []
  const canCheckout = auth?.isAuthenticated && resolvedCents() !== null

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

          <div className="mt-6 rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-5">
            <p className="text-sm font-semibold text-on-surface">{t("support.documentsFreeTitle")}</p>
            <p className="mt-2 text-sm leading-6 text-on-surface-variant">{t("support.documentsFreeBody")}</p>
          </div>

          <div className="mt-4 rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-5">
            <p className="text-sm font-semibold text-on-surface">{t("support.creditsTitle")}</p>
            <p className="mt-2 text-sm leading-6 text-on-surface-variant">{t("support.creditsBody")}</p>
            <p className="mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
              {t("support.packHint")}
            </p>
          </div>

          {/* Tier picker */}
          <div className="mt-6">
            <p className="mb-3 text-sm font-semibold text-on-surface">{t("support.chooseAmount")}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {FIXED_TIERS.map(({ cents, label, display, huge }) => (
                <button
                  key={cents}
                  type="button"
                  onClick={() => setSelectedCents(cents)}
                  className={[
                    "rounded-xl border px-3 py-3 text-left transition-colors",
                    selectedCents === cents
                      ? "border-primary bg-primary/10 text-on-surface"
                      : "border-outline-variant/30 bg-surface-container-lowest text-on-surface-variant hover:border-primary/40 hover:bg-surface-container",
                  ].join(" ")}
                >
                  <span className="block text-lg font-extrabold leading-none text-inherit">
                    {display}
                  </span>
                  <span className="mt-1 block text-xs text-inherit opacity-70">
                    {huge ? t("support.tierHugeDonation") : label}
                  </span>
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setSelectedCents("custom")}
              className={[
                "mt-2 w-full rounded-xl border px-3 py-3 text-left transition-colors",
                selectedCents === "custom"
                  ? "border-primary bg-primary/10 text-on-surface"
                  : "border-outline-variant/30 bg-surface-container-lowest text-on-surface-variant hover:border-primary/40 hover:bg-surface-container",
              ].join(" ")}
            >
              <span className="text-sm font-semibold">{t("support.tierCustom")}</span>
            </button>

            {selectedCents === "custom" && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-sm text-on-surface-variant">$</span>
                <input
                  type="number"
                  min="1"
                  max="1000"
                  step="1"
                  placeholder={t("support.tierCustomPlaceholder")}
                  value={customStr}
                  onChange={(e) => setCustomStr(e.target.value)}
                  className="sd-input flex-1 px-3 py-2 text-sm"
                />
              </div>
            )}
          </div>

          {checkoutState === "success" ? (
            <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700">
              {t("support.checkoutSuccess")}
            </div>
          ) : null}

          {checkoutState === "cancelled" ? (
            <div className="mt-4 rounded-xl border border-outline-variant/20 bg-surface-container px-4 py-3 text-sm text-on-surface-variant">
              {t("support.checkoutCancelled")}
            </div>
          ) : null}

          {err ? (
            <div className="mt-4 rounded-xl border border-error/20 bg-error-container/20 px-4 py-3 text-sm text-on-error-container">
              {err}
            </div>
          ) : null}

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            {auth?.isAuthenticated ? (
              <button
                type="button"
                onClick={onBuyCredits}
                disabled={checkoutLoading || !canCheckout}
                className="sd-button-primary px-5 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              >
                {checkoutLoading ? t("support.redirecting") : t("support.primaryCta")}
              </button>
            ) : (
              <Link to="/auth/login" className="sd-button-primary px-5 py-3 text-sm no-underline">
                {t("support.signInCta")}
              </Link>
            )}
          </div>
        </div>

        <div className="grid gap-4 self-start">
          <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-5">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">{t("support.balanceEyebrow")}</p>
            {!auth?.isAuthenticated ? (
              <>
                <h2 className="mt-2 text-lg font-bold text-on-surface">{t("support.signInTitle")}</h2>
                <p className="mt-2 text-sm leading-6 text-on-surface-variant">{t("support.signInBody")}</p>
              </>
            ) : (
              <>
                <div className="mt-2 flex items-end gap-2">
                  <span className="text-4xl font-extrabold text-on-surface">{loading ? "..." : credits?.balance ?? 0}</span>
                  <span className="pb-1 text-sm text-on-surface-variant">{t("support.creditsUnit")}</span>
                </div>
                <p className="mt-3 text-sm text-on-surface-variant">
                  {t("support.freeMultimediaRemaining", {
                    count: loading ? 0 : credits?.free_multimedia_remaining_today ?? 0,
                  })}
                </p>
              </>
            )}
          </div>

          <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-5">
            <h2 className="text-lg font-bold text-on-surface">{t("support.recentActivity")}</h2>
            {!auth?.isAuthenticated ? (
              <p className="mt-2 text-sm leading-6 text-on-surface-variant">{t("support.signInActivity")}</p>
            ) : recentEvents.length === 0 ? (
              <p className="mt-2 text-sm leading-6 text-on-surface-variant">{t("support.noActivity")}</p>
            ) : (
              <ul className="mt-3 divide-y divide-outline-variant/10">
                {recentEvents.map((event) => (
                  <li key={event.event_id} className="py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold text-on-surface">{t("support.purchaseEvent")}</span>
                      <span className="text-sm font-bold text-primary">+{event.credits_delta}</span>
                    </div>
                    <div className="mt-1 text-xs text-on-surface-variant">{formatWhen(event.created_at, locale)}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-5">
            <h2 className="text-lg font-bold text-on-surface">{t("support.card3Title")}</h2>
            <p className="mt-2 text-sm leading-6 text-on-surface-variant">{t("support.card3Body")}</p>
          </div>
        </div>
      </section>
    </div>
  )
}
