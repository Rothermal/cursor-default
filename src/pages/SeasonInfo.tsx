import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { sports } from '../config/sports'
import { useAuth } from '../context/AuthContext'
import { teamDisplayName } from '../lib/display'
import { supabase } from '../lib/supabase'
import { teamInfoPath, teamLeaderboardPath } from '../lib/teamInfo'

interface SeasonInfoRow {
  id: string
  name: string
  sport: string
  start_date: string | null
  end_date: string | null
}

interface SeasonTeamRow {
  id: string
  name: string
  nickname: string | null
  season_id: string
}

export default function SeasonInfo() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const seasonId = searchParams.get('seasonId')
  const { isConfigured } = useAuth()
  const supabaseClient = supabase

  const [season, setSeason] = useState<SeasonInfoRow | null>(null)
  const [teams, setTeams] = useState<SeasonTeamRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const sport = useMemo(
    () => (season ? sports.find(item => item.id === season.sport) ?? null : null),
    [season]
  )

  useEffect(() => {
    if (!seasonId || !isConfigured || !supabaseClient) {
      setLoading(false)
      return
    }

    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      setSeason(null)
      setTeams([])

      const [seasonRes, teamsRes] = await Promise.all([
        supabaseClient
          .from('seasons')
          .select('id,name,sport,start_date,end_date')
          .eq('id', seasonId)
          .single(),
        supabaseClient
          .from('teams')
          .select('id,name,nickname,season_id')
          .eq('season_id', seasonId)
          .order('created_at', { ascending: false }),
      ])

      if (cancelled) return

      if (seasonRes.error || !seasonRes.data) {
        setError(seasonRes.error?.message ?? 'Season not found')
        setLoading(false)
        return
      }
      if (teamsRes.error) {
        setError(teamsRes.error.message)
        setLoading(false)
        return
      }

      setSeason(seasonRes.data as SeasonInfoRow)
      setTeams((teamsRes.data ?? []) as SeasonTeamRow[])
      setLoading(false)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [seasonId, isConfigured, supabaseClient])

  if (!isConfigured) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="card max-w-md w-full text-center">
          <p className="font-semibold text-slate-700 mb-2">Supabase not configured</p>
          <p className="text-sm text-slate-500 mb-4">
            Configure Supabase credentials to view cloud seasons.
          </p>
          <button type="button" onClick={() => navigate('/admin')} className="btn-primary w-full">
            Back to Settings
          </button>
        </div>
      </div>
    )
  }

  if (!seasonId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="card max-w-md w-full text-center">
          <p className="font-semibold text-slate-700 mb-2">Missing season</p>
          <p className="text-sm text-slate-500 mb-4">Choose a season before opening Season Info.</p>
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
          <button
            type="button"
            onClick={() => navigate('/teams')}
            className="text-sm font-semibold text-blue-600"
          >
            Back to Teams
          </button>
          {loading && <span className="text-xs text-slate-400 animate-pulse">Loading...</span>}
        </div>

        {error ? (
          <section className="card text-center space-y-3">
            <p className="font-semibold text-slate-700">Season Info unavailable</p>
            <p className="text-sm text-slate-500">{error}</p>
            <button type="button" onClick={() => navigate('/teams')} className="btn-primary w-full">
              Teams
            </button>
          </section>
        ) : season && !loading ? (
          <>
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-semibold text-slate-500">
                {sport?.icon ? `${sport.icon} ` : ''}
                {sport?.name ?? season.sport}
              </p>
              <h1 className="mt-1 text-2xl font-bold text-slate-900 break-words">
                {season.name}
              </h1>
              {(season.start_date || season.end_date) && (
                <p className="mt-1 text-sm text-slate-500">
                  {[season.start_date, season.end_date].filter(Boolean).join(' to ')}
                </p>
              )}
              <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Teams
                </p>
                <p className="text-lg font-bold text-slate-800">{teams.length}</p>
              </div>
            </section>

            <section className="card space-y-3">
              <div>
                <h2 className="font-semibold text-slate-800">Teams</h2>
                <p className="text-xs text-slate-500">{teams.length} teams in this season</p>
              </div>

              {teams.length === 0 ? (
                <p className="text-sm text-slate-500">No teams in this season yet.</p>
              ) : (
                <div className="space-y-2">
                  {teams.map(team => (
                    <div
                      key={team.id}
                      className="rounded-lg border border-slate-100 bg-white px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <Link
                          to={teamInfoPath(team.id)}
                          className="min-w-0 flex-1 truncate font-medium text-slate-800 hover:text-blue-700"
                        >
                          {teamDisplayName(team)}
                        </Link>
                        <Link
                          to={teamLeaderboardPath(team.id, season.id)}
                          className="shrink-0 text-xs font-semibold text-blue-600"
                        >
                          Season Stats
                        </Link>
                      </div>
                      {team.name !== teamDisplayName(team) && (
                        <p className="mt-1 text-xs text-slate-500 truncate">{team.name}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : loading ? (
          <section className="card">
            <p className="text-sm text-slate-500 animate-pulse">Loading Season Info...</p>
          </section>
        ) : null}
      </div>
    </div>
  )
}
