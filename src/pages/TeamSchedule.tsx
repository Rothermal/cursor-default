import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import GameCard, { type TeamInfoGameCardGame } from '../components/team-info/GameCard'
import { sports } from '../config/sports'
import { useAuth } from '../context/AuthContext'
import { teamDisplayName } from '../lib/display'
import { supabase } from '../lib/supabase'
import {
  resolveTeamInfoHomeScore,
  splitTeamGames,
  teamGameResult,
  teamInfoPath,
  type TeamInfoGame,
} from '../lib/teamInfo'

interface TeamScheduleTeamRow {
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

interface TeamScheduleGameRow extends TeamInfoGame {
  team_id: string
  game_date: string
  opponent_name: string
  tournament_name: string | null
  tournament_id: string | null
}

export default function TeamSchedule() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const teamId = searchParams.get('teamId')
  const { isConfigured } = useAuth()
  const supabaseClient = supabase

  const [team, setTeam] = useState<TeamScheduleTeamRow | null>(null)
  const [games, setGames] = useState<TeamScheduleGameRow[]>([])
  const [statsTotalsByGameId, setStatsTotalsByGameId] = useState<
    Record<string, Record<string, number>>
  >({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const sport = useMemo(
    () => (team ? sports.find(item => item.id === team.seasons.sport) ?? null : null),
    [team]
  )

  const gamesWithScores = useMemo<TeamInfoGameCardGame[]>(
    () =>
      games.map(game => {
        const homeScore = resolveTeamInfoHomeScore(sport, game, statsTotalsByGameId)
        const scoreLine =
          homeScore != null && game.opponent_score != null
            ? `${homeScore}-${game.opponent_score}`
            : null
        const result =
          game.status === 'final' && homeScore != null && game.opponent_score != null
            ? teamGameResult(homeScore, game.opponent_score)
            : null
        return { ...game, scoreLine, result }
      }),
    [games, sport, statsTotalsByGameId]
  )

  const gameGroups = useMemo(() => {
    const groups = splitTeamGames(gamesWithScores)
    return {
      inProgress: groups.inProgress.sort((a, b) => b.game_date.localeCompare(a.game_date)),
      upcoming: groups.upcoming.sort((a, b) => a.game_date.localeCompare(b.game_date)),
      completed: groups.completed.sort((a, b) => b.game_date.localeCompare(a.game_date)),
    }
  }, [gamesWithScores])

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

      const [teamRes, gamesRes] = await Promise.all([
        supabaseClient
          .from('teams')
          .select('id,name,nickname,season_id,seasons!inner(id,name,sport)')
          .eq('id', teamId)
          .single(),
        supabaseClient
          .from('games')
          .select(
            'id,team_id,game_date,opponent_name,opponent_score,home_team_score,home_score_adjustment,status,tournament_name,tournament_id'
          )
          .eq('team_id', teamId)
          .order('game_date', { ascending: false }),
      ])

      if (cancelled) return

      if (teamRes.error || !teamRes.data) {
        setError(teamRes.error?.message ?? 'Team not found')
        setLoading(false)
        return
      }
      if (gamesRes.error) {
        setError(gamesRes.error.message)
        setLoading(false)
        return
      }

      const loadedGames = (gamesRes.data ?? []) as TeamScheduleGameRow[]
      setTeam(teamRes.data as unknown as TeamScheduleTeamRow)
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

  const renderGameSection = (
    title: string,
    sectionGames: TeamInfoGameCardGame[],
    emptyText: string
  ) => (
    <section className="card space-y-3">
      <div>
        <h2 className="font-semibold text-slate-800">{title}</h2>
        <p className="text-xs text-slate-500">{sectionGames.length} games</p>
      </div>
      {sectionGames.length === 0 ? (
        <p className="text-sm text-slate-500">{emptyText}</p>
      ) : (
        <div className="space-y-2">
          {sectionGames.map(game => (
            <GameCard key={game.id} game={game} teamId={teamId ?? undefined} />
          ))}
        </div>
      )}
    </section>
  )

  if (!isConfigured) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="card max-w-md w-full text-center">
          <p className="font-semibold text-slate-700 mb-2">Supabase not configured</p>
          <p className="text-sm text-slate-500 mb-4">
            Configure Supabase credentials to view cloud schedules.
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
          <p className="text-sm text-slate-500 mb-4">Choose a team before opening Schedule.</p>
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
            <p className="font-semibold text-slate-700">Schedule unavailable</p>
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
                {teamDisplayName(team)}
              </h1>
              <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Total games
                </p>
                <p className="text-lg font-bold text-slate-800">{games.length}</p>
              </div>
            </section>

            {renderGameSection('Live', gameGroups.inProgress, 'No live games right now.')}
            {renderGameSection('Upcoming', gameGroups.upcoming, 'No upcoming games.')}
            {renderGameSection('Finals', gameGroups.completed, 'No finalized games yet.')}
          </>
        ) : loading ? (
          <section className="card">
            <p className="text-sm text-slate-500 animate-pulse">Loading Schedule...</p>
          </section>
        ) : null}
      </div>
    </div>
  )
}
