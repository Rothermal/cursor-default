import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import TeamHero from '../components/team-info/TeamHero'
import { sports } from '../config/sports'
import { useAuth } from '../context/AuthContext'
import { teamDisplayName } from '../lib/display'
import { supabase } from '../lib/supabase'
import {
  computeTeamRecord,
  splitTeamGames,
  teamLeaderboardPath,
  teamManagementPath,
  teamStatsPath,
  type TeamInfoGame,
  type TeamRecord,
} from '../lib/teamInfo'

interface TeamRow {
  id: string
  name: string
  nickname: string | null
  season_id: string
  seasons: {
    id: string
    name: string
    sport: string
  }
}

interface GameRow extends TeamInfoGame {
  game_date: string
  opponent_name: string
}

function emptyRecord(): TeamRecord {
  return { wins: 0, losses: 0, ties: 0, gamesPlayed: 0 }
}

export default function TeamInfo() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const teamId = searchParams.get('teamId')
  const { isConfigured } = useAuth()
  const supabaseClient = supabase

  const [team, setTeam] = useState<TeamRow | null>(null)
  const [rosterCount, setRosterCount] = useState(0)
  const [games, setGames] = useState<GameRow[]>([])
  const [statsTotalsByGameId, setStatsTotalsByGameId] = useState<Record<string, Record<string, number>>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const sport = useMemo(
    () => (team ? sports.find(item => item.id === team.seasons.sport) ?? null : null),
    [team]
  )

  const record = useMemo(
    () => (sport ? computeTeamRecord(sport, games, statsTotalsByGameId) : emptyRecord()),
    [games, sport, statsTotalsByGameId]
  )

  const gameGroups = useMemo(() => splitTeamGames(games), [games])

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
      setGames([])
      setStatsTotalsByGameId({})

      const [teamRes, rosterRes, gamesRes] = await Promise.all([
        supabaseClient
          .from('teams')
          .select('id,name,nickname,season_id,seasons!inner(id,name,sport)')
          .eq('id', teamId)
          .single(),
        supabaseClient
          .from('team_players')
          .select('id', { count: 'exact', head: true })
          .eq('team_id', teamId)
          .eq('is_active', true),
        supabaseClient
          .from('games')
          .select('id,game_date,opponent_name,opponent_score,home_team_score,home_score_adjustment,status')
          .eq('team_id', teamId)
          .order('game_date', { ascending: false }),
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
      if (gamesRes.error) {
        setError(gamesRes.error.message)
        setLoading(false)
        return
      }

      const loadedTeam = teamRes.data as unknown as TeamRow
      const loadedGames = (gamesRes.data ?? []) as GameRow[]
      setTeam(loadedTeam)
      setRosterCount(rosterRes.count ?? 0)
      setGames(loadedGames)

      const legacyFinals = loadedGames.filter(
        game => game.status === 'final' && game.home_team_score == null
      )
      if (legacyFinals.length > 0) {
        const totals: Record<string, Record<string, number>> = {}
        await Promise.all(
          legacyFinals.map(async game => {
            const { data, error: statsError } = await supabaseClient.rpc('get_game_stats_resolved', {
              p_game_id: game.id,
            })
            if (statsError) return
            totals[game.id] = {}
            for (const row of (data ?? []) as { stat_id: string; value: number }[]) {
              totals[game.id][row.stat_id] =
                (totals[game.id][row.stat_id] ?? 0) + Number(row.value)
            }
          })
        )
        if (!cancelled) setStatsTotalsByGameId(totals)
      }

      if (!cancelled) setLoading(false)
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
            Configure Supabase credentials to view cloud team info.
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
          <p className="text-sm text-slate-500 mb-4">Choose a team before opening Team Info.</p>
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
            <p className="font-semibold text-slate-700">Team Info unavailable</p>
            <p className="text-sm text-slate-500">{error}</p>
            <button type="button" onClick={() => navigate('/teams')} className="btn-primary w-full">
              Teams
            </button>
          </section>
        ) : team && !loading ? (
          <>
            <TeamHero
              teamName={teamDisplayName(team)}
              legalName={team.name}
              seasonName={team.seasons.name}
              sportName={sport?.name ?? team.seasons.sport}
              sportIcon={sport?.icon ?? ''}
              record={record}
              rosterCount={rosterCount}
              gameCount={games.length}
            />

            <section className="card space-y-3">
              <h2 className="font-semibold text-slate-800">Team Links</h2>
              <div className="grid gap-2 sm:grid-cols-3">
                <Link
                  to={teamLeaderboardPath(team.id, team.season_id)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-700 hover:border-blue-300"
                >
                  Season Stats
                </Link>
                <Link
                  to={teamStatsPath(team.id)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-700 hover:border-blue-300"
                >
                  Team Stats
                </Link>
                <Link
                  to={teamManagementPath(team.id)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-700 hover:border-blue-300"
                >
                  Manage Team
                </Link>
              </div>
            </section>

            <section className="card space-y-3">
              <h2 className="font-semibold text-slate-800">Game Snapshot</h2>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Upcoming</p>
                  <p className="text-lg font-bold text-slate-800">{gameGroups.upcoming.length}</p>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Live</p>
                  <p className="text-lg font-bold text-slate-800">{gameGroups.inProgress.length}</p>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Final</p>
                  <p className="text-lg font-bold text-slate-800">{gameGroups.completed.length}</p>
                </div>
              </div>
            </section>
          </>
        ) : loading ? (
          <section className="card">
            <p className="text-sm text-slate-500 animate-pulse">Loading Team Info...</p>
          </section>
        ) : null}
      </div>
    </div>
  )
}
