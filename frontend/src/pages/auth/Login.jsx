import { useState } from 'react'
import { Link } from 'react-router-dom'

export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">
      <div className="fixed w-[500px] h-[500px] rounded-full bg-primary/10 blur-3xl -top-40 -left-40" />
      <div className="fixed w-[400px] h-[400px] rounded-full bg-secondary-container/20 blur-3xl -bottom-32 -right-32" />

      <div className="relative w-full max-w-[400px] bg-surface-container-lowest rounded-[14px] shadow-lg border border-outline-variant/10 p-8">
        <div className="flex items-center gap-2 mb-2">
          <span className="material-symbols-outlined text-primary text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>bolt</span>
          <span className="text-xl font-extrabold text-primary font-headline">SuperDoc</span>
        </div>
        <p className="text-sm text-on-surface-variant mb-8">Convert anything. Free. No tricks.</p>

        <div className="space-y-4">
          <div className="float-label-group relative">
            <input type="email" placeholder=" " value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-surface-container border border-outline-variant/20 text-on-surface text-sm focus:outline-2 focus:outline-primary focus:-outline-offset-1 peer" />
            <label className="absolute left-4 top-3 text-sm text-on-surface-variant transition-all pointer-events-none origin-left peer-focus:translate-y-[-1.5rem] peer-focus:scale-[0.85] peer-focus:text-primary peer-[:not(:placeholder-shown)]:translate-y-[-1.5rem] peer-[:not(:placeholder-shown)]:scale-[0.85]">
              Email
            </label>
          </div>

          <div className="float-label-group relative">
            <input type={showPw ? 'text' : 'password'} placeholder=" " value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 pr-12 rounded-xl bg-surface-container border border-outline-variant/20 text-on-surface text-sm focus:outline-2 focus:outline-primary focus:-outline-offset-1 peer" />
            <label className="absolute left-4 top-3 text-sm text-on-surface-variant transition-all pointer-events-none origin-left peer-focus:translate-y-[-1.5rem] peer-focus:scale-[0.85] peer-focus:text-primary peer-[:not(:placeholder-shown)]:translate-y-[-1.5rem] peer-[:not(:placeholder-shown)]:scale-[0.85]">
              Password
            </label>
            <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-3 text-on-surface-variant hover:text-on-surface">
              <span className="material-symbols-outlined text-[20px]">{showPw ? 'visibility_off' : 'visibility'}</span>
            </button>
          </div>

          <button className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-primary text-on-primary font-bold text-sm hover:opacity-90 transition-opacity">
            Sign in
            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
          </button>
        </div>

        <div className="flex items-center gap-4 my-6">
          <div className="flex-1 h-px bg-outline-variant/20" />
          <span className="text-xs text-on-surface-variant">or</span>
          <div className="flex-1 h-px bg-outline-variant/20" />
        </div>

        <Link to="/" className="block w-full text-center px-5 py-3 rounded-xl border border-outline-variant/20 text-on-surface font-semibold text-sm hover:bg-surface-container transition-colors no-underline">
          Continue without account
        </Link>

        <div className="mt-6 flex justify-between text-xs">
          <Link to="/auth/register" className="text-primary font-semibold no-underline hover:underline">Create free account</Link>
          <button className="text-on-surface-variant hover:text-on-surface">Forgot password?</button>
        </div>
      </div>
    </div>
  )
}
