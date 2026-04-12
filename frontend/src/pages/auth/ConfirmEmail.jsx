import { useState, useRef } from 'react'
import { Link } from 'react-router-dom'

export function ConfirmEmail() {
  const [code, setCode] = useState(['', '', '', '', '', ''])
  const [countdown, setCountdown] = useState(60)
  const refs = useRef([])

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

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-[400px] bg-surface-container-lowest rounded-[14px] shadow-lg border border-outline-variant/10 p-8 text-center">
        <span className="material-symbols-outlined text-primary text-[48px] animate-bounce mb-4 inline-block"
          style={{ fontVariationSettings: "'FILL' 1" }}>
          mail
        </span>
        <h1 className="text-2xl font-bold text-on-surface mb-2">Check your email</h1>
        <p className="text-sm text-on-surface-variant mb-8">
          We sent a code to <strong className="text-on-surface">your@email.com</strong>
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

        <button className="w-full px-5 py-3 rounded-xl bg-primary text-on-primary font-bold text-sm hover:opacity-90 transition-opacity mb-3">
          Confirm
        </button>

        <button className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl border border-outline-variant/20 text-on-surface-variant font-semibold text-sm hover:bg-surface-container transition-colors">
          <span className="material-symbols-outlined text-[16px]">refresh</span>
          Resend code ({countdown}s)
        </button>

        <Link to="/auth/login" className="mt-4 inline-flex items-center gap-1 text-xs text-on-surface-variant hover:text-on-surface no-underline">
          <span className="material-symbols-outlined text-[14px]">arrow_back</span>
          Wrong email? Go back
        </Link>
      </div>
    </div>
  )
}
