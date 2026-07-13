import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useAuth } from '../../context/AuthContext'
import {
  formatAuthProviderLabel,
  hasAuthProvider,
  normalizeAccountIdentities,
  type AccountIdentity,
} from '../../lib/accountIdentities'
import {
  linkGoogleIdentity,
  loadCurrentAccountProfile,
  updateCurrentAccountDisplayName,
  validateDisplayName,
  type AccountProfile,
} from '../../lib/accountProfile'
import { supabase } from '../../lib/supabase'

function profileInitial(displayName: string, email: string | null | undefined): string {
  const source = displayName.trim() || email?.trim() || 'S'
  return source.slice(0, 1).toUpperCase()
}

export default function AccountSettings() {
  const { user, isConfigured, signOut } = useAuth()
  const [profile, setProfile] = useState<AccountProfile | null>(null)
  const [displayNameDraft, setDisplayNameDraft] = useState('')
  const [identities, setIdentities] = useState<AccountIdentity[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [linkingGoogle, setLinkingGoogle] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const googleConnected = useMemo(() => hasAuthProvider(identities, 'google'), [identities])
  const displayEmail = profile?.email ?? user?.email ?? null
  const validationError = validateDisplayName(displayNameDraft)
  const savedDisplayName = profile?.displayName ?? ''
  const displayNameChanged = displayNameDraft.trim() !== savedDisplayName.trim()

  const refreshAccount = useCallback(async () => {
    if (!isConfigured || !user || !supabase) return

    setLoading(true)
    setError(null)

    const [profileResult, identitiesResult] = await Promise.all([
      loadCurrentAccountProfile(user),
      supabase.auth.getUserIdentities(),
    ])

    if (profileResult.error) {
      setError(profileResult.error)
    }

    if (profileResult.profile) {
      setProfile(profileResult.profile)
      setDisplayNameDraft(profileResult.profile.displayName)
    }

    if (identitiesResult.error) {
      setError(identitiesResult.error.message)
    } else {
      setIdentities(normalizeAccountIdentities(identitiesResult.data?.identities))
    }

    setLoading(false)
  }, [isConfigured, user])

  useEffect(() => {
    setProfile(null)
    setIdentities([])
    setDisplayNameDraft('')
    setError(null)
    setMessage(null)

    if (!isConfigured || !user) return

    void refreshAccount()
  }, [isConfigured, refreshAccount, user])

  async function handleSaveDisplayName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user || saving || validationError || !displayNameChanged) return

    setSaving(true)
    setError(null)
    setMessage(null)

    const result = await updateCurrentAccountDisplayName(user, displayNameDraft)
    if (result.error) {
      setError(result.error)
    } else if (result.profile) {
      setProfile(result.profile)
      setDisplayNameDraft(result.profile.displayName)
      setMessage('Display name saved.')
    }

    setSaving(false)
  }

  async function handleLinkGoogle() {
    if (googleConnected || linkingGoogle) return

    setLinkingGoogle(true)
    setError(null)
    setMessage('Opening Google...')

    const result = await linkGoogleIdentity()
    if (result.error) {
      setError(result.error)
      setMessage(null)
      setLinkingGoogle(false)
    } else {
      setMessage('Google linking started. Complete the provider flow to finish.')
      setLinkingGoogle(false)
    }
  }

  if (!isConfigured) {
    return (
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-700">Account</h2>
          <p className="text-sm text-slate-500">Sign-in status and account controls.</p>
        </div>

        <div className="card">
          <p className="text-sm text-slate-500">
            Supabase is not configured. StatKeeper is running in local/offline mode.
          </p>
        </div>
      </section>
    )
  }

  if (!user) {
    return (
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-700">Account</h2>
          <p className="text-sm text-slate-500">Sign-in status and account controls.</p>
        </div>

        <div className="card">
          <p className="text-sm text-slate-500">No active account session.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-700">Account</h2>
        <p className="text-sm text-slate-500">Manage your StatKeeper identity.</p>
      </div>

      {(error || message) && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            error
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700'
          }`}
          role={error ? 'alert' : 'status'}
          aria-live="polite"
        >
          {error ?? message}
        </div>
      )}

      <div className="card space-y-4">
        <div className="flex items-center gap-3">
          {profile?.avatarUrl ? (
            <img
              src={profile.avatarUrl}
              alt=""
              className="h-12 w-12 rounded-full border border-slate-200 object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-lg font-bold text-slate-600">
              {profileInitial(savedDisplayName, displayEmail)}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-700">Signed in</p>
            <p className="break-all text-sm text-slate-500">{displayEmail}</p>
          </div>
        </div>

        <form className="space-y-3" onSubmit={handleSaveDisplayName}>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-slate-700">Display name</span>
            <input
              type="text"
              value={displayNameDraft}
              onChange={event => {
                setDisplayNameDraft(event.target.value)
                setMessage(null)
              }}
              maxLength={80}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50"
              disabled={loading || saving}
            />
          </label>

          {validationError && displayNameDraft.length > 0 && (
            <p className="text-xs text-red-600">{validationError}</p>
          )}

          <button
            type="submit"
            className="btn-primary w-full"
            disabled={loading || saving || Boolean(validationError) || !displayNameChanged}
          >
            {saving ? 'Saving...' : 'Save Display Name'}
          </button>
        </form>
      </div>

      <div className="card space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-700">Sign-in methods</h3>
            <p className="text-xs text-slate-500">Connected ways to access this account.</p>
          </div>
          <button
            type="button"
            onClick={() => void refreshAccount()}
            className="text-xs font-semibold text-blue-600 underline disabled:opacity-40"
            disabled={loading}
          >
            Refresh
          </button>
        </div>

        <div className="space-y-2">
          {identities.map(identity => (
            <div
              key={identity.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-700">
                  {formatAuthProviderLabel(identity.provider)}
                </p>
                {identity.email && (
                  <p className="break-all text-xs text-slate-500">{identity.email}</p>
                )}
              </div>
              <span className="shrink-0 text-xs font-semibold text-emerald-700">Connected</span>
            </div>
          ))}

          {loading && <p className="text-sm text-slate-500">Loading sign-in methods...</p>}
          {!loading && identities.length === 0 && (
            <p className="text-sm text-slate-500">No connected sign-in methods were returned.</p>
          )}
        </div>

        {!googleConnected && (
          <button
            type="button"
            onClick={() => void handleLinkGoogle()}
            className="btn-primary w-full"
            disabled={loading || linkingGoogle}
          >
            {linkingGoogle ? 'Opening Google...' : 'Link Google'}
          </button>
        )}
      </div>

      <div className="card space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">Session</h3>
          <p className="text-xs text-slate-500">Sign out of this device.</p>
        </div>
        <button type="button" onClick={signOut} className="btn-primary w-full">
          Sign Out
        </button>
      </div>
    </section>
  )
}
