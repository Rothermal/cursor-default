import { useEffect, useMemo, useState, useCallback } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { sports, computePlayerScore } from '../config/sports'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { teamDisplayName, playerDisplayName } from '../lib/display'
import { playerInfoPath, teamInfoPath } from '../lib/teamInfo'
import { sportDashboardPath } from '../lib/sportNavigation'

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

interface SeasonOption {
  id: string
  name: string
}

interface PlayerRow {
  id: string
  first_name: string
  last_name: string | null
  jersey_number: string | null
  nickname: string | null
}

interface SeasonStatRow {
  player_id: string
  stat_id: string
  games_played: number
  total: number
  per_game_avg: number
  season_high: number
}

function uniqueSeasonsFromTeams(teams: TeamRow[]): SeasonOption[] {
  const map = new Map<string, string>()
  for (const t of teams) {
    if (!map.has(t.season_id)) map.set(t.season_id, t.seasons.name)
  }
  return Array.from(map.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export default function Leaderboard() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const teamIdFromUrl = searchParams.get('teamId')
  const seasonIdFromUrl = searchParams.get('seasonId')
  const sportIdFromUrl = searchParams.get('sport')
  const isTeamOrigin = searchParams.get('from') === 'team'

  const { user, isConfigured } = useAuth()
  const supabaseClient = supabase
  const scopedSport = useMemo(
    () => sports.find(item => item.id === sportIdFromUrl) ?? null,
    [sportIdFromUrl]
  )

  const [teams, setTeams] = useState<TeamRow[]>([])
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>('')
  const [selectedTeamId, setSelectedTeamId] = useState<string>('')
  const [players, setPlayers] = useState<PlayerRow[]>([])
  const [seasonStats, setSeasonStats] = useState<SeasonStatRow[]>([])
  const [sortBy, setSortBy] = useState<string>('score')

  const [loadingTeams, setLoadingTeams] = useState(false)
  const [loadingStats, setLoadingStats] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const seasonOptions = useMemo(() => uniqueSeasonsFromTeams(teams), [teams])

  const filteredTeams = useMemo(
    () => (selectedSeasonId ? teams.filter(t => t.season_id === selectedSeasonId) : teams),
    [teams, selectedSeasonId]
  )

  const selectedTeam = useMemo(
    () => teams.find(t => t.id === selectedTeamId) ?? null,
    [teams, selectedTeamId]
  )

  const sport = useMemo(
    () => sports.find(s => s.id === selectedTeam?.seasons?.sport) ?? null,
    [selectedTeam?.seasons?.sport]
  )

  const pushLeaderboardParams = useCallback(
    (seasonId: string, teamId: string) => {
      const next = new URLSearchParams()
      if (seasonId) next.set('seasonId', seasonId)
      if (teamId) next.set('teamId', teamId)
      if (scopedSport) next.set('sport', scopedSport.id)
      if (isTeamOrigin) next.set('from', 'team')
      setSearchParams(next, { replace: true })
    },
    [isTeamOrigin, scopedSport, setSearchParams]
  )

  useEffect(() => {
    if (!isConfigured || !user || !supabaseClient) return

    let cancelled = false
    const loadTeams = async () => {
      setLoadingTeams(true)
      setError(null)
      const { data, error: queryError } = await supabaseClient
        .from('teams')
        .select('id,name,nickname,season_id,seasons!inner(id,name,sport)')
        .order('created_at', { ascending: false })

      if (cancelled) return
      if (queryError) {
        setError(queryError.message)
        setLoadingTeams(false)
        return
      }

      const loadedTeamsAll = (data ?? []) as unknown as TeamRow[]
      const loadedTeams = scopedSport
        ? loadedTeamsAll.filter(team => team.seasons.sport === scopedSport.id)
        : loadedTeamsAll
      setTeams(loadedTeams)

      const seasons = uniqueSeasonsFromTeams(loadedTeams)
      const seasonFromTeam =
        teamIdFromUrl && loadedTeams.find(t => t.id === teamIdFromUrl)?.season_id
      const nextSeasonId =
        (seasonIdFromUrl && seasons.some(s => s.id === seasonIdFromUrl) ? seasonIdFromUrl : null) ??
        (seasonFromTeam && seasons.some(s => s.id === seasonFromTeam) ? seasonFromTeam : null) ??
        seasons[0]?.id ??
        ''

      const inSeason = loadedTeams.filter(t => t.season_id === nextSeasonId)
      const nextTeamId =
        (teamIdFromUrl && inSeason.some(t => t.id === teamIdFromUrl) ? teamIdFromUrl : null) ??
        inSeason[0]?.id ??
        ''

      setSelectedSeasonId(nextSeasonId)
      setSelectedTeamId(nextTeamId)
      setLoadingTeams(false)
      if (nextSeasonId && nextTeamId) {
        pushLeaderboardParams(nextSeasonId, nextTeamId)
      }
    }

    void loadTeams()
    return () => {
      cancelled = true
    }
  }, [isConfigured, supabaseClient, user, teamIdFromUrl, seasonIdFromUrl, pushLeaderboardParams, scopedSport])

  useEffect(() => {
    if (!selectedTeamId || !supabaseClient) {
      setPlayers([])
      setSeasonStats([])
      return
    }

    let cancelled = false
    const load = async () => {
      setLoadingStats(true)
      setError(null)

      const [playersRes, statsRes] = await Promise.all([
        supabaseClient
          .from('team_players')
          .select('jersey_number,players!inner(id,first_name,last_name,nickname)')
          .eq('team_id', selectedTeamId)
          .eq('is_active', true)
          .order('joined_at', { ascending: true }),
        supabaseClient.rpc('get_season_stats_resolved', { p_team_id: selectedTeamId }),
      ])

      if (cancelled) return

      if (playersRes.error) {
        setError(playersRes.error.message)
        setLoadingStats(false)
        return
      }
      if (statsRes.error) {
        setError(statsRes.error.message)
        setLoadingStats(false)
        return
      }

      type TeamPlayerJoin = { jersey_number: string | null; players: { id: string; first_name: string; last_name: string | null; nickname: string | null } }
      setPlayers(((playersRes.data ?? []) as unknown as TeamPlayerJoin[]).map(row => ({
        id: row.players.id,
        first_name: row.players.first_name,
        last_name: row.players.last_name,
        jersey_number: row.jersey_number,
        nickname: row.players.nickname,
      })))
      setSeasonStats((statsRes.data ?? []) as SeasonStatRow[])
      setLoadingStats(false)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [selectedTeamId, supabaseClient])

  const playerStatsMap = useMemo(() => {
    const map: Record<string, Record<string, number>> = {}
    for (const row of seasonStats) {
      if (!map[row.player_id]) map[row.player_id] = {}
      map[row.player_id][row.stat_id] = row.total
    }
    return map
  }, [seasonStats])

  const gamesPlayedByPlayer = useMemo(() => {
    const m: Record<string, number> = {}
    for (const row of seasonStats) {
      const g = row.games_played
      if (!m[row.player_id] || g > m[row.player_id]) m[row.player_id] = g
    }
    return m
  }, [seasonStats])

  const leaderboardRows = useMemo(() => {
    return players
      .map(player => {
        const stats = playerStatsMap[player.id] ?? {}
        const score = sport ? computePlayerScore(sport, stats) : 0
        return { player, stats, score, gamesPlayed: gamesPlayedByPlayer[player.id] ?? 0 }
      })
      .filter(row => Object.keys(row.stats).length > 0)
      .sort((a, b) => {
        if (sortBy === 'score') return b.score - a.score
        const aVal = a.stats[sortBy] ?? 0
        const bVal = b.stats[sortBy] ?? 0
        return bVal - aVal
      })
  }, [players, playerStatsMap, sport, sortBy, gamesPlayedByPlayer])

  const sortOptions = useMemo(() => {
    if (!sport) return [{ id: 'score', label: 'Score' }]
    const opts: { id: string; label: string }[] = [
      { id: 'score', label: sport.scoreLabel },
    ]
    for (const cat of sport.categories) {
      for (const action of cat.actions) {
        opts.push({ id: action.id, label: action.shortLabel })
      }
    }
    return opts
  }, [sport])

  useEffect(() => {
    setSortBy('score')
  }, [selectedTeamId])

  const handleSeasonChange = (nextSeasonId: string) => {
    setSelectedSeasonId(nextSeasonId)
    const nextList = teams.filter(t => t.season_id === nextSeasonId)
    const nextTeamId = nextList[0]?.id ?? ''
    setSelectedTeamId(nextTeamId)
    if (nextSeasonId && nextTeamId) pushLeaderboardParams(nextSeasonId, nextTeamId)
  }

  const handleSelectTeam = (teamId: string) => {
    setSelectedTeamId(teamId)
    if (selectedSeasonId && teamId) pushLeaderboardParams(selectedSeasonId, teamId)
  }

  if (!isConfigured) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="card max-w-md w-full text-center">
          <p className="font-semibold text-slate-700 mb-2">Supabase not configured</p>
          <p className="text-sm text-slate-500 mb-4">
            Configure Supabase to view season stats and leaderboards.
          </p>
          <button onClick={() => navigate('/settings/data')} className="btn-primary w-full">
            Back to Settings
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-gradient-to-r from-slate-700 to-slate-600 text-white px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button
            onClick={() =>
              navigate(
                isTeamOrigin && selectedTeamId
                  ? teamInfoPath(selectedTeamId)
                  : scopedSport
                    ? sportDashboardPath(scopedSport.id)
                    : '/'
              )
            }
            className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center
                       active:scale-90 transition-transform"
          >
            ←
          </button>
          <div>
            <h1 className="text-lg font-bold">
              {scopedSport ? `${scopedSport.name} Season Stats` : 'Season Leaderboard'}
            </h1>
            <p className="text-sm opacity-80">Resolved stats across finalized games</p>
          </div>
        </div>
      </header>

      <div className="flex-1 px-4 py-6 max-w-lg mx-auto w-full space-y-4">
        {error && (
          <div className="card bg-red-50 border-red-200 text-red-700 text-sm">
            {error}
          </div>
        )}

        <section className="card space-y-3">
          <h2 className="font-semibold text-slate-700">Season</h2>
          {loadingTeams ? (
            <p className="text-sm text-slate-500 animate-pulse">Loading...</p>
          ) : seasonOptions.length === 0 ? (
            <p className="text-sm text-slate-500">No teams yet.</p>
          ) : (
            <select
              value={selectedSeasonId}
              onChange={e => handleSeasonChange(e.target.value)}
              className="input-field"
            >
              {seasonOptions.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </section>

        <section className="card space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-slate-700">Team</h2>
            {selectedTeamId && (
              <button
                type="button"
                onClick={() => navigate(`/team-stats?teamId=${selectedTeamId}`)}
                className="text-sm font-semibold text-blue-600 underline"
              >
                Team stats →
              </button>
            )}
          </div>
          {loadingTeams ? (
            <p className="text-sm text-slate-500 animate-pulse">Loading teams...</p>
          ) : filteredTeams.length === 0 ? (
            <p className="text-sm text-slate-500">No teams in this season.</p>
          ) : (
            <div className="space-y-2">
              {filteredTeams.map(team => {
                const s = sports.find(item => item.id === team.seasons.sport)
                return (
                  <button
                    key={team.id}
                    type="button"
                    onClick={() => handleSelectTeam(team.id)}
                    className={`w-full text-left rounded-xl border px-3 py-2 transition-colors ${
                      team.id === selectedTeamId
                        ? 'border-blue-300 bg-blue-50'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    <p className="font-medium text-slate-700">
                      {s?.icon ?? '🏟️'} {teamDisplayName(team)}
                    </p>
                    <p className="text-xs text-slate-500">
                      {s?.name ?? team.seasons.sport}
                    </p>
                  </button>
                )
              })}
            </div>
          )}
        </section>

        {selectedTeam && (
          <section className="card space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold text-slate-700">
                {sport?.icon ?? '🏟️'} {teamDisplayName(selectedTeam)}
              </h2>
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value)}
                className="input-field text-sm py-2 w-auto min-w-[120px]"
              >
                {sortOptions.map(opt => (
                  <option key={opt.id} value={opt.id}>
                    Sort by {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {loadingStats ? (
              <p className="text-sm text-slate-500 animate-pulse">Loading stats...</p>
            ) : leaderboardRows.length === 0 ? (
              <p className="text-sm text-slate-500">
                No finalized games yet. Finalize games to see season stats.
              </p>
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
                        navigate(
                          isTeamOrigin
                            ? playerInfoPath(row.player.id, selectedTeamId, selectedSeasonId)
                            : `/player?teamId=${selectedTeamId}&playerId=${row.player.id}&seasonId=${selectedSeasonId}`
                        )
                      }
                      className="flex-1 text-left px-3 py-2 hover:bg-blue-50/50 active:scale-[0.99] min-w-0"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-slate-400 shrink-0 w-6">
                            {idx + 1}.
                          </span>
                          <span className="text-slate-500 shrink-0">
                            #{row.player.jersey_number || '—'}
                          </span>
                          <p className="font-medium text-slate-700 truncate">
                            {playerDisplayName(row.player)}
                          </p>
                        </div>
                        <div className="flex flex-col items-end shrink-0 text-right">
                          {sport?.scoreLabel && (
                            <span className="font-semibold text-slate-800">
                              {row.score} {sport.scoreLabel}
                            </span>
                          )}
                          <span className="text-xs text-slate-500">
                            {row.gamesPlayed} GP
                          </span>
                        </div>
                      </div>
                    </button>
                    <Link
                      to={`/career?playerId=${encodeURIComponent(row.player.id)}&sport=${encodeURIComponent(selectedTeam.seasons.sport)}`}
                      className="shrink-0 flex items-center px-2.5 text-xs font-semibold text-blue-600 bg-slate-50 border-l border-slate-100 hover:bg-blue-50"
                    >
                      Career
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
