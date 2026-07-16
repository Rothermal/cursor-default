import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  buildTeamInviteUrl,
  type TeamInviteLinkRole,
} from '../lib/teamInviteLinks'

interface TeamInviteLinkRow {
  id: string
  token: string
  role: TeamInviteLinkRole
  expires_at: string
  created_at: string
}

function roleLabel(role: TeamInviteLinkRole): string {
  return role === 'scorer' ? 'Scorer' : 'Viewer'
}

export default function TeamInviteLinksPanel({
  teamId,
  onAuditChange,
}: {
  teamId: string
  onAuditChange?: () => void
}) {
  const [links, setLinks] = useState<TeamInviteLinkRow[]>([])
  const [role, setRole] = useState<TeamInviteLinkRole>('viewer')
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }

    const client = supabase
    let cancelled = false
    const loadLinks = async () => {
      setLoading(true)
      setError(null)
      const { data, error: rpcError } = await client.rpc('get_team_invite_links', {
        p_team_id: teamId,
      })
      if (cancelled) return
      if (rpcError) {
        setError(rpcError.message)
        setLinks([])
      } else {
        setLinks((data ?? []) as TeamInviteLinkRow[])
      }
      setLoading(false)
    }

    void loadLinks()
    return () => {
      cancelled = true
    }
  }, [teamId])

  const handleCreate = async () => {
    if (!supabase) return
    setCreating(true)
    setError(null)
    const { data, error: rpcError } = await supabase.rpc('create_team_invite_link', {
      p_team_id: teamId,
      p_role: role,
      p_expires_in_days: 7,
    })
    setCreating(false)
    if (rpcError) {
      setError(rpcError.message)
      return
    }

    const created = ((data ?? [])[0] as TeamInviteLinkRow | undefined) ?? null
    if (created) setLinks(current => [created, ...current])
    onAuditChange?.()
  }

  const handleCopy = async (link: TeamInviteLinkRow) => {
    setError(null)
    try {
      await navigator.clipboard.writeText(buildTeamInviteUrl(link.token))
      setCopiedId(link.id)
      window.setTimeout(() => setCopiedId(current => current === link.id ? null : current), 2000)
    } catch {
      setError('Could not copy the invite link. Check browser clipboard permissions.')
    }
  }

  const handleRevoke = async (link: TeamInviteLinkRow) => {
    if (!supabase || !window.confirm(`Revoke this ${roleLabel(link.role)} invite link?`)) return
    setRevokingId(link.id)
    setError(null)
    const { error: rpcError } = await supabase.rpc('revoke_team_invite_link', {
      p_link_id: link.id,
    })
    setRevokingId(null)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    setLinks(current => current.filter(candidate => candidate.id !== link.id))
    onAuditChange?.()
  }

  return (
    <div className="pt-3 border-t border-slate-100 space-y-3">
      <div>
        <p className="text-sm font-medium text-slate-700">Invite links</p>
        <p className="text-xs text-slate-500">Single-use links expire after 7 days.</p>
      </div>

      <div className="flex items-center gap-2">
        <select
          value={role}
          onChange={event => setRole(event.target.value as TeamInviteLinkRole)}
          className="input-field w-auto text-sm py-2"
          aria-label="Invite link role"
        >
          <option value="viewer">Viewer</option>
          <option value="scorer">Scorer</option>
        </select>
        <button
          type="button"
          onClick={() => { void handleCreate() }}
          disabled={creating}
          className="btn-primary flex-1 py-2 disabled:opacity-60"
        >
          {creating ? 'Creating...' : 'Create Link'}
        </button>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-xs text-slate-400 animate-pulse">Loading active links...</p>
      ) : links.length === 0 ? (
        <p className="text-xs text-slate-500">No active invite links.</p>
      ) : (
        <div className="space-y-2">
          {links.map(link => (
            <div
              key={link.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-700">{roleLabel(link.role)}</p>
                <p className="text-xs text-slate-500 truncate">
                  Expires {new Date(link.expires_at).toLocaleString()}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => { void handleCopy(link) }}
                  className="text-xs font-semibold text-blue-600"
                >
                  {copiedId === link.id ? 'Copied' : 'Copy'}
                </button>
                <button
                  type="button"
                  onClick={() => { void handleRevoke(link) }}
                  disabled={revokingId === link.id}
                  className="text-xs font-semibold text-red-600 disabled:opacity-50"
                >
                  {revokingId === link.id ? 'Revoking...' : 'Revoke'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
