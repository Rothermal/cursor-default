import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import RosterPreviewCard, {
  type TeamInfoRosterPlayer,
} from '../components/team-info/RosterPreviewCard'
import { sports } from '../config/sports'
import { useAuth } from '../context/AuthContext'
import { teamDisplayName } from '../lib/display'
import { supabase } from '../lib/supabase'
import { teamInfoPath } from '../lib/teamInfo'

interface TeamRosterTeamRow {
  id: string
  name: string
  nickname: string | null
  seasons: {
    id: string
    name: string
    sport: string
  }
}

export default function TeamRoster() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const teamId = searchParams.get('teamId')
  const { isConfigured } = useAuth()
  const supabaseClient = supabase

  const [team, setTeam] = useState<TeamRosterTeamRow | null>(null)
  const [players, setPlayers] = useState<TeamInfoRosterPlayer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const sport = useMemo(
    () => (team ? sports.find(item => item.id === team.seasons.sport) ?? null : null),
    [team]
  )
  const displayName = team ? teamDisplayName(team) : ''

  useEffect(() => {
    if (!teamId || !isConfigured || !supabaseClient) {
      setLoading(false)
      return
    }

    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      setTeam(null)
      setPlayers([])

      const [teamRes, rosterRes] = await Promise.all([
        supabaseClient
          .from('teams')
          .select('id,name,nickname,seasons!inner(id,name,sport)')
          .eq('id', teamId)
          .single(),
        supabaseClient
          .from('team_players')
          .select('jersey_number,players!inner(id,first_name,last_name,nickname)')
          .eq('team_id', teamId)
          .eq('is_active', true)
          .order('joined_at', { ascending: true }),
      ])

      if (cancelled) return

      if (teamRes.error || !teamRes.data) {
        setError(teamRes.error?.message ?? 'Team not found')
        setLoading(false)
        return
      }
      if (rosterRes.error) {
        setError(rosterRes.error.message)
        setLoading(false)
        return
      }

      type TeamPlayerJoin = {
        jersey_number: string | null
        players: {
          id: string
          first_name: string
          last_name: string | null
          nickname: string | null
        }
      }

      setTeam(teamRes.data as unknown as TeamRosterTeamRow)
      setPlayers(((rosterRes.data ?? []) as unknown as TeamPlayerJoin[]).map(row => ({
        id: row.players.id,
        first_name: row.players.first_name,
        last_name: row.players.last_name,
        nickname: row.players.nickname,
        jersey_number: row.jersey_number,
      })))
      setLoading(false)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [teamId, isConfigured, supabaseClient])

  if (!isConfigured) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="card max-w-md w-full text-center">
          <p className="font-semibold text-slate-700 mb-2">Supabase not configured</p>
          <p className="text-sm text-slate-500 mb-4">
            Configure Supabase credentials to view cloud team rosters.
          </p>
          <button type="button" onClick={() => navigate('/admin')} className="btn-primary w-full">
            Back to Settings
          </button>
        </div>
      </div>
    )
  }

  if (!teamId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="card max-w-md w-full text-center">
          <p className="font-semibold text-slate-700 mb-2">Missing team</p>
          <p className="text-sm text-slate-500 mb-4">Choose a team before opening the roster.</p>
          <button type="button" onClick={() => navigate('/teams')} className="btn-primary w-full">
            Teams
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-3xl mx-auto px-4 py-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <Link to={teamInfoPath(teamId)} className="text-sm font-semibold text-blue-600">
            Back to Team
          </Link>
          {loading && <span className="text-xs text-slate-400 animate-pulse">Loading...</span>}
        </div>

        {error ? (
          <section className="card text-center space-y-3">
            <p className="font-semibold text-slate-700">Team roster unavailable</p>
            <p className="text-sm text-slate-500">{error}</p>
            <button type="button" onClick={() => navigate('/teams')} className="btn-primary w-full">
              Teams
            </button>
          </section>
        ) : team && !loading ? (
          <>
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-semibold text-slate-500">
                {sport?.icon ? `${sport.icon} ` : ''}
                {sport?.name ?? team.seasons.sport} / {team.seasons.name}
              </p>
              <h1 className="mt-1 text-2xl font-bold text-slate-900 break-words">
                {displayName}
              </h1>
              {team.name !== displayName && (
                <p className="mt-1 text-sm text-slate-500 break-words">{team.name}</p>
              )}
              <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Active roster
                </p>
                <p className="text-lg font-bold text-slate-800">{players.length}</p>
              </div>
            </section>

            <RosterPreviewCard teamId={team.id} players={players} />
          </>
        ) : loading ? (
          <section className="card">
            <p className="text-sm text-slate-500 animate-pulse">Loading Team Roster...</p>
          </section>
        ) : null}
      </div>
    </div>
  )
}
