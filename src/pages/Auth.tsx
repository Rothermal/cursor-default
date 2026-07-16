import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { getOAuthRedirectUrl, getOAuthReturnError } from '../lib/authRedirect'

interface AuthProps {
  contextTitle?: string
  contextMessage?: string
}

export default function Auth({ contextTitle, contextMessage }: AuthProps = {}) {
  const { signUp, signIn, signInWithGoogle, isConfigured } = useAuth()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loadingAction, setLoadingAction] = useState<'email' | 'google' | null>(null)
  const [signUpSuccess, setSignUpSuccess] = useState(false)
  const loading = loadingAction !== null

  useEffect(() => {
    const oauthError = getOAuthReturnError()
    if (!oauthError) return

    setError(oauthError)
    window.history.replaceState(null, document.title, getOAuthRedirectUrl())
  }, [])

  if (!isConfigured) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="max-w-md w-full text-center">
          <h1 className="text-3xl font-bold text-slate-800 mb-2">📊 StatKeeper</h1>
          <p className="text-slate-500 mb-6">Track game stats in real time</p>
          <div className="card bg-amber-50 border-amber-200 text-amber-800 text-sm">
            <p className="font-semibold mb-1">Supabase not configured</p>
            <p>
              Add <code className="bg-amber-100 px-1 rounded">VITE_SUPABASE_URL</code> and{' '}
              <code className="bg-amber-100 px-1 rounded">VITE_SUPABASE_PUBLISHABLE_KEY</code> to your{' '}
              <code className="bg-amber-100 px-1 rounded">.env</code> file to enable cloud features.
              <span className="block mt-1">
                Legacy <code className="bg-amber-100 px-1 rounded">VITE_SUPABASE_ANON_KEY</code> still works.
              </span>
            </p>
          </div>
        </div>
      </div>
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoadingAction('email')

    if (mode === 'signup') {
      const { error: err } = await signUp(email, password, displayName)
      if (err) {
        setError(err)
      } else {
        setSignUpSuccess(true)
      }
    } else {
      const { error: err } = await signIn(email, password)
      if (err) setError(err)
    }

    setLoadingAction(null)
  }

  const handleGoogleSignIn = async () => {
    setError(null)
    setLoadingAction('google')
    const { error: err } = await signInWithGoogle()
    if (err) {
      setError(err)
      setLoadingAction(null)
    }
  }

  if (signUpSuccess) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="max-w-md w-full text-center">
          <h1 className="text-3xl font-bold text-slate-800 mb-2">📊 StatKeeper</h1>
          <div className="card bg-emerald-50 border-emerald-200 mt-6">
            <p className="text-emerald-800 font-semibold mb-1">Account created!</p>
            <p className="text-emerald-700 text-sm">
              Check your email to confirm your account, then sign in.
            </p>
          </div>
          <button
            onClick={() => { setSignUpSuccess(false); setMode('signin') }}
            className="btn-primary mt-4"
          >
            Back to Sign In
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-slate-800">📊 StatKeeper</h1>
          <p className="text-slate-500 mt-2">Track game stats in real time</p>
        </div>

        <div className="card">
          {contextTitle && (
            <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
              <p className="text-sm font-semibold text-blue-800">{contextTitle}</p>
              {contextMessage && (
                <p className="mt-1 text-xs text-blue-700">{contextMessage}</p>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={() => void handleGoogleSignIn()}
            disabled={loading}
            className="w-full min-h-12 rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-60 flex items-center justify-center gap-3"
          >
            <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            {loadingAction === 'google' ? 'Opening Google...' : 'Continue with Google'}
          </button>

          {error && (
            <div className="mt-4 bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Email fallback
            </span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          <div className="flex rounded-xl bg-slate-100 p-1 mb-6">
            <button
              type="button"
              disabled={loading}
              onClick={() => { setMode('signin'); setError(null) }}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
                mode === 'signin' ? 'bg-white shadow text-slate-800' : 'text-slate-500'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => { setMode('signup'); setError(null) }}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
                mode === 'signup' ? 'bg-white shadow text-slate-800' : 'text-slate-500'
              }`}
            >
              Sign Up
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  Display Name
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  placeholder="Your name"
                  className="input-field"
                  required
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="input-field"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="input-field"
                minLength={6}
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full"
            >
              {loadingAction === 'email' ? 'Loading...' : mode === 'signin' ? 'Sign In' : 'Create Account'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
