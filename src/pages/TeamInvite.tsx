import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Auth from './Auth'
import { useAuth } from '../context/AuthContext'
import { saveOAuthReturnPath } from '../lib/oauthReturnPath'
import { supabase } from '../lib/supabase'
import { teamDisplayName } from '../lib/display'
import { teamInfoPath } from '../lib/teamInfo'
import {
  normalizeTeamInviteToken,
  teamInvitePath,
  type TeamInviteLinkRole,
} from '../lib/teamInviteLinks'

interface TeamInviteSummary {
  team_id: string
  team_name: string
  team_nickname: string | null
  season_name: string
  sport: string
  role: TeamInviteLinkRole
  expires_at: string
}

function roleLabel(role: TeamInviteLinkRole): string {
  return role === 'scorer' ? 'Scorer' : 'Viewer'
}

export default function TeamInvite() {
  const navigate = useNavigate()
  const { token: rawToken } = useParams()
  const { user, isConfigured } = useAuth()
  const token = normalizeTeamInviteToken(rawToken)
  const [invite, setInvite] = useState<TeamInviteSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isConfigured || !supabase || !token) {
      setInvite(null)
      setLoading(false)
      return
    }

    const client = supabase
    let cancelled = false
    const loadInvite = async () => {
      setLoading(true)
      setError(null)
      const { data, error: rpcError } = await client.rpc('get_team_invite_link', {
        p_token: token,
      })
      if (cancelled) return
      if (rpcError) {
        setInvite(null)
        setError(rpcError.message)
      } else {
        setInvite(((data ?? [])[0] as TeamInviteSummary | undefined) ?? null)
      }
      setLoading(false)
    }

    void loadInvite()
    return () => {
      cancelled = true
    }
  }, [isConfigured, token])

  useEffect(() => {
    if (!user && invite && token) saveOAuthReturnPath(teamInvitePath(token))
  }, [invite, token, user])

  const handleJoin = async () => {
    if (!user || !supabase || !token || !invite) return
    setJoining(true)
    setError(null)
    const { data, error: rpcError } = await supabase.rpc('redeem_team_invite_link', {
      p_token: token,
    })
    setJoining(false)
    if (rpcError) {
      setError(rpcError.message)
      return
    }

    const result = ((data ?? [])[0] as { team_id?: string } | undefined) ?? null
    navigate(teamInfoPath(result?.team_id ?? invite.team_id), { replace: true })
  }

  if (!isConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <section className="card max-w-md w-full text-center space-y-3">
          <h1 className="font-semibold text-slate-800">Invite unavailable</h1>
          <p className="text-sm text-slate-500">Cloud access is not configured.</p>
        </section>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <section className="card max-w-md w-full text-center">
          <p className="text-sm text-slate-500 animate-pulse">Checking invite...</p>
        </section>
      </div>
    )
  }

  if (!token || !invite) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <section className="card max-w-md w-full text-center space-y-3">
          <h1 className="font-semibold text-slate-800">Invite unavailable</h1>
          <p className="text-sm text-slate-500">
            {error ?? 'This invite link is invalid, expired, revoked, or already used.'}
          </p>
          <button type="button" onClick={() => navigate('/')} className="btn-primary w-full">
            Continue to StatKeeper
          </button>
        </section>
      </div>
    )
  }

  const displayName = teamDisplayName({
    name: invite.team_name,
    nickname: invite.team_nickname,
  })
  const joinContext = `Join ${displayName} as ${roleLabel(invite.role)}`

  if (!user) {
    return (
      <Auth
        contextTitle={joinContext}
        contextMessage="Sign in or create an account to confirm this team invitation."
      />
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="max-w-lg mx-auto space-y-4">
        <section className="card space-y-4">
          <div>
            <p className="text-xs font-semibold text-blue-600">{invite.sport}</p>
            <h1 className="mt-1 text-xl font-bold text-slate-900">{displayName}</h1>
            <p className="text-sm text-slate-500">{invite.season_name}</p>
          </div>

          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <p className="text-xs text-slate-500">Team role</p>
            <p className="font-semibold text-slate-800">{roleLabel(invite.role)}</p>
          </div>

          <p className="text-xs text-slate-500">
            Expires {new Date(invite.expires_at).toLocaleString()}
          </p>

          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={() => { void handleJoin() }}
            disabled={joining}
            className="btn-primary w-full disabled:opacity-60"
          >
            {joining ? 'Joining...' : `Join as ${roleLabel(invite.role)}`}
          </button>
          <button
            type="button"
            onClick={() => navigate('/sports')}
            disabled={joining}
            className="btn-secondary w-full disabled:opacity-60"
          >
            Not now
          </button>
        </section>
      </div>
    </div>
  )
}
