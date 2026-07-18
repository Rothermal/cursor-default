import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useGame } from '../context/GameContext'
import { clearActiveParkedGame } from '../lib/gameParking'
import { supabase } from '../lib/supabase'
import { shouldBlockDiscardUnsyncedGame, shouldPreserveLocalAfterFinalizeSuccess } from '../lib/gameSyncFingerprint'
import { getPendingSyncFlag } from '../lib/gameStorageKeys'
import { useTeamRole } from './useTeamRole'
import { canTrackGames } from '../lib/teamPermissions'

/**
 * Finalize an in-progress cloud game: flush sync → mark final → clear local → reset.
 * Order is intentional — do not reorder (avoids final + in-progress duplicates).
 */
export function useFinalizeGame() {
  const navigate = useNavigate()
  const { state, dispatch, flushCloudSync } = useGame()
  const { user, isConfigured } = useAuth()
  const teamAccess = useTeamRole(state.cloudSync.teamId)
  const [finalizing, setFinalizing] = useState(false)
  const [finalizeError, setFinalizeError] = useState<string | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state

  const isFinalCloudGame = state.cloudSync.gameStatus === 'final'
  const canFinalizeCloudGame = Boolean(
    isConfigured &&
      user &&
      supabase &&
      state.cloudSync.gameId &&
      !isFinalCloudGame &&
      canTrackGames(teamAccess.role)
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

    // Re-read after await: Back-to-Game edits during flush are re-synced by the
    // stale loop, but edits after flush returns must not be wiped with stale scores.
    const latest = stateRef.current
    if (shouldBlockDiscardUnsyncedGame(latest, getPendingSyncFlag())) {
      const retry = await flushCloudSync()
      if (!retry.ok) {
        setFinalizing(false)
        setFinalizeError(retry.reason)
        return
      }
    }

    const afterFlush = stateRef.current
    if (shouldBlockDiscardUnsyncedGame(afterFlush, getPendingSyncFlag())) {
      setFinalizing(false)
      setFinalizeError('Latest changes could not be synced. Try again.')
      return
    }

    const gameId = afterFlush.cloudSync.gameId
    if (!gameId) {
      setFinalizing(false)
      setFinalizeError('Game is no longer bound for finalize. Try again.')
      return
    }

    const { opponentScore, homeTeamScore, homeScoreAdjustment } = afterFlush

    const initial = await supabase!
      .from('games')
      .update({
        status: 'final',
        opponent_score: opponentScore,
        home_team_score: homeTeamScore,
        home_score_adjustment: homeScoreAdjustment,
      })
      .eq('id', gameId)

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
        .eq('id', gameId)
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
        .eq('id', gameId)
      updateError = retry.error ?? null
    }

    setFinalizing(false)
    if (updateError) {
      setFinalizeError(updateError.message ?? 'Failed to finalize game')
      return
    }

    // Header/browser back can still leave Summary during the status update await.
    // If newer local edits arrived after we marked cloud final, keep them — wiping
    // would permanently lose stats that can no longer sync to a final game.
    const afterFinal = stateRef.current
    if (shouldPreserveLocalAfterFinalizeSuccess(afterFinal, getPendingSyncFlag())) {
      dispatch({
        type: 'SET_CLOUD_SYNC_STATE',
        cloudSync: {
          gameStatus: 'final',
          lastError:
            'Cloud game is final, but newer local edits were kept. Export before discarding.',
        },
      })
      setFinalizeError(
        'Game finalized on the cloud, but newer local edits were kept. Export before discarding.'
      )
      return
    }

    clearActiveParkedGame(user?.id ?? null)
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
