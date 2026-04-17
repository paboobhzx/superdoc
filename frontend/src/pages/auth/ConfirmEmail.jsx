import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

export function ConfirmEmail() {
  const navigate = useNavigate()
  const auth = useAuth()
  const [code, setCode] = useState(['', '', '', '', '', ''])
  const [countdown, setCountdown] = useState(60)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const refs = useRef([])

  const email = auth?.email || ''
  const fullCode = useMemo(() => code.join(''), [code])

  useEffect(() => {
    if (countdown <= 0) return
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  const handleChange = (i, val) => {
    if (val.length > 1) return
    const next = [...code]
    next[i] = val
    setCode(next)
    if (val && i < 5) refs.current[i + 1]?.focus()
  }

  const handleKeyDown = (i, e) => {
    if (e.key === 'Backspace' && !code[i] && i > 0) refs.current[i - 1]?.focus()
  }

  async function onConfirm() {
    setErr('')
    if (fullCode.length !== 6) {
      setErr('Enter the 6-digit code.')
      return
    }
    setLoading(true)
    try {
      await auth.confirmEmail(fullCode)
      navigate('/auth/login')
    } catch (e) {
      setErr(e?.message || 'Confirmation failed')
    } finally {
      setLoading(false)
    }
  }

  async function onResend() {
    if (countdown > 0) return
    setErr('')
    setLoading(true)
    try {
      await auth.resendConfirmation()
      setCountdown(60)
    } catch (e) {
      setErr(e?.message || 'Failed to resend code')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-[400px] bg-surface-container-lowest rounded-[14px] shadow-lg border border-outline-variant/10 p-8 text-center">
        <span className="material-symbols-outlined text-primary text-[48px] animate-bounce mb-4 inline-block"
          style={{ fontVariationSettings: "'FILL' 1" }}>
          mail
        </span>
        <h1 className="text-2xl font-bold text-on-surface mb-2">Check your email</h1>
        <p className="text-sm text-on-surface-variant mb-8">
          We sent a code to <strong className="text-on-surface">{email || 'your email'}</strong>
        </p>

        <div className="flex justify-center gap-2 mb-6">
          {code.map((digit, i) => (
            <input
              key={i}
              ref={(el) => (refs.current[i] = el)}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={(e) => handleChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              className="w-12 h-14 text-center text-xl font-mono font-bold rounded-xl bg-surface-container border border-outline-variant/20 text-on-surface focus:outline-2 focus:outline-primary focus:-outline-offset-1"
            />
          ))}
        </div>

        <button
          onClick={onConfirm}
          disabled={loading}
          className="w-full px-5 py-3 rounded-xl bg-primary text-on-primary font-bold text-sm hover:opacity-90 transition-opacity mb-3 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading ? 'Confirming…' : 'Confirm'}
        </button>

        <button
          onClick={onResend}
          disabled={loading || countdown > 0}
          className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl border border-outline-variant/20 text-on-surface-variant font-semibold text-sm hover:bg-surface-container transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <span className="material-symbols-outlined text-[16px]">refresh</span>
          {countdown > 0 ? `Resend code (${countdown}s)` : 'Resend code'}
        </button>

        {err && (
          <div className="mt-4 flex items-center gap-3 px-4 py-3 rounded-xl bg-error-container/20 border border-error/20 text-on-error-container">
            <span className="material-symbols-outlined text-error text-[20px]">warning</span>
            <span className="text-sm font-medium">{err}</span>
          </div>
        )}

        <Link to="/auth/login" className="mt-4 inline-flex items-center gap-1 text-xs text-on-surface-variant hover:text-on-surface no-underline">
          <span className="material-symbols-outlined text-[14px]">arrow_back</span>
          Wrong email? Go back
        </Link>
      </div>
    </div>
  )
}
