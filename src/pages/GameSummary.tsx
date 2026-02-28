import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGame } from '../context/GameContext'
import { computePlayerScore, computeCategoryTotal } from '../config/sports'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

/** Resolved stats by remote player id -> stat id -> value (for final cloud games) */
type ResolvedStatsMap = Record<string, Record<string, number>>

export default function GameSummary() {
  const navigate = useNavigate()
  const { state, dispatch } = useGame()
  const { user, isConfigured } = useAuth()
  const { sport, gameInfo, players, opponentScore } = state
  const [finalizing, setFinalizing] = useState(false)
  const [finalizeError, setFinalizeError] = useState<string | null>(null)
  const [resolvedStats, setResolvedStats] = useState<ResolvedStatsMap | null>(null)
  const [isTeamAdmin, setIsTeamAdmin] = useState(false)
  const [reviewMode, setReviewMode] = useState(false)
  const [correcting, setCorrecting] = useState<{
    playerId: string
    playerName: string
    statId: string
    statLabel: string
    currentValue: number
  } | null>(null)
  const [correctValue, setCorrectValue] = useState('')
  const [correctReason, setCorrectReason] = useState('')
  const [correctError, setCorrectError] = useState<string | null>(null)
  const [savingCorrection, setSavingCorrection] = useState(false)
  const [resolvedKey, setResolvedKey] = useState(0)

  const isFinalCloudGame = state.cloudSync.gameStatus === 'final'
  const gameId = state.cloudSync.gameId
  const teamId = state.cloudSync.teamId
  const playerIdMap = state.cloudSync.playerIdMap

  const loadResolved = useCallback(async () => {
    const client = supabase
    if (!gameId || !client) return null

    const { data, error } = await client.rpc('get_game_stats_resolved', {
      p_game_id: gameId,
    })
    if (error) return null

    const byPlayer: ResolvedStatsMap = {}
    for (const row of (data ?? []) as Array<{ player_id: string; stat_id: string; value: number }>) {
      if (!byPlayer[row.player_id]) byPlayer[row.player_id] = {}
      byPlayer[row.player_id][row.stat_id] = row.value
    }
    return byPlayer
  }, [gameId])

  useEffect(() => {
    if (!isFinalCloudGame || !gameId || !supabase) return

    let cancelled = false
    const load = async () => {
      const byPlayer = await loadResolved()
      if (cancelled || !byPlayer) return
      setResolvedStats(byPlayer)
    }

    void load()
    return () => { cancelled = true }
  }, [isFinalCloudGame, gameId, resolvedKey, loadResolved])

  useEffect(() => {
    const client = supabase
    if (!isFinalCloudGame || !teamId || !user || !client) return

    let cancelled = false
    const loadRole = async () => {
      const { data } = await client
        .from('team_members')
        .select('role')
        .eq('team_id', teamId)
        .eq('user_id', user.id)
        .maybeSingle()

      if (cancelled) return
      const role = (data as { role?: string } | null)?.role
      setIsTeamAdmin(role === 'owner' || role === 'admin')
    }

    void loadRole()
    return () => { cancelled = true }
  }, [isFinalCloudGame, teamId, user])

  if (!sport || !gameInfo) {
    navigate('/')
    return null
  }

  const getPlayerStats = (playerId: string): Record<string, number> => {
    const remoteId = playerIdMap[playerId] ?? playerId
    const player = players.find(p => p.id === playerId)
    if (isFinalCloudGame && resolvedStats && resolvedStats[remoteId]) {
      return resolvedStats[remoteId]
    }
    return player?.stats ?? {}
  }

  const teamScore = players.reduce(
    (total, player) => total + computePlayerScore(sport, getPlayerStats(player.id)),
    0
  )

  const allStatIds = sport.categories.flatMap(c => c.actions.map(a => a.id))

  const teamTotals: Record<string, number> = {}
  for (const statId of allStatIds) {
    teamTotals[statId] = players.reduce(
      (sum, p) => sum + (getPlayerStats(p.id)[statId] || 0),
      0
    )
  }

  const handleNewGame = () => {
    dispatch({ type: 'RESET_GAME' })
    navigate('/')
  }

  const handleOpenCorrect = (
    playerId: string,
    playerName: string,
    statId: string,
    statLabel: string,
    currentValue: number
  ) => {
    setCorrecting({ playerId, playerName, statId, statLabel, currentValue })
    setCorrectValue(String(currentValue))
    setCorrectReason('')
    setCorrectError(null)
  }

  const handleCloseCorrect = () => {
    setCorrecting(null)
    setCorrectError(null)
  }

  const handleSaveCorrection = async () => {
    if (!correcting || !gameId || !user || !supabase) return
    const client = supabase
    const value = parseInt(correctValue, 10)
    if (Number.isNaN(value) || value < 0) {
      setCorrectError('Enter a valid number (0 or more)')
      return
    }

    setSavingCorrection(true)
    setCorrectError(null)
    const remotePlayerId = playerIdMap[correcting.playerId] ?? correcting.playerId

    const { error } = await client
      .from('stat_corrections')
      .upsert(
        {
          game_id: gameId,
          player_id: remotePlayerId,
          stat_id: correcting.statId,
          corrected_value: value,
          corrected_by: user.id,
          reason: correctReason.trim() || null,
          original_primary_value: correcting.currentValue,
        },
        { onConflict: ['game_id', 'player_id', 'stat_id'] }
      )

    setSavingCorrection(false)
    if (error) {
      setCorrectError(error.message)
      return
    }
    setResolvedKey(k => k + 1)
    handleCloseCorrect()
  }

  const canFinalizeCloudGame = Boolean(
    isConfigured && user && supabase && state.cloudSync.gameId && !isFinalCloudGame
  )
  const handleFinalizeCloudGame = async () => {
    if (!canFinalizeCloudGame || !state.cloudSync.gameId) return
    setFinalizeError(null)
    setFinalizing(true)

    const { error } = await supabase!
      .from('games')
      .update({
        status: 'final',
        opponent_score: opponentScore,
      })
      .eq('id', state.cloudSync.gameId)

    setFinalizing(false)
    if (error) {
      setFinalizeError(error.message)
      return
    }

    dispatch({ type: 'RESET_GAME' })
    navigate('/games')
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className={`bg-gradient-to-r ${sport.theme.gradient} text-white px-4 py-6`}>
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={() => navigate(isFinalCloudGame ? '/games' : '/game')}
              className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center
                         active:scale-90 transition-transform"
            >
              ←
            </button>
            <h1 className="text-lg font-bold">Game Summary</h1>
          </div>

          <div className="flex items-center justify-center gap-6">
            <div className="text-center">
              <p className="text-sm opacity-80">{gameInfo.teamName}</p>
              <p className="text-4xl font-bold">{teamScore}</p>
            </div>
            <p className="text-xl opacity-60">vs</p>
            <div className="text-center">
              <p className="text-sm opacity-80">{gameInfo.opponentName}</p>
              <p className="text-4xl font-bold">{opponentScore}</p>
            </div>
          </div>

          {gameInfo.tournamentName && (
            <p className="text-center text-sm opacity-60 mt-2">{gameInfo.tournamentName}</p>
          )}
          <p className="text-center text-xs opacity-40 mt-1">{gameInfo.date}</p>
        </div>
      </header>

      <div className="flex-1 px-4 py-6 max-w-2xl mx-auto w-full">
        {finalizeError && (
          <div className="card bg-red-50 border-red-200 text-red-700 text-sm mb-4">
            {finalizeError}
          </div>
        )}

        {isFinalCloudGame && isTeamAdmin && (
          <div className="mb-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setReviewMode(!reviewMode)}
              className={reviewMode ? 'btn-primary py-2' : 'btn-secondary py-2'}
            >
              {reviewMode ? 'Done reviewing' : 'Review / Correct stats'}
            </button>
            {reviewMode && (
              <span className="text-xs text-slate-500">Tap a stat to correct it</span>
            )}
          </div>
        )}

        {sport.categories.map(category => (
          <div key={category.id} className="mb-6">
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">
              {category.name}
              {category.showTotal && (
                <span className="text-slate-400 ml-2 normal-case">
                  — {category.totalLabel}
                </span>
              )}
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-2 pr-3 font-semibold text-slate-600">Player</th>
                    {category.actions.map(action => (
                      <th
                        key={action.id}
                        className="text-center py-2 px-2 font-semibold text-slate-600 min-w-[40px]"
                      >
                        {action.shortLabel}
                      </th>
                    ))}
                    {category.showTotal && (
                      <th className="text-center py-2 px-2 font-bold text-slate-700 min-w-[50px]">
                        TOT
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {players.map(player => {
                    const stats = getPlayerStats(player.id)
                    const catTotal = category.showTotal
                      ? category.actions.some(a => a.pointValue)
                        ? category.actions.reduce(
                            (sum, a) => sum + (stats[a.id] || 0) * (a.pointValue || 0),
                            0
                          )
                        : computeCategoryTotal(category, stats)
                      : null

                    return (
                      <tr key={player.id} className="border-b border-slate-100">
                        <td className="py-2 pr-3 whitespace-nowrap">
                          <span className="text-slate-400 mr-1">#{player.number || '?'}</span>
                          <span className="font-medium">{player.name}</span>
                        </td>
                        {category.actions.map(action => (
                          <td key={action.id} className="text-center py-2 px-2 tabular-nums">
                            <span className="inline-flex items-center gap-1">
                              {stats[action.id] || 0}
                              {reviewMode && isFinalCloudGame && isTeamAdmin && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleOpenCorrect(
                                      player.id,
                                      player.name,
                                      action.id,
                                      action.shortLabel,
                                      stats[action.id] || 0
                                    )
                                  }
                                  className="text-slate-400 hover:text-blue-600 p-0.5"
                                  title="Correct this stat"
                                  aria-label="Correct stat"
                                >
                                  ✏️
                                </button>
                              )}
                            </span>
                          </td>
                        ))}
                        {category.showTotal && (
                          <td className="text-center py-2 px-2 font-bold tabular-nums">
                            {catTotal}
                          </td>
                        )}
                      </tr>
                    )
                  })}
                  <tr className="bg-slate-50 font-semibold">
                    <td className="py-2 pr-3">Team</td>
                    {category.actions.map(action => (
                      <td key={action.id} className="text-center py-2 px-2 tabular-nums">
                        {teamTotals[action.id] || 0}
                      </td>
                    ))}
                    {category.showTotal && (
                      <td className="text-center py-2 px-2 font-bold tabular-nums">
                        {category.actions.some(a => a.pointValue)
                          ? category.actions.reduce(
                              (sum, a) => sum + (teamTotals[a.id] || 0) * (a.pointValue || 0),
                              0
                            )
                          : computeCategoryTotal(category, teamTotals)
                        }
                      </td>
                    )}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        ))}

        <div className="mt-8 space-y-3">
          {canFinalizeCloudGame && (
            <button
              onClick={() => { void handleFinalizeCloudGame() }}
              disabled={finalizing}
              className="btn-primary w-full"
            >
              {finalizing ? 'Finalizing...' : 'Finalize Game & Save to History'}
            </button>
          )}
          {isFinalCloudGame ? (
            <button
              onClick={() => navigate('/games')}
              className="btn-secondary w-full"
            >
              ← Back to Cloud Games
            </button>
          ) : (
            <button
              onClick={() => navigate('/game')}
              className="btn-primary w-full"
            >
              ← Back to Game
            </button>
          )}
          <button
            onClick={handleNewGame}
            className="btn-secondary w-full"
          >
            New Game
          </button>
        </div>

        {correcting && (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-10"
            onClick={handleCloseCorrect}
            role="dialog"
            aria-modal="true"
            aria-labelledby="correct-stat-title"
          >
            <div
              className="card max-w-sm w-full"
              onClick={e => e.stopPropagation()}
            >
              <h3 id="correct-stat-title" className="font-semibold text-slate-700 mb-3">
                Correct stat
              </h3>
              <p className="text-sm text-slate-600 mb-2">
                {correcting.playerName} — {correcting.statLabel}
              </p>
              <p className="text-xs text-slate-500 mb-3">
                Current value: {correcting.currentValue}
              </p>
              {correctError && (
                <div className="mb-3 text-sm text-red-600">{correctError}</div>
              )}
              <input
                type="number"
                min={0}
                value={correctValue}
                onChange={e => setCorrectValue(e.target.value)}
                className="input-field mb-3"
                placeholder="New value"
              />
              <input
                type="text"
                value={correctReason}
                onChange={e => setCorrectReason(e.target.value)}
                className="input-field mb-4"
                placeholder="Reason (optional)"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleSaveCorrection}
                  disabled={savingCorrection}
                  className="btn-primary flex-1"
                >
                  {savingCorrection ? 'Saving...' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={handleCloseCorrect}
                  className="btn-secondary flex-1"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
