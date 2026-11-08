import { useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { useGame } from '../context/GameContext'
import { relabelOpponentEverywhere } from '../lib/opponentLocalGames'
import { setGameOpponentLabels } from '../lib/opponentTeams'
import { supabase } from '../lib/supabase'

/** Relabel one cloud game's opponent on the server and on every copy on this device. */
export function useOpponentRelabel() {
  const { user } = useAuth()
  const { dispatch } = useGame()
  const userId = user?.id ?? null
  return useCallback(async (cloudGameId: string, name: string, nickname: string | null) => {
    const client = supabase
    if (!client || !userId) throw new Error('Sign in with cloud sync to rename an opponent.')
    const outcome = await relabelOpponentEverywhere({
      userId,
      cloudGameId,
      name,
      nickname,
      writeServer: (gameId, label, nick) => setGameOpponentLabels(client, gameId, label, nick),
      dispatch,
    })
    if (outcome === 'account_changed') throw new Error('The signed-in account changed before this device was updated.')
  }, [dispatch, userId])
}
