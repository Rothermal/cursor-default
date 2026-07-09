import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useGame, GAME_STORAGE_KEY } from '../context/GameContext'
import { supabase } from '../lib/supabase'

/**
 * Finalize an in-progress cloud game: flush sync → mark final → clear local → reset.
 * Order is intentional — do not reorder (avoids final + in-progress duplicates).
 */
export function useFinalizeGame() {
  const navigate = useNavigate()
  const { state, dispatch, flushCloudSync } = useGame()
  const { user, isConfigured } = useAuth()
  const [finalizing, setFinalizing] = useState(false)
  const [finalizeError, setFinalizeError] = useState<string | null>(null)

  const isFinalCloudGame = state.cloudSync.gameStatus === 'final'
  const canFinalizeCloudGame = Boolean(
    isConfigured && user && supabase && state.cloudSync.gameId && !isFinalCloudGame
  )

  const handleFinalizeCloudGame = async () => {
    if (!canFinalizeCloudGame || !state.cloudSync.gameId) return
    setFinalizeError(null)
    setFinalizing(true)

    const syncResult = await flushCloudSync()
    if (!syncResult.ok) {
      setFinalizing(false)
      setFinalizeError(syncResult.reason)
      return
    }

    const { opponentScore, homeTeamScore, homeScoreAdjustment } = state

    const initial = await supabase!
      .from('games')
      .update({
        status: 'final',
        opponent_score: opponentScore,
        home_team_score: homeTeamScore,
        home_score_adjustment: homeScoreAdjustment,
      })
      .eq('id', state.cloudSync.gameId)

    let updateError = initial.error
    if (
      updateError &&
      updateError.message?.includes('home_team_score') &&
      updateError.message?.includes('column')
    ) {
      const retry = await supabase!
        .from('games')
        .update({
          status: 'final',
          opponent_score: opponentScore,
          home_score_adjustment: homeScoreAdjustment,
        })
        .eq('id', state.cloudSync.gameId)
      updateError = retry.error ?? null
    }
    if (
      updateError &&
      updateError.message?.includes('home_score_adjustment') &&
      updateError.message?.includes('column')
    ) {
      const retry = await supabase!
        .from('games')
        .update({
          status: 'final',
          opponent_score: opponentScore,
        })
        .eq('id', state.cloudSync.gameId)
      updateError = retry.error ?? null
    }

    setFinalizing(false)
    if (updateError) {
      setFinalizeError(updateError.message ?? 'Failed to finalize game')
      return
    }

    try {
      localStorage.removeItem(GAME_STORAGE_KEY)
    } catch {
      // ignore
    }
    dispatch({ type: 'RESET_GAME' })
    navigate('/games')
  }

  return {
    finalizing,
    finalizeError,
    canFinalizeCloudGame,
    handleFinalizeCloudGame,
  }
}
