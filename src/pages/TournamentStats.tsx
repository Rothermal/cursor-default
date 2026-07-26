import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { sports, computePlayerScore } from '../config/sports'
import { resolveFinalHomeScoreFromGameRow } from '../lib/gameScore'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { teamDisplayName, playerDisplayName } from '../lib/display'
import { acceptedTeamRole, canManageTeam } from '../lib/teamPermissions'
import { formatCompactGameStatLine } from '../lib/statDisplay'
import { playerInfoPath, teamInfoPath, teamStatsPath } from '../lib/teamInfo'
import { SoccerAggregateDestinationPage } from '../components/soccer-aggregate/SoccerAggregateDestination'

interface TeamRow {
  id: string
  name: string
  nickname: string | null
  season_id: string
  seasons: { id: string; name: string; sport: string }
}

interface TournamentRow {
  id: string
  name: string
  placement: number | null
  team_id: string
  url: string | null
}

interface GameMeta {
  id: string
  game_date: string
  opponent_name: string
  opponent_score: number
  home_team_score: number | null
  home_score_adjustment: number | null
}

interface StatRow {
  player_id: string
  stat_id: string
  games_played: number
  total: number
  per_game_avg: number
  tournament_high: number
}

interface PlayerRow {
  id: string
  first_name: string
  last_name: string | null
  jersey_number: string | null
  nickname: string | null
}

interface GameLine {
  game: GameMeta
  homeScore: number
  won: boolean
  compact: string
}

function isMissingRpcError(msg: string): boolean {
  return msg.includes('does not exist') || msg.includes('function')
}

function placementLabel(p: number | null): string | null {
  if (p == null) return null
  if (p === 1) return '🥇 1st'
  if (p === 2) return '🥈 2nd'
  if (p === 3) return '🥉 3rd'
  return `${p}th`
}

