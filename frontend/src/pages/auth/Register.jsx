import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

export function Register() {
  const navigate = useNavigate()
  const auth = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const strength = [password.length >= 8, /[A-Z]/.test(password), /[0-9]/.test(password), /[^A-Za-z0-9]/.test(password)]
  const filled = strength.filter(Boolean).length

  async function onSubmit() {
    setErr('')
    if (!email || !password) {
      setErr('Email and password are required.')
      return
    }
    if (password !== confirm) {
      setErr('Passwords do not match.')
      return
    }
    setLoading(true)
    try {
      await auth.signUp(email, password)
      navigate('/auth/confirm')
    } catch (e) {
      setErr(e?.message || 'Sign up failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">
      <div className="fixed w-[500px] h-[500px] rounded-full bg-primary/10 blur-3xl -top-40 -right-40" />
      <div className="fixed w-[400px] h-[400px] rounded-full bg-secondary-container/20 blur-3xl -bottom-32 -left-32" />

      <div className="relative w-full max-w-[400px] bg-surface-container-lowest rounded-[14px] shadow-lg border border-outline-variant/10 p-8">
        <div className="flex items-center gap-2 mb-2">
          <span className="material-symbols-outlined text-primary text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>bolt</span>
          <span className="text-xl font-extrabold text-primary font-headline">SuperDoc</span>
        </div>

        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-secondary-container/30 text-on-secondary-container text-[10px] font-semibold mb-6">
          Free forever · No credit card · No spam
        </div>

        <div className="space-y-4">
          <div className="relative">
            <input type="email" placeholder=" " value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-surface-container border border-outline-variant/20 text-on-surface text-sm focus:outline-2 focus:outline-primary focus:-outline-offset-1 peer" />
            <label className="absolute left-4 top-3 text-sm text-on-surface-variant transition-all pointer-events-none origin-left peer-focus:translate-y-[-1.5rem] peer-focus:scale-[0.85] peer-focus:text-primary peer-[:not(:placeholder-shown)]:translate-y-[-1.5rem] peer-[:not(:placeholder-shown)]:scale-[0.85]">
              Email
            </label>
          </div>

          <div>
            <div className="relative">
              <input type={showPw ? 'text' : 'password'} placeholder=" " value={password} onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 pr-12 rounded-xl bg-surface-container border border-outline-variant/20 text-on-surface text-sm focus:outline-2 focus:outline-primary focus:-outline-offset-1 peer" />
              <label className="absolute left-4 top-3 text-sm text-on-surface-variant transition-all pointer-events-none origin-left peer-focus:translate-y-[-1.5rem] peer-focus:scale-[0.85] peer-focus:text-primary peer-[:not(:placeholder-shown)]:translate-y-[-1.5rem] peer-[:not(:placeholder-shown)]:scale-[0.85]">
                Password
              </label>
              <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-3 text-on-surface-variant hover:text-on-surface">
                <span className="material-symbols-outlined text-[20px]">{showPw ? 'visibility_off' : 'visibility'}</span>
              </button>
            </div>
            {password && (
              <div className="flex gap-1 mt-2">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className={`flex-1 h-1 rounded-full ${i < filled ? 'bg-primary' : 'bg-outline-variant/20'}`} />
                ))}
              </div>
            )}
          </div>

          <div className="relative">
            <input type="password" placeholder=" " value={confirm} onChange={(e) => setConfirm(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-surface-container border border-outline-variant/20 text-on-surface text-sm focus:outline-2 focus:outline-primary focus:-outline-offset-1 peer" />
            <label className="absolute left-4 top-3 text-sm text-on-surface-variant transition-all pointer-events-none origin-left peer-focus:translate-y-[-1.5rem] peer-focus:scale-[0.85] peer-focus:text-primary peer-[:not(:placeholder-shown)]:translate-y-[-1.5rem] peer-[:not(:placeholder-shown)]:scale-[0.85]">
              Confirm password
            </label>
          </div>

          <button
            onClick={onSubmit}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-primary text-on-primary font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? 'Creating…' : 'Create account'}
          </button>
        </div>

        {err && (
          <div className="mt-4 flex items-center gap-3 px-4 py-3 rounded-xl bg-error-container/20 border border-error/20 text-on-error-container">
            <span className="material-symbols-outlined text-error text-[20px]">warning</span>
            <span className="text-sm font-medium">{err}</span>
          </div>
        )}

        <p className="mt-6 text-center text-xs text-on-surface-variant">
          Already have an account? <Link to="/auth/login" className="text-primary font-semibold no-underline hover:underline">Sign in</Link>
        </p>

        <p className="mt-4 text-[10px] text-center text-outline">
          By creating an account you agree to our Terms of Service and Privacy Policy.
        </p>
      </div>
    </div>
  )
}
