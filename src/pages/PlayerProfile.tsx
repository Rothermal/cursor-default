import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { sports } from '../config/sports'
import { useAuth } from '../context/AuthContext'
import { useGame } from '../context/GameContext'
import { supabase } from '../lib/supabase'
import { loadCloudGameById, touchCloudGameLastOpened } from '../lib/cloudSync'
import type { GameState } from '../types'
import { playerDisplayName, teamDisplayName } from '../lib/display'
import { formatCompactGameStatLine } from '../lib/statDisplay'
import PlayerStatSummaryTables, { type StatHighGameMap } from '../components/PlayerStatSummaryTables'
import { buildResolvedByGameForPlayer } from '../lib/playerStatSummaryTables'

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

interface GameLogRow {
  id: string
  game_date: string
  opponent_name: string
}

interface GameLogLineRow {
  game_id: string
  game_date: string
  opponent_name: string
  stat_id: string
  value: number
}

function isMissingRpcError(msg: string): boolean {
  return msg.includes('does not exist') || msg.includes('function')
}

export default function PlayerProfile() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const teamId = searchParams.get('teamId')
  const playerId = searchParams.get('playerId')
  const seasonIdFromUrl = searchParams.get('seasonId')

  const { user, isConfigured } = useAuth()
  const { dispatch } = useGame()
  const supabaseClient = supabase

  const [team, setTeam] = useState<TeamRow | null>(null)
  const [player, setPlayer] = useState<PlayerRow | null>(null)
  const [seasonStats, setSeasonStats] = useState<SeasonStatRow[]>([])
  const [gameLog, setGameLog] = useState<GameLogRow[]>([])
  const [gameLogLines, setGameLogLines] = useState<GameLogLineRow[]>([])

  const [loading, setLoading] = useState(true)
  const [loadingGameId, setLoadingGameId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [profileHighGames, setProfileHighGames] = useState<StatHighGameMap>({})
  const [profileResolvedByGame, setProfileResolvedByGame] = useState<Record<string, Record<string, number>>>({})
  const [loadingProfileHighs, setLoadingProfileHighs] = useState(false)

  const sport = useMemo(
    () => sports.find(s => s.id === team?.seasons?.sport) ?? null,
    [team?.seasons?.sport]
  )

  const seasonStatsRecord = useMemo(() => {
    const m: Record<string, number> = {}
    for (const r of seasonStats) {
      m[r.stat_id] = r.total
    }
    return m
  }, [seasonStats])

  const statsByGame = useMemo(() => {
    const m = new Map<string, Record<string, number>>()
    for (const row of gameLogLines) {
      if (!m.has(row.game_id)) m.set(row.game_id, {})
      m.get(row.game_id)![row.stat_id] = row.value
    }
    return m
  }, [gameLogLines])

  useEffect(() => {
    if (!teamId || !playerId || !isConfigured || !supabaseClient) {
      setLoading(false)
      return
    }

    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)

      const [teamRes, playerRes, statsRes, logRpcRes, gameStatsRes] = await Promise.all([
        supabaseClient.from('teams').select('id,name,nickname,season_id,seasons!inner(id,name,sport)').eq('id', teamId).single(),
        supabaseClient
          .from('team_players')
          .select('jersey_number,players!inner(id,first_name,last_name,nickname)')
          .eq('team_id', teamId)
          .eq('player_id', playerId)
          .single(),
        supabaseClient.rpc('get_season_stats_resolved', { p_team_id: teamId }),
        supabaseClient.rpc('get_player_game_log', {
          p_player_id: playerId,
          p_team_id: teamId,
        }),
        supabaseClient.from('game_stats').select('game_id').eq('player_id', playerId),
      ])

      if (cancelled) return

      if (teamRes.error || !teamRes.data) {
        setError(teamRes.error?.message ?? 'Team not found')
        setLoading(false)
        return
      }
      if (playerRes.error || !playerRes.data) {
        setError(playerRes.error?.message ?? 'Player not found')
        setLoading(false)
        return
      }
      if (statsRes.error) {
        setError(statsRes.error.message)
        setLoading(false)
        return
      }

      setTeam(teamRes.data as unknown as TeamRow)
      const tp = playerRes.data as unknown as { jersey_number: string | null; players: { id: string; first_name: string; last_name: string | null; nickname: string | null } }
      setPlayer({
        id: tp.players.id,
        first_name: tp.players.first_name,
        last_name: tp.players.last_name,
        jersey_number: tp.jersey_number,
        nickname: tp.players.nickname,
      } as PlayerRow)
      setSeasonStats((statsRes.data ?? []).filter((r: SeasonStatRow) => r.player_id === playerId) as SeasonStatRow[])

      if (!logRpcRes.error) {
        setGameLogLines((logRpcRes.data ?? []) as GameLogLineRow[])
      } else if (isMissingRpcError(logRpcRes.error.message)) {
        setGameLogLines([])
      } else {
        setError(logRpcRes.error.message)
        setLoading(false)
        return
      }

      const gameIds = [...new Set(((gameStatsRes.data ?? []) as { game_id: string }[]).map(r => r.game_id))]
      if (gameIds.length === 0) {
        setGameLog([])
        setProfileHighGames({})
        setProfileResolvedByGame({})
        setLoadingProfileHighs(false)
        setLoading(false)
        return
      }

      const gamesRes = await supabaseClient
        .from('games')
        .select('id,game_date,opponent_name')
        .eq('team_id', teamId)
        .eq('status', 'final')
        .in('id', gameIds)
        .order('game_date', { ascending: false })

      if (cancelled) return
      if (gamesRes.error) {
        setError(gamesRes.error.message)
      } else {
        setGameLog((gamesRes.data ?? []) as GameLogRow[])
      }

      if (logRpcRes.error && isMissingRpcError(logRpcRes.error.message) && gamesRes.data?.length) {
        const lines: GameLogLineRow[] = []
        for (const g of gamesRes.data as GameLogRow[]) {
          const res = await supabaseClient.rpc('get_game_stats_resolved', { p_game_id: g.id })
          if (res.error) continue
          for (const row of (res.data ?? []) as { player_id: string; stat_id: string; value: number }[]) {
            if (row.player_id === playerId) {
              lines.push({
                game_id: g.id,
                game_date: g.game_date,
                opponent_name: g.opponent_name,
                stat_id: row.stat_id,
                value: row.value,
              })
            }
          }
        }
        if (!cancelled) setGameLogLines(lines)
      }

      setLoadingProfileHighs(true)
      const hgRes = await supabaseClient.rpc('get_player_stat_high_games_for_team', {
        p_player_id: playerId,
        p_team_id: teamId,
      })
      if (!cancelled) {
        if (hgRes.error) {
          setProfileHighGames({})
          setProfileResolvedByGame({})
        } else {
          const highs: StatHighGameMap = {}
          const highGameIds: string[] = []
          for (const row of (hgRes.data ?? []) as Array<{ stat_id: string; game_id: string; value: number }>) {
            highs[row.stat_id] = { game_id: row.game_id, value: row.value }
            if (!highGameIds.includes(row.game_id)) highGameIds.push(row.game_id)
          }
          setProfileHighGames(highs)
          const results = await Promise.all(
            highGameIds.map(gid => supabaseClient.rpc('get_game_stats_resolved', { p_game_id: gid }))
          )
          if (!cancelled) {
            const rowsByGame = results.map(
              r => (r.data ?? []) as Array<{ player_id: string; stat_id: string; value: number }>
            )
            setProfileResolvedByGame(buildResolvedByGameForPlayer(highGameIds, playerId, rowsByGame))
          }
        }
        setLoadingProfileHighs(false)
      }

      setLoading(false)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [teamId, playerId, isConfigured, supabaseClient])

  const handleViewGame = async (gameId: string) => {
    if (!user) return
    setError(null)
    setLoadingGameId(gameId)

    const cloudGame = await loadCloudGameById(user.id, gameId).catch(err => {
      setError(err instanceof Error ? err.message : 'Could not load game')
      setLoadingGameId(null)
      return null
    })

    if (!cloudGame || !sport) {
      setLoadingGameId(null)
      return
    }

    await touchCloudGameLastOpened(cloudGame.gameId).catch(() => {})

    const nextState: GameState = {
      sport,
      gameInfo: cloudGame.gameInfo,
      players: cloudGame.players,
      activePlayerId: cloudGame.activePlayerId,
      opponentScore: cloudGame.opponentScore,
      homeTeamScore: cloudGame.homeTeamScore,
      homeScoreAdjustment: cloudGame.homeScoreAdjustment,
      notes: cloudGame.notes,
      currentPeriod: 1,
      teamStatsConfig: null,
      actionLog: [],
      shotChart: cloudGame.shotChart ?? [],
      cloudSync: {
        seasonId: cloudGame.seasonId ?? null,
        teamId: cloudGame.teamId,
        gameId: cloudGame.gameId,
        gameStatus: cloudGame.status,
        playerIdMap: cloudGame.playerIdMap,
        status: 'synced',
        lastSyncedAt: cloudGame.hydratedAt,
        lastError: null,
      },
    }

    dispatch({ type: 'HYDRATE_STATE', state: nextState })
    setLoadingGameId(null)
    navigate('/summary')
  }

  const leaderboardHref = team
    ? `/leaderboard?teamId=${team.id}&seasonId=${team.season_id}`
    : '/leaderboard'

  if (!teamId || !playerId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="card max-w-md w-full text-center">
          <p className="font-semibold text-slate-700 mb-2">Missing parameters</p>
          <p className="text-sm text-slate-500 mb-4">
            Open a player from the leaderboard to view their profile.
          </p>
          <button onClick={() => navigate('/leaderboard')} className="btn-primary w-full">
            Back to Leaderboard
          </button>
        </div>
      </div>
    )
  }

  if (!isConfigured) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="card max-w-md w-full text-center">
          <p className="font-semibold text-slate-700 mb-2">Supabase not configured</p>
          <button onClick={() => navigate('/')} className="btn-primary w-full mt-3">
            Back Home
          </button>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-slate-500 animate-pulse">Loading profile...</p>
      </div>
    )
  }

  if (!player || !team) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="card max-w-md w-full text-center">
          <p className="font-semibold text-slate-700 mb-2">Player not found</p>
          <button onClick={() => navigate('/leaderboard')} className="btn-primary w-full mt-3">
            Back to Leaderboard
          </button>
        </div>
      </div>
    )
  }

  const gamesPlayed = seasonStats.reduce(
    (max, row) => (row.games_played > max ? row.games_played : max),
    0
  )

  const careerQuery = seasonIdFromUrl
    ? `playerId=${encodeURIComponent(playerId)}&sport=${encodeURIComponent(team.seasons.sport)}`
    : `playerId=${encodeURIComponent(playerId)}&sport=${encodeURIComponent(team.seasons.sport)}`

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-gradient-to-r from-slate-700 to-slate-600 text-white px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button
            onClick={() => navigate(leaderboardHref)}
            className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center
                       active:scale-90 transition-transform"
          >
            ←
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold">Player Profile</h1>
            <p className="text-sm opacity-80">
              #{player.jersey_number || '—'} {playerDisplayName(player)}
            </p>
            <p className="text-xs opacity-70 truncate">
              {teamDisplayName(team)} · {team.seasons.name}
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate(`/career?${careerQuery}`)}
            className="shrink-0 text-xs font-semibold bg-white/20 hover:bg-white/30 rounded-lg px-2 py-1.5"
          >
            Career →
          </button>
        </div>
      </header>

      <div className="flex-1 px-4 py-6 max-w-lg mx-auto w-full space-y-4">
        {error && (
          <div className="card bg-red-50 border-red-200 text-red-700 text-sm">
            {error}
          </div>
        )}

        {sport && seasonStats.length > 0 ? (
          <PlayerStatSummaryTables
            sport={sport}
            statsRecord={seasonStatsRecord}
            gamesPlayed={gamesPlayed}
            highGames={profileHighGames}
            resolvedByGame={profileResolvedByGame}
            onOpenGame={gid => { void handleViewGame(gid) }}
            loadingHigh={loadingProfileHighs}
            title="Season totals"
            description="Same layout as game summary. Tap Best game to open that final (migration 026)."
            footer={
              gamesPlayed > 0 ? (
                <span>
                  {gamesPlayed} game{gamesPlayed !== 1 ? 's' : ''} played
                </span>
              ) : null
            }
          />
        ) : (
          <section className="card space-y-3">
            <h2 className="font-semibold text-slate-700">Season totals</h2>
            <p className="text-sm text-slate-500">No finalized games yet.</p>
          </section>
        )}

        <section className="card space-y-3">
          <h2 className="font-semibold text-slate-700">Game Log</h2>
          {gameLog.length === 0 ? (
            <p className="text-sm text-slate-500">No games yet.</p>
          ) : (
            <div className="space-y-2">
              {gameLog.map(game => {
                const statMap = statsByGame.get(game.id) ?? {}
                const line =
                  sport && Object.keys(statMap).length > 0
                    ? formatCompactGameStatLine(sport, statMap)
                    : null
                return (
                  <div
                    key={game.id}
                    className="flex flex-col gap-1 rounded-xl border border-slate-200
                               bg-white px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-slate-700">{game.game_date}</p>
                        <p className="text-sm text-slate-500">vs {game.opponent_name}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleViewGame(game.id)}
                        disabled={loadingGameId === game.id}
                        className="btn-primary py-2 px-4 text-sm shrink-0"
                      >
                        {loadingGameId === game.id ? 'Loading...' : 'View'}
                      </button>
                    </div>
                    {line && (
                      <p className="text-xs text-slate-500 pl-0.5">{line}</p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
