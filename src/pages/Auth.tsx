import { useState } from 'react'
import { useAuth } from '../context/AuthContext'

export default function Auth() {
  const { signUp, signIn, isConfigured } = useAuth()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [signUpSuccess, setSignUpSuccess] = useState(false)

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
              <code className="bg-amber-100 px-1 rounded">VITE_SUPABASE_ANON_KEY</code> to your{' '}
              <code className="bg-amber-100 px-1 rounded">.env</code> file to enable cloud features.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

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

    setLoading(false)
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
          <div className="flex rounded-xl bg-slate-100 p-1 mb-6">
            <button
              onClick={() => { setMode('signin'); setError(null) }}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
                mode === 'signin' ? 'bg-white shadow text-slate-800' : 'text-slate-500'
              }`}
            >
              Sign In
            </button>
            <button
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

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full"
            >
              {loading ? 'Loading...' : mode === 'signin' ? 'Sign In' : 'Create Account'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
