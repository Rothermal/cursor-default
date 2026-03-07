import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useGame } from '../context/GameContext'
import { supabase } from '../lib/supabase'
import { loadCloudGameById, touchCloudGameLastOpened } from '../lib/cloudSync'
import { sports } from '../config/sports'
import type { GameState } from '../types'

interface GameRow {
  id: string
  team_id: string
  opponent_name: string
  opponent_score: number
  game_date: string
  status: string
  created_at: string
}

interface TeamRow {
  id: string
  name: string
  sport: string
}

function statusLabel(status: string): string {
  switch (status) {
    case 'final':
      return 'Final'
    case 'in_progress':
      return 'In Progress'
    case 'scheduled':
      return 'Scheduled'
    default:
      return status
  }
}

function statusBadge(status: string): string {
  switch (status) {
    case 'final':
      return 'bg-emerald-100 text-emerald-700'
    case 'in_progress':
      return 'bg-blue-100 text-blue-700'
    case 'scheduled':
      return 'bg-amber-100 text-amber-700'
    default:
      return 'bg-slate-100 text-slate-600'
  }
}

export default function Games() {
  const navigate = useNavigate()
  const { user, isConfigured } = useAuth()
  const { dispatch } = useGame()
  const userId = user?.id ?? null
  const supabaseClient = supabase

  const [games, setGames] = useState<GameRow[]>([])
  const [teamMap, setTeamMap] = useState<Record<string, TeamRow>>({})
  const [loading, setLoading] = useState(false)
  const [loadingGameId, setLoadingGameId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [editingGameId, setEditingGameId] = useState<string | null>(null)
  const [editingOpponentName, setEditingOpponentName] = useState('')
  const [savingOpponentName, setSavingOpponentName] = useState(false)

  useEffect(() => {
    if (!isConfigured || !userId || !supabaseClient) return

    let cancelled = false
    const loadGames = async () => {
      setLoading(true)
      setError(null)

      const { data: gameRows, error: gamesError } = await supabaseClient
        .from('games')
        .select('id,team_id,opponent_name,opponent_score,game_date,status,created_at')
        .eq('created_by', userId)
        .order('created_at', { ascending: false })

      if (cancelled) return
      if (gamesError) {
        setError(gamesError.message)
        setLoading(false)
        return
      }

      const loadedGames = (gameRows ?? []) as GameRow[]
      setGames(loadedGames)

      const teamIds = [...new Set(loadedGames.map(game => game.team_id))]
      if (teamIds.length === 0) {
        setTeamMap({})
        setLoading(false)
        return
      }

      const { data: teams, error: teamsError } = await supabaseClient
        .from('teams')
        .select('id,name,sport')
        .in('id', teamIds)

      if (cancelled) return
      if (teamsError) {
        setError(teamsError.message)
        setLoading(false)
        return
      }

      const nextTeamMap = ((teams ?? []) as TeamRow[]).reduce<Record<string, TeamRow>>((map, team) => {
        map[team.id] = team
        return map
      }, {})
      setTeamMap(nextTeamMap)
      setLoading(false)
    }

    void loadGames()
    return () => {
      cancelled = true
    }
  }, [isConfigured, supabaseClient, userId])

  const grouped = useMemo(() => {
    const finalGames = games.filter(game => game.status === 'final')
    const activeGames = games.filter(game => game.status !== 'final')
    return { activeGames, finalGames }
  }, [games])

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

  const handleOpenGame = async (gameId: string) => {
    if (!userId) return
    setError(null)
    setLoadingGameId(gameId)
    const cloudGame = await loadCloudGameById(userId, gameId).catch(err => {
      setError(err instanceof Error ? err.message : 'Could not load game')
      setLoadingGameId(null)
      return null
    })

    if (!cloudGame) return
    await touchCloudGameLastOpened(cloudGame.gameId).catch(() => {})

    const sport = sports.find(item => item.id === cloudGame.sportId)
    if (!sport) {
      setError(`Unsupported sport: ${cloudGame.sportId}`)
      setLoadingGameId(null)
      return
    }

    const nextState: GameState = {
      sport,
      gameInfo: cloudGame.gameInfo,
      players: cloudGame.players,
      activePlayerId: cloudGame.activePlayerId,
      opponentScore: cloudGame.opponentScore,
      homeScoreAdjustment: cloudGame.homeScoreAdjustment,
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
    navigate(cloudGame.status === 'final' ? '/summary' : '/game')
  }

  const startEditOpponentName = (game: GameRow) => {
    setEditingGameId(game.id)
    setEditingOpponentName(game.opponent_name)
  }

  const cancelEditOpponentName = () => {
    setEditingGameId(null)
    setEditingOpponentName('')
  }

  const handleSaveOpponentName = async () => {
    if (!supabaseClient || !editingGameId || !editingOpponentName.trim()) return
    setError(null)
    setSavingOpponentName(true)
    const name = editingOpponentName.trim()
    const { error: updateError } = await supabaseClient
      .from('games')
      .update({ opponent_name: name })
      .eq('id', editingGameId)
    setSavingOpponentName(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    setGames(prev =>
      prev.map(g => (g.id === editingGameId ? { ...g, opponent_name: name } : g))
    )
    cancelEditOpponentName()
  }

  const renderGameCard = (game: GameRow) => {
    const team = teamMap[game.team_id]
    const sport = sports.find(item => item.id === team?.sport)
    return (
      <div key={game.id} className="card">
        <div className="flex items-center justify-between mb-2">
          <p className="font-semibold text-slate-700">
            {sport?.icon ?? '🏟️'} {team?.name ?? 'Unknown Team'}
          </p>
          <span className={`text-[11px] px-2 py-1 rounded-full font-semibold ${statusBadge(game.status)}`}>
            {statusLabel(game.status)}
          </span>
        </div>
        {editingGameId === game.id ? (
          <div className="flex gap-2 items-center mt-1">
            <span className="text-sm text-slate-500 shrink-0">vs</span>
            <input
              type="text"
              value={editingOpponentName}
              onChange={e => setEditingOpponentName(e.target.value)}
              className="input-field flex-1 text-sm py-1"
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') void handleSaveOpponentName(); if (e.key === 'Escape') cancelEditOpponentName() }}
            />
            <button
              onClick={() => { void handleSaveOpponentName() }}
              disabled={savingOpponentName || !editingOpponentName.trim()}
              className="btn-primary py-1 px-3 text-sm shrink-0"
            >
              {savingOpponentName ? '...' : 'Save'}
            </button>
            <button
              onClick={cancelEditOpponentName}
              className="border border-slate-300 rounded-lg px-2 py-1 text-sm text-slate-600 shrink-0"
            >
              ✕
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1 mt-1">
            <p className="text-sm text-slate-600">vs {game.opponent_name}</p>
            <button
              onClick={() => startEditOpponentName(game)}
              className="text-slate-300 hover:text-slate-500 transition-colors p-0.5"
              title="Edit opponent name"
              aria-label="Edit opponent name"
            >
              ✏️
            </button>
          </div>
        )}
        <p className="text-xs text-slate-400 mt-1">
          {game.game_date}
        </p>
        <button
          onClick={() => { void handleOpenGame(game.id) }}
          disabled={loadingGameId === game.id}
          className="btn-primary w-full mt-3 py-2"
        >
          {loadingGameId === game.id ? 'Loading...' : game.status === 'final' ? 'View Summary' : 'Resume Game'}
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-gradient-to-r from-slate-700 to-slate-600 text-white px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center
                       active:scale-90 transition-transform"
          >
            ←
          </button>
          <div>
            <h1 className="text-lg font-bold">Cloud Games</h1>
            <p className="text-sm opacity-80">Resume or review saved games</p>
          </div>
        </div>
      </header>

      <div className="flex-1 px-4 py-6 max-w-lg mx-auto w-full space-y-4">
        {error && (
          <div className="card bg-red-50 border-red-200 text-red-700 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="card text-sm text-slate-500 animate-pulse">Loading games...</div>
        ) : games.length === 0 ? (
          <div className="card text-center py-10">
            <p className="text-3xl mb-2">📚</p>
            <p className="text-slate-500">No cloud games yet.</p>
          </div>
        ) : (
          <>
            {grouped.activeGames.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  Active / Scheduled
                </h2>
                <div className="space-y-2">
                  {grouped.activeGames.map(renderGameCard)}
                </div>
              </section>
            )}

            {grouped.finalGames.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  Final Games
                </h2>
                <div className="space-y-2">
                  {grouped.finalGames.map(renderGameCard)}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
