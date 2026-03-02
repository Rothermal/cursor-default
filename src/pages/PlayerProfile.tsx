import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { sports } from '../config/sports'
import { useAuth } from '../context/AuthContext'
import { useGame } from '../context/GameContext'
import { supabase } from '../lib/supabase'
import { loadCloudGameById, touchCloudGameLastOpened } from '../lib/cloudSync'
import type { GameState } from '../types'

interface TeamRow {
  id: string
  name: string
  nickname: string | null
  sport: string
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

function playerDisplayName(player: PlayerRow): string {
  const n = player.nickname?.trim()
  if (n) return n
  return [player.first_name, player.last_name].filter(Boolean).join(' ').trim() || 'Player'
}

function getStatShortLabel(sportId: string, statId: string): string {
  const sport = sports.find(s => s.id === sportId)
  if (!sport) return statId
  for (const cat of sport.categories) {
    const action = cat.actions.find(a => a.id === statId)
    if (action) return action.shortLabel
  }
  return statId
}

export default function PlayerProfile() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const teamId = searchParams.get('teamId')
  const playerId = searchParams.get('playerId')

  const { user, isConfigured } = useAuth()
  const { dispatch } = useGame()
  const supabaseClient = supabase

  const [team, setTeam] = useState<TeamRow | null>(null)
  const [player, setPlayer] = useState<PlayerRow | null>(null)
  const [seasonStats, setSeasonStats] = useState<SeasonStatRow[]>([])
  const [gameLog, setGameLog] = useState<GameLogRow[]>([])

  const [loading, setLoading] = useState(true)
  const [loadingGameId, setLoadingGameId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const sport = useMemo(
    () => sports.find(s => s.id === team?.sport) ?? null,
    [team?.sport]
  )

  useEffect(() => {
    if (!teamId || !playerId || !isConfigured || !supabaseClient) {
      setLoading(false)
      return
    }

    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)

      const [teamRes, playerRes, statsRes, gameStatsRes] = await Promise.all([
        supabaseClient.from('teams').select('id,name,nickname,sport').eq('id', teamId).single(),
        supabaseClient.from('players').select('id,first_name,last_name,jersey_number,nickname').eq('id', playerId).single(),
        supabaseClient.rpc('get_season_stats_resolved', { p_team_id: teamId }),
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

      setTeam(teamRes.data as TeamRow)
      setPlayer(playerRes.data as PlayerRow)
      setSeasonStats((statsRes.data ?? []).filter((r: SeasonStatRow) => r.player_id === playerId) as SeasonStatRow[])

      const gameIds = [...new Set(((gameStatsRes.data ?? []) as { game_id: string }[]).map(r => r.game_id))]
      if (gameIds.length === 0) {
        setGameLog([])
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
      setLoading(false)
    }

    void load()
    return () => { cancelled = true }
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
      actionLog: [],
      cloudSync: {
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

  const gamesPlayed = seasonStats[0]?.games_played ?? 0

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-gradient-to-r from-slate-700 to-slate-600 text-white px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button
            onClick={() => navigate(`/leaderboard`)}
            className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center
                       active:scale-90 transition-transform"
          >
            ←
          </button>
          <div>
            <h1 className="text-lg font-bold">Player Profile</h1>
            <p className="text-sm opacity-80">
              #{player.jersey_number || '—'} {playerDisplayName(player)}
            </p>
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
          <h2 className="font-semibold text-slate-700">Season Totals</h2>
          {seasonStats.length === 0 ? (
            <p className="text-sm text-slate-500">No finalized games yet.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {seasonStats.map(row => (
                <div
                  key={row.stat_id}
                  className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
                >
                  <p className="text-xs text-slate-500 uppercase tracking-wide">
                    {getStatShortLabel(team.sport, row.stat_id)}
                  </p>
                  <p className="font-semibold text-slate-800">{row.total}</p>
                  <p className="text-xs text-slate-400">
                    {row.per_game_avg.toFixed(1)}/game · high {row.season_high}
                  </p>
                </div>
              ))}
            </div>
          )}
          {gamesPlayed > 0 && (
            <p className="text-xs text-slate-500">
              {gamesPlayed} game{gamesPlayed !== 1 ? 's' : ''} played
            </p>
          )}
        </section>

        <section className="card space-y-3">
          <h2 className="font-semibold text-slate-700">Game Log</h2>
          {gameLog.length === 0 ? (
            <p className="text-sm text-slate-500">No games yet.</p>
          ) : (
            <div className="space-y-2">
              {gameLog.map(game => (
                <div
                  key={game.id}
                  className="flex items-center justify-between rounded-xl border border-slate-200
                             bg-white px-3 py-2"
                >
                  <div>
                    <p className="font-medium text-slate-700">{game.game_date}</p>
                    <p className="text-sm text-slate-500">vs {game.opponent_name}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleViewGame(game.id)}
                    disabled={loadingGameId === game.id}
                    className="btn-primary py-2 px-4 text-sm"
                  >
                    {loadingGameId === game.id ? 'Loading...' : 'View'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
