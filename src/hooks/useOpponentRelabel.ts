import { useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { useGame } from '../context/GameContext'
import { relabelParkedCloudGameCopies } from '../lib/opponentLocalGames'
import { normalizeOpponentLabel, setGameOpponentLabels } from '../lib/opponentTeams'
import { supabase } from '../lib/supabase'

/** Relabel one cloud game's opponent on the server and on every copy on this device. */
export function useOpponentRelabel() {
  const { user } = useAuth()
  const { state, dispatch, activeLocalGameId } = useGame()
  const ownerId = user?.id ?? null
  return useCallback(async (cloudGameId: string, name: string, nickname: string | null) => {
    if (!supabase) throw new Error('Cloud is not configured.')
    await setGameOpponentLabels(supabase, cloudGameId, name, nickname)
    relabelParkedCloudGameCopies(ownerId, cloudGameId, activeLocalGameId, name, nickname)
    if (state.cloudSync.gameId === cloudGameId && state.gameInfo) {
      dispatch({
        type: 'SET_GAME_INFO',
        gameInfo: { ...state.gameInfo, opponentName: name.trim(), opponentNickname: normalizeOpponentLabel(nickname) },
      })
    }
  }, [activeLocalGameId, dispatch, ownerId, state.cloudSync.gameId, state.gameInfo])
}