export default function TournamentStats() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const tournamentId = searchParams.get('tournamentId')
  const teamId = searchParams.get('teamId')

  const { isConfigured, user } = useAuth()
  const supabaseClient = supabase

  const [team, setTeam] = useState<TeamRow | null>(null)
  const [tournament, setTournament] = useState<TournamentRow | null>(null)
  const [games, setGames] = useState<GameMeta[]>([])
  const [statRows, setStatRows] = useState<StatRow[]>([])
  const [players, setPlayers] = useState<PlayerRow[]>([])
  const [gameLines, setGameLines] = useState<GameLine[]>([])
  const [wins, setWins] = useState(0)
  const [losses, setLosses] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [canEditPlacement, setCanEditPlacement] = useState(false)
  const [placementDraft, setPlacementDraft] = useState<string>('')
  const [savingPlacement, setSavingPlacement] = useState(false)
  const [placementError, setPlacementError] = useState<string | null>(null)

  const sport = useMemo(
    () => (team ? sports.find(s => s.id === team.seasons.sport) ?? null : null),
    [team]
  )

  useEffect(() => {
    if (!tournamentId || !teamId || !isConfigured || !supabaseClient) {
      setLoading(false)
      return
    }

    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)

      const [tourRes, teamRes] = await Promise.all([
        supabaseClient.from('tournaments').select('id,name,placement,team_id,url').eq('id', tournamentId).single(),
        supabaseClient
          .from('teams')
          .select('id,name,nickname,season_id,seasons!inner(id,name,sport)')
          .eq('id', teamId)
          .single(),
      ])

      if (cancelled) return

      if (tourRes.error || !tourRes.data) {
        setError(tourRes.error?.message ?? 'Tournament not found')
        setLoading(false)
        return
      }
      const tr = tourRes.data as TournamentRow
      if (tr.team_id !== teamId) {
        setError('Tournament does not belong to this team.')
        setLoading(false)
        return
      }
      if (teamRes.error || !teamRes.data) {
        setError(teamRes.error?.message ?? 'Team not found')
        setLoading(false)
        return
      }

      const teamData = teamRes.data as unknown as TeamRow
      setTournament(tr)
      setTeam(teamData)
      if (teamData.seasons.sport === 'soccer') {
        setGames([])
        setStatRows([])
        setPlayers([])
        setGameLines([])
        setWins(0)
        setLosses(0)
        setLoading(false)
        return
      }

      const [gamesRes, statsRpc, rosterRes] = await Promise.all([
        supabaseClient
          .from('games')
          .select('id,game_date,opponent_name,opponent_score,home_team_score,home_score_adjustment')
          .eq('team_id', teamId)
          .eq('tournament_id', tournamentId)
          .eq('status', 'final')
          .order('game_date', { ascending: false }),
        supabaseClient.rpc('get_tournament_stats_resolved', { p_tournament_id: tournamentId }),
        supabaseClient
          .from('team_players')
          .select('jersey_number,players!inner(id,first_name,last_name,nickname)')
          .eq('team_id', teamId)
          .eq('is_active', true)
          .order('joined_at', { ascending: true }),
      ])

      if (cancelled) return

      const sportCfg = sports.find(s => s.id === teamData.seasons.sport) ?? null
      const finals = (gamesRes.data ?? []) as GameMeta[]

      setGames(finals)

      type RosterJoin = { jersey_number: string | null; players: { id: string; first_name: string; last_name: string | null; nickname: string | null } }
      setPlayers(
        ((rosterRes.data ?? []) as unknown as RosterJoin[]).map(r => ({
          id: r.players.id,
          first_name: r.players.first_name,
          last_name: r.players.last_name,
          jersey_number: r.jersey_number,
          nickname: r.players.nickname,
        }))
      )

      if (statsRpc.error && isMissingRpcError(statsRpc.error.message)) {
        const agg = new Map<string, Map<string, { total: number; games: Set<string>; high: number }>>()
        for (const g of finals) {
          const res = await supabaseClient.rpc('get_game_stats_resolved', { p_game_id: g.id })
          if (res.error) continue
          for (const row of (res.data ?? []) as { player_id: string; stat_id: string; value: number }[]) {
            if (!agg.has(row.player_id)) agg.set(row.player_id, new Map())
            const pm = agg.get(row.player_id)!
            if (!pm.has(row.stat_id)) {
              pm.set(row.stat_id, { total: 0, games: new Set(), high: 0 })
            }
            const e = pm.get(row.stat_id)!
            e.total += Number(row.value)
            e.games.add(g.id)
            e.high = Math.max(e.high, Number(row.value))
          }
        }
        const flat: StatRow[] = []
        for (const [pid, sm] of agg) {
          for (const [statId, e] of sm) {
            const gp = e.games.size
            flat.push({
              player_id: pid,
              stat_id: statId,
              games_played: gp,
              total: e.total,
              per_game_avg: gp ? Math.round((e.total / gp) * 10) / 10 : 0,
              tournament_high: e.high,
            })
          }
        }
        setStatRows(flat)
      } else if (statsRpc.error) {
        setError(statsRpc.error.message)
        setLoading(false)
        return
      } else {
        setStatRows((statsRpc.data ?? []) as StatRow[])
      }

      let w = 0
      let l = 0
      const lines: GameLine[] = []
      if (sportCfg) {
        for (const g of finals) {
          const res = await supabaseClient.rpc('get_game_stats_resolved', { p_game_id: g.id })
          const byStat: Record<string, number> = {}
          if (!res.error) {
            for (const row of (res.data ?? []) as { stat_id: string; value: number }[]) {
              byStat[row.stat_id] = (byStat[row.stat_id] ?? 0) + Number(row.value)
            }
          }
          const homeScore = resolveFinalHomeScoreFromGameRow(sportCfg, byStat, g)
          const opp = g.opponent_score
          const decided = homeScore !== opp
          const won = homeScore > opp
          if (decided) {
            if (won) w++
            else l++
          }
          const compact =
            Object.keys(byStat).length > 0 ? formatCompactGameStatLine(sportCfg, byStat) : '—'
          lines.push({ game: g, homeScore, won, compact })
        }
      }
      if (!cancelled) {
        setWins(w)
        setLosses(l)
        setGameLines(lines)
      }

      setLoading(false)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [tournamentId, teamId, isConfigured, supabaseClient])

  useEffect(() => {
    if (!teamId || !user?.id || !supabaseClient) {
      setCanEditPlacement(false)
      return
    }
    let cancelled = false
    const loadRole = async () => {
      const { data } = await supabaseClient
        .from('team_members')
        .select('role,accepted_at')
        .eq('team_id', teamId)
        .eq('user_id', user.id)
        .maybeSingle()
      if (cancelled) return
      const member = data as { role?: string; accepted_at?: string | null } | null
      setCanEditPlacement(canManageTeam(acceptedTeamRole(member?.role, member?.accepted_at)))
    }
    void loadRole()
    return () => {
      cancelled = true
    }
  }, [teamId, user?.id, supabaseClient])

  useEffect(() => {
    if (tournament?.placement != null) {
      setPlacementDraft(String(tournament.placement))
    } else {
      setPlacementDraft('')
    }
  }, [tournament?.placement, tournament?.id])

  const playerStatMap = useMemo(() => {
    const m: Record<string, Record<string, number>> = {}
    for (const r of statRows) {
      if (!m[r.player_id]) m[r.player_id] = {}
      m[r.player_id][r.stat_id] = r.total
    }
    return m
  }, [statRows])

  const gamesPlayedByPlayer = useMemo(() => {
    const m: Record<string, number> = {}
    for (const r of statRows) {
      m[r.player_id] = Math.max(m[r.player_id] ?? 0, r.games_played)
    }
    return m
  }, [statRows])

  const leaderboardRows = useMemo(() => {
    if (!sport) return []
    return players
      .map(p => {
        const stats = playerStatMap[p.id] ?? {}
        const score = computePlayerScore(sport, stats)
        return { player: p, stats, score, gp: gamesPlayedByPlayer[p.id] ?? 0 }
      })
      .filter(r => Object.keys(r.stats).length > 0)
      .sort((a, b) => b.score - a.score)
  }, [players, playerStatMap, sport, gamesPlayedByPlayer])

  const tournamentTotalsByStat = useMemo(() => {
    const t: Record<string, number> = {}
    for (const r of statRows) {
      t[r.stat_id] = (t[r.stat_id] ?? 0) + r.total
    }
    return t
  }, [statRows])

  const shortLabel = (statId: string) => {
    if (!sport) return statId
    for (const cat of sport.categories) {
      const a = cat.actions.find(x => x.id === statId)
      if (a) return a.shortLabel
    }
    return statId
  }

  const gpTournament = games.length

  const handleSavePlacement = async () => {
    if (!supabaseClient || !tournamentId || !canEditPlacement) return
    setPlacementError(null)
    const trimmed = placementDraft.trim()
    let value: number | null = null
    if (trimmed !== '') {
      const n = parseInt(trimmed, 10)
      if (Number.isNaN(n) || n < 1) {
        setPlacementError('Enter a positive whole number (1 = 1st), or leave blank to clear.')
        return
      }
      value = n
    }
    setSavingPlacement(true)
    const { error: upErr } = await supabaseClient
      .from('tournaments')
      .update({ placement: value })
      .eq('id', tournamentId)
    setSavingPlacement(false)
    if (upErr) {
      setPlacementError(upErr.message)
      return
    }
    setTournament(prev => (prev ? { ...prev, placement: value } : prev))
  }

  if (!tournamentId || !teamId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="card max-w-md w-full text-center">
          <p className="font-semibold text-slate-700 mb-2">Missing parameters</p>
          <button type="button" onClick={() => navigate('/leaderboard')} className="btn-primary w-full">
            Leaderboard
          </button>
        </div>
      </div>
    )
  }

  if (!isConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <p className="text-slate-600">Supabase required</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-slate-500 animate-pulse">Loading tournament…</p>
      </div>
    )
  }

  if (error || !team || !tournament) {
    return (
      <div className="min-h-screen flex flex-col px-4 py-6 max-w-lg mx-auto">
        {error && <div className="card bg-red-50 text-red-700 text-sm mb-4">{error}</div>}
        <button type="button" onClick={() => navigate(teamStatsPath(teamId))} className="btn-primary">
          Back to team stats
        </button>
      </div>
    )
  }

  if (team.seasons.sport === 'soccer') {
    return (
      <SoccerAggregateDestinationPage
        variant="tournament"
        scope={{ type: 'tournament', id: tournamentId }}
        teamIds={[teamId]}
        teamIdForLinks={teamId}
        seasonId={team.season_id}
        title={tournament.name}
        subtitle={`${teamDisplayName(team)} · ${team.seasons.name}`}
        backPath={teamInfoPath(teamId)}
        overviewExtra={
          <div className="space-y-4">
            <section className="flex flex-wrap gap-2">
              <Link
                to={teamStatsPath(teamId)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-sky-700"
              >
                Team stats
              </Link>
              {tournament.url && (
                <a
                  href={tournament.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-sky-700"
                >
                  Tournament site
                </a>
              )}
            </section>
            {(canEditPlacement || tournament.placement != null) && (
              <section>
                <h2 className="font-semibold text-slate-800 mb-2">Placement</h2>
                {canEditPlacement ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="flex-1 min-w-[120px]">
                      <span className="text-xs text-slate-500">Place</span>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={placementDraft}
                        onChange={event => setPlacementDraft(event.target.value)}
                        className="input-field mt-1"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => { void handleSavePlacement() }}
                      disabled={savingPlacement}
                      className="btn-primary py-2 px-4"
                    >
                      {savingPlacement ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                ) : (
                  <p className="text-sm text-slate-600">
                    {placementLabel(tournament.placement)}
                  </p>
                )}
                {placementError && (
                  <p className="text-xs text-red-600 mt-1">{placementError}</p>
                )}
              </section>
            )}
          </div>
        }
      />
    )
  }

  const decided = wins + losses
  const tourScore = sport ? computePlayerScore(sport, tournamentTotalsByStat) : 0

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
            <h1 className="text-lg font-bold truncate">🏆 {tournament.name}</h1>
            <p className="text-sm opacity-80 truncate">
              {sport?.icon} {teamDisplayName(team)} · {team.seasons.name}
            </p>
            {tournament.url && (
              <a
                href={tournament.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-white/90 underline mt-1 inline-block truncate max-w-full"
              >
                Tournament link ↗
              </a>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 px-4 py-6 max-w-lg mx-auto w-full space-y-4">
        <button
          type="button"
          onClick={() => navigate(teamStatsPath(teamId))}
          className="text-sm font-semibold text-blue-600"
        >
          Team stats →
        </button>

        <section className="card space-y-2">
          <h2 className="font-semibold text-slate-700">Record</h2>
          <div className="flex gap-3 flex-wrap">
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-2 text-center flex-1 min-w-[72px]">
              <p className="text-xl font-bold text-emerald-700">{wins}</p>
              <p className="text-xs text-slate-500">W</p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-2 text-center flex-1 min-w-[72px]">
              <p className="text-xl font-bold text-rose-700">{losses}</p>
              <p className="text-xs text-slate-500">L</p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-2 text-center flex-1 min-w-[72px]">
              <p className="text-xl font-bold text-slate-800">{games.length}</p>
              <p className="text-xs text-slate-500">Games</p>
            </div>
            {placementLabel(tournament.placement) && (
              <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-2 text-center flex-1 min-w-[72px]">
                <p className="text-sm font-bold text-amber-900">{placementLabel(tournament.placement)}</p>
                <p className="text-xs text-amber-800/80">Placement</p>
              </div>
            )}
          </div>
          {decided > 0 && (
            <p className="text-xs text-slate-500">{((wins / decided) * 100).toFixed(0)}% wins</p>
          )}
        </section>

        {canEditPlacement && tournament && (
          <section className="card space-y-2">
            <h2 className="font-semibold text-slate-700">Placement</h2>
            <p className="text-xs text-slate-500">
              Set finish place for this tournament (1 = 1st, 2 = 2nd, …). Leave blank to clear.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[100px]">
                <label htmlFor="tournament-placement" className="text-xs text-slate-500 block mb-1">
                  Place
                </label>
                <input
                  id="tournament-placement"
                  type="number"
                  min={1}
                  step={1}
                  value={placementDraft}
                  onChange={e => setPlacementDraft(e.target.value)}
                  placeholder="e.g. 2"
                  className="input-field"
                />
              </div>
              <button
                type="button"
                onClick={() => { void handleSavePlacement() }}
                disabled={savingPlacement}
                className="btn-primary py-2 px-4"
              >
                {savingPlacement ? 'Saving…' : 'Save placement'}
              </button>
            </div>
            {placementError && (
              <p className="text-xs text-red-600">{placementError}</p>
            )}
          </section>
        )}

        {sport && Object.keys(tournamentTotalsByStat).length > 0 && (
          <section className="card space-y-3">
            <h2 className="font-semibold text-slate-700">Tournament totals</h2>
            <p className="text-sm text-slate-600">
              {tourScore} {sport.scoreLabel} · {gpTournament} GP
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {Object.entries(tournamentTotalsByStat).map(([statId, total]) => (
                <div key={statId} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                  <p className="text-xs text-slate-500">{shortLabel(statId)}</p>
                  <p className="font-semibold text-slate-800">{total}</p>
                  {gpTournament > 0 && (
                    <p className="text-xs text-slate-400">{(total / gpTournament).toFixed(1)}/g</p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="card space-y-3">
          <h2 className="font-semibold text-slate-700">Leaderboard</h2>
          {leaderboardRows.length === 0 ? (
            <p className="text-sm text-slate-500">No stats in this tournament yet.</p>
          ) : (
            <div className="space-y-2">
              {leaderboardRows.map((row, idx) => (
                <div
                  key={row.player.id}
                  className="flex items-stretch gap-1 rounded-xl border border-slate-200 bg-white overflow-hidden
                             hover:border-blue-200 transition-colors"
                >
                  <button
                    type="button"
                    onClick={() =>
                      navigate(playerInfoPath(row.player.id, teamId, team.season_id))
                    }
                    className="flex-1 text-left px-3 py-2 hover:bg-blue-50/40 min-w-0"
                  >
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500 w-6 shrink-0">{idx + 1}.</span>
                      <div className="flex-1 min-w-0">
                        <span className="text-slate-500 text-sm">#{row.player.jersey_number || '—'} </span>
                        <span className="font-medium text-slate-800">{playerDisplayName(row.player)}</span>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-semibold text-slate-800">
                          {row.score} {sport?.scoreLabel}
                        </p>
                        <p className="text-xs text-slate-500">{row.gp} GP</p>
                      </div>
                    </div>
                  </button>
                  {team && (
                    <Link
                      to={`/career?playerId=${encodeURIComponent(row.player.id)}&sport=${encodeURIComponent(team.seasons.sport)}`}
                      className="shrink-0 flex items-center px-2.5 text-xs font-semibold text-blue-600 bg-slate-50 border-l border-slate-100 hover:bg-blue-50"
                    >
                      Career
                    </Link>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card space-y-3">
          <h2 className="font-semibold text-slate-700">Games</h2>
          {gameLines.length === 0 ? (
            <p className="text-sm text-slate-500">No finalized games in this tournament.</p>
          ) : (
            <div className="space-y-2">
              {gameLines.map(({ game, homeScore, won, compact }) => (
                <div key={game.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                  <div className="flex justify-between gap-2">
                    <div>
                      <p className="font-medium text-slate-800">{game.game_date}</p>
                      <p className="text-sm text-slate-600">vs {game.opponent_name}</p>
                    </div>
                    <span
                      className={`text-sm font-semibold shrink-0 ${won ? 'text-emerald-700' : 'text-rose-700'}`}
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
