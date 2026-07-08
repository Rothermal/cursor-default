import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { sports } from '../config/sports'
import { resolveFinalHomeScoreFromGameRow } from '../lib/gameScore'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { teamDisplayName } from '../lib/display'
import { formatCompactGameStatLine } from '../lib/statDisplay'
import { teamInfoPath, teamLeaderboardPath } from '../lib/teamInfo'

interface TeamRow {
  id: string
  name: string
  nickname: string | null
  season_id: string
  seasons: { id: string; name: string; sport: string }
}

interface GameMeta {
  id: string
  game_date: string
  opponent_name: string
  opponent_score: number
  home_team_score: number | null
  home_score_adjustment: number | null
  tournament_id: string | null
}

interface TeamLogRow {
  game_id: string
  game_date: string
  opponent_name: string
  opponent_score: number
  home_team_score: number | null
  home_score_adjustment: number
  stat_id: string
  team_total: number
}

interface TournamentRow {
  id: string
  name: string
  placement: number | null
  url: string | null
}

function isMissingRpcError(msg: string): boolean {
  return msg.includes('does not exist') || msg.includes('function')
}

export default function TeamStats() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const teamId = searchParams.get('teamId')

  const { isConfigured } = useAuth()
  const supabaseClient = supabase

  const [team, setTeam] = useState<TeamRow | null>(null)
  const [games, setGames] = useState<GameMeta[]>([])
  const [tournaments, setTournaments] = useState<TournamentRow[]>([])
  const [logRows, setLogRows] = useState<TeamLogRow[]>([])
  const [useRpc, setUseRpc] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const sport = useMemo(
    () => (team ? sports.find(s => s.id === team.seasons.sport) ?? null : null),
    [team]
  )

  useEffect(() => {
    if (!teamId || !isConfigured || !supabaseClient) {
      setLoading(false)
      return
    }

    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)

      const [teamRes, gamesRes, tourRes, logRes] = await Promise.all([
        supabaseClient
          .from('teams')
          .select('id,name,nickname,season_id,seasons!inner(id,name,sport)')
          .eq('id', teamId)
          .single(),
        supabaseClient
          .from('games')
          .select(
            'id,game_date,opponent_name,opponent_score,home_team_score,home_score_adjustment,tournament_id'
          )
          .eq('team_id', teamId)
          .eq('status', 'final')
          .order('game_date', { ascending: false }),
        supabaseClient.from('tournaments').select('id,name,placement,url').eq('team_id', teamId),
        supabaseClient.rpc('get_team_game_log', { p_team_id: teamId }),
      ])

      if (cancelled) return

      if (teamRes.error || !teamRes.data) {
        setError(teamRes.error?.message ?? 'Team not found')
        setLoading(false)
        return
      }

      setTeam(teamRes.data as unknown as TeamRow)
      setGames((gamesRes.data ?? []) as GameMeta[])
      setTournaments((tourRes.data ?? []) as TournamentRow[])

      if (logRes.error && isMissingRpcError(logRes.error.message)) {
        setUseRpc(false)
        const finals = (gamesRes.data ?? []) as GameMeta[]
        const aggregated: TeamLogRow[] = []
        for (const g of finals) {
          const res = await supabaseClient.rpc('get_game_stats_resolved', { p_game_id: g.id })
          if (res.error) continue
          const byStat: Record<string, number> = {}
          for (const row of (res.data ?? []) as { stat_id: string; value: number }[]) {
            byStat[row.stat_id] = (byStat[row.stat_id] ?? 0) + Number(row.value)
          }
          const adj = g.home_score_adjustment ?? 0
          for (const [statId, team_total] of Object.entries(byStat)) {
            aggregated.push({
              game_id: g.id,
              game_date: g.game_date,
              opponent_name: g.opponent_name,
              opponent_score: g.opponent_score,
              home_team_score: g.home_team_score ?? null,
              home_score_adjustment: adj,
              stat_id: statId,
              team_total,
            })
          }
        }
        setLogRows(aggregated)
      } else if (logRes.error) {
        setError(logRes.error.message)
        setLoading(false)
        return
      } else {
        setUseRpc(true)
        setLogRows((logRes.data ?? []) as TeamLogRow[])
      }

      setLoading(false)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [teamId, isConfigured, supabaseClient])

  const gameLines = useMemo(() => {
    const empty = { lines: [] as Array<{ game: GameMeta; homeScore: number; won: boolean; compact: string }>, wins: 0, losses: 0, total: 0 }
    if (!sport) return empty
    const byGame = new Map<
      string,
      { meta: GameMeta; stats: Record<string, number>; homeAdj: number }
    >()

    if (useRpc && logRows.length > 0) {
      for (const row of logRows) {
        if (!byGame.has(row.game_id)) {
          byGame.set(row.game_id, {
            meta: {
              id: row.game_id,
              game_date: row.game_date,
              opponent_name: row.opponent_name,
              opponent_score: row.opponent_score,
              home_team_score: row.home_team_score,
              home_score_adjustment: row.home_score_adjustment,
              tournament_id: null,
            },
            stats: {},
            homeAdj: row.home_score_adjustment,
          })
        }
        byGame.get(row.game_id)!.stats[row.stat_id] = Number(row.team_total)
      }
    } else {
      for (const g of games) {
        byGame.set(g.id, {
          meta: g,
          stats: {},
          homeAdj: g.home_score_adjustment ?? 0,
        })
      }
    }

    let wins = 0
    let losses = 0
    const lines: Array<{
      game: GameMeta
      homeScore: number
      won: boolean
      compact: string
    }> = []

    for (const g of games) {
      const entry = byGame.get(g.id)
      const stats = entry?.stats ?? {}
      const meta = entry?.meta ?? g
      const homeScore = sport
        ? resolveFinalHomeScoreFromGameRow(sport, stats, {
            home_team_score: meta.home_team_score,
            home_score_adjustment: entry?.homeAdj ?? meta.home_score_adjustment ?? 0,
          })
        : 0
      const won = homeScore > g.opponent_score
      if (homeScore !== g.opponent_score) {
        if (won) wins++
        else losses++
      }
      const compact =
        Object.keys(stats).length > 0 && sport
          ? formatCompactGameStatLine(sport, stats)
          : '—'
      lines.push({ game: g, homeScore, won, compact })
    }

    return { lines, wins, losses, total: games.length }
  }, [games, logRows, useRpc, sport])

  const opponentBreakdown = useMemo(() => {
    const map = new Map<
      string,
      { name: string; wins: number; losses: number; ties: number; pf: number; pa: number; gp: number }
    >()
    for (const row of gameLines.lines) {
      const name = row.game.opponent_name.trim() || 'Unknown'
      if (!map.has(name)) {
        map.set(name, { name, wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, gp: 0 })
      }
      const o = map.get(name)!
      o.gp += 1
      o.pf += row.homeScore
      o.pa += row.game.opponent_score
      if (row.homeScore === row.game.opponent_score) o.ties += 1
      else if (row.won) o.wins += 1
      else o.losses += 1
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [gameLines.lines])

  if (!teamId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="card max-w-md w-full text-center">
          <p className="font-semibold text-slate-700 mb-2">Missing team</p>
          <button type="button" onClick={() => navigate('/leaderboard')} className="btn-primary w-full">
            Leaderboard
          </button>
        </div>
      </div>
    )
  }

  if (!isConfigured) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <p className="text-slate-600">Supabase required</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-slate-500 animate-pulse">Loading team stats...</p>
      </div>
    )
  }

  if (!team || error) {
    return (
      <div className="min-h-screen flex flex-col px-4 py-6 max-w-lg mx-auto">
        {error && <div className="card bg-red-50 text-red-700 text-sm mb-4">{error}</div>}
        <button type="button" onClick={() => navigate(teamInfoPath(teamId))} className="btn-primary">
          Back
        </button>
      </div>
    )
  }

  const { lines, wins, losses, total } = gameLines
  const decided = wins + losses

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-gradient-to-r from-slate-700 to-slate-600 text-white px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(teamInfoPath(teamId))}
            className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center active:scale-90 transition-transform"
          >
            ←
          </button>
          <div className="min-w-0">
            <h1 className="text-lg font-bold truncate">Team stats</h1>
            <p className="text-sm opacity-80 truncate">
              {sport?.icon} {teamDisplayName(team)} · {team.seasons.name}
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 px-4 py-6 max-w-lg mx-auto w-full space-y-4">
        {!useRpc && logRows.length === 0 && games.length > 0 && (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
            Apply migration <code className="text-[11px]">020_stat_tracking_ui_rpcs.sql</code> for
            faster team game lines. Per-game stats unavailable.
          </p>
        )}

        <button
          type="button"
          onClick={() => navigate(teamLeaderboardPath(teamId, team.season_id))}
          className="text-sm font-semibold text-blue-600"
        >
          Season leaderboard →
        </button>

        <section className="card space-y-2">
          <h2 className="font-semibold text-slate-700">Season record</h2>
          <div className="flex gap-4">
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 flex-1 text-center">
              <p className="text-2xl font-bold text-emerald-700">{wins}</p>
              <p className="text-xs text-slate-500">Wins</p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 flex-1 text-center">
              <p className="text-2xl font-bold text-rose-700">{losses}</p>
              <p className="text-xs text-slate-500">Losses</p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 flex-1 text-center">
              <p className="text-2xl font-bold text-slate-800">{total}</p>
              <p className="text-xs text-slate-500">Games</p>
            </div>
          </div>
          {decided > 0 && (
            <p className="text-xs text-slate-500">
              {((wins / decided) * 100).toFixed(0)}% in decided games ({wins}-{losses})
            </p>
          )}
        </section>

        {tournaments.length > 0 && (
          <section className="card space-y-2">
            <h2 className="font-semibold text-slate-700">Tournaments</h2>
            <ul className="space-y-2 text-sm">
              {tournaments.map(t => (
                <li key={t.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">🏆 {t.name}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    {t.placement != null && (
                      <span className="text-slate-500 text-xs">
                        {t.placement === 1 ? '🥇 1st' : t.placement === 2 ? '🥈 2nd' : t.placement === 3 ? '🥉 3rd' : `#${t.placement}`}
                      </span>
                    )}
                    {t.url && (
                      <a
                        href={t.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-semibold text-slate-600 underline"
                      >
                        Link ↗
                      </a>
                    )}
                    <Link
                      to={`/tournament-stats?tournamentId=${encodeURIComponent(t.id)}&teamId=${encodeURIComponent(team.id)}`}
                      className="text-xs font-semibold text-blue-600 underline"
                    >
                      Stats →
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {opponentBreakdown.length > 0 && (
          <section className="card space-y-3">
            <h2 className="font-semibold text-slate-700">By opponent</h2>
            <p className="text-xs text-slate-500">
              Combined results when you played the same opponent more than once.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left">
                    <th className="py-2 pr-2 font-semibold text-slate-600">Opponent</th>
                    <th className="py-2 px-1 font-semibold text-slate-600 text-center">W-L-T</th>
                    <th className="py-2 pl-2 font-semibold text-slate-600 text-right">PF-PA</th>
                  </tr>
                </thead>
                <tbody>
                  {opponentBreakdown.map(row => {
                    const decided = row.wins + row.losses
                    const plusMinus = row.pf - row.pa
                    return (
                      <tr key={row.name} className="border-b border-slate-100">
                        <td className="py-2 pr-2 font-medium text-slate-800 max-w-[140px] truncate">
                          {row.name}
                        </td>
                        <td className="py-2 px-1 text-center tabular-nums text-slate-700">
                          {row.wins}-{row.losses}-{row.ties}
                          {decided > 0 && (
                            <span className="text-slate-400 text-xs block">
                              {((row.wins / decided) * 100).toFixed(0)}%
                            </span>
                          )}
                        </td>
                        <td className="py-2 pl-2 text-right tabular-nums">
                          <span className="text-slate-800">
                            {row.pf}-{row.pa}
                          </span>
                          <span
                            className={`text-xs ml-1 ${plusMinus > 0 ? 'text-emerald-600' : plusMinus < 0 ? 'text-rose-600' : 'text-slate-400'}`}
                          >
                            ({plusMinus > 0 ? '+' : ''}{plusMinus})
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="card space-y-3">
          <h2 className="font-semibold text-slate-700">Game by game</h2>
          {lines.length === 0 ? (
            <p className="text-sm text-slate-500">No finalized games.</p>
          ) : (
            <div className="space-y-2">
              {lines.map(({ game, homeScore, won, compact }) => (
                <div
                  key={game.id}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2"
                >
                  <div className="flex justify-between gap-2 items-start">
                    <div>
                      <p className="font-medium text-slate-800">{game.game_date}</p>
                      <p className="text-sm text-slate-600">vs {game.opponent_name}</p>
                    </div>
                    <span
                      className={`text-sm font-semibold shrink-0 ${
                        homeScore === game.opponent_score
                          ? 'text-slate-600'
                          : won
                            ? 'text-emerald-700'
                            : 'text-rose-700'
                      }`}
                    >
                      {homeScore === game.opponent_score ? 'T' : won ? 'W' : 'L'} {homeScore}-{game.opponent_score}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">{compact}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
