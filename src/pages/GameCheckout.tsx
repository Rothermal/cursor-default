import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGame } from '../context/GameContext'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

interface CheckoutRow {
  player_id: string
  user_id: string
  is_primary: boolean
}

export default function GameCheckout() {
  const navigate = useNavigate()
  const { state, flushCloudSync } = useGame()
  const { user, isConfigured } = useAuth()
  const gameId = state.cloudSync.gameId
  const playerIdMap = state.cloudSync.playerIdMap
  const { sport, gameInfo, players } = state
  const syncTriggeredRef = useRef(false)

  const [checkouts, setCheckouts] = useState<CheckoutRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toggling, setToggling] = useState<string | null>(null)

  const myId = user?.id ?? null

  // If we have no gameId yet (first time), trigger sync so game is created
  useEffect(() => {
    if (!isConfigured || !user || gameId) return
    if (syncTriggeredRef.current) return
    if (!gameInfo || players.length === 0) return
    syncTriggeredRef.current = true
    flushCloudSync()
  }, [isConfigured, user, gameId, gameInfo, players.length, flushCloudSync])

  useEffect(() => {
    const client = supabase
    if (!isConfigured || !gameId || !client) {
      setLoading(false)
      return
    }

    let cancelled = false
    const load = async () => {
      setError(null)
      const { data, error: e } = await client
        .from('player_checkouts')
        .select('player_id, user_id, is_primary')
        .eq('game_id', gameId)

      if (cancelled) return
      if (e) {
        setError(e.message)
        setLoading(false)
        return
      }
      setCheckouts((data ?? []) as CheckoutRow[])
      setLoading(false)
    }

    void load()
    return () => { cancelled = true }
  }, [isConfigured, gameId])

  const isCheckedOutByMe = (remotePlayerId: string) =>
    checkouts.some(c => c.player_id === remotePlayerId && c.user_id === myId)

  const claimedByOther = (remotePlayerId: string) => {
    const c = checkouts.find(x => x.player_id === remotePlayerId && x.is_primary && x.user_id !== myId)
    return c ? 'Someone else' : null
  }

  const handleToggle = async (localPlayerId: string) => {
    if (!supabase || !gameId || !myId) return
    const remotePlayerId = playerIdMap[localPlayerId] ?? localPlayerId

    setToggling(localPlayerId)
    setError(null)

    const checked = isCheckedOutByMe(remotePlayerId)

    if (checked) {
      const { error: e } = await supabase
        .from('player_checkouts')
        .delete()
        .eq('game_id', gameId)
        .eq('player_id', remotePlayerId)
        .eq('user_id', myId)

      if (!e) {
        setCheckouts(prev => prev.filter(c => !(c.player_id === remotePlayerId && c.user_id === myId)))
      } else {
        setError(e.message)
      }
    } else {
      const existing = checkouts.some(c => c.player_id === remotePlayerId)
      const { error: e } = await supabase
        .from('player_checkouts')
        .insert({
          game_id: gameId,
          player_id: remotePlayerId,
          user_id: myId,
          is_primary: !existing,
        })

      if (!e) {
        setCheckouts(prev => [...prev, { player_id: remotePlayerId, user_id: myId, is_primary: !existing }])
      } else {
        setError(e.message)
      }
    }

    setToggling(null)
  }

  const handleStartTracking = () => {
    navigate('/game')
  }

  if (!sport || !gameInfo || players.length === 0) {
    navigate('/')
    return null
  }

  if (!isConfigured) {
    navigate('/game')
    return null
  }

  if (!gameId) {
    return (
      <div className="min-h-screen flex flex-col bg-slate-50 items-center justify-center px-4">
        <p className="text-slate-500 animate-pulse">Preparing game…</p>
        <p className="text-xs text-slate-400 mt-2">Sync in progress</p>
        <button
          type="button"
          onClick={() => navigate('/game')}
          className="mt-4 text-sm text-blue-600"
        >
          Skip to Game →
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className={`bg-gradient-to-r ${sport.theme.gradient} text-white px-4 py-4`}>
        <div className="max-w-lg mx-auto">
          <button
            onClick={() => navigate('/players')}
            className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center mb-3
                       active:scale-90 transition-transform"
          >
            ←
          </button>
          <h1 className="text-lg font-bold">Who are you tracking?</h1>
          <p className="text-sm opacity-80 mt-1">
            {gameInfo.teamName} vs {gameInfo.opponentName}
          </p>
          <p className="text-xs opacity-60 mt-1">
            Select the players you will record stats for. Others can track the same game.
          </p>
        </div>
      </header>

      <div className="flex-1 px-4 py-6 max-w-lg mx-auto w-full">
        {error && (
          <div className="card bg-red-50 border-red-200 text-red-700 text-sm mb-4">
            {error}
          </div>
        )}

        {loading ? (
          <div className="card text-slate-500 animate-pulse">Loading...</div>
        ) : (
          <div className="space-y-2 mb-6">
            {players.map(player => {
              const remoteId = playerIdMap[player.id] ?? player.id
              const mine = isCheckedOutByMe(remoteId)
              const other = claimedByOther(remoteId)

              return (
                <button
                  key={player.id}
                  type="button"
                  onClick={() => { void handleToggle(player.id) }}
                  disabled={toggling === player.id}
                  className={`card w-full flex items-center justify-between py-3 text-left transition-colors
                    ${mine ? 'ring-2 ring-blue-400 bg-blue-50/50' : 'hover:bg-slate-50'}`}
                >
                  <div className="flex items-center gap-3">
                    <span className={`
                      ${sport.theme.bg} text-white w-10 h-10 rounded-full
                      flex items-center justify-center font-bold text-sm
                    `}>
                      {player.number || '—'}
                    </span>
                    <div>
                      <p className="font-medium text-slate-700">{player.name}</p>
                      {other && (
                        <p className="text-xs text-slate-500">Primary: {other}</p>
                      )}
                    </div>
                  </div>
                  <span className="text-2xl">{mine ? '✓' : '○'}</span>
                </button>
              )
            })}
          </div>
        )}

        <button
          onClick={handleStartTracking}
          className="btn-primary w-full"
        >
          Start Tracking →
        </button>
      </div>
    </div>
  )
}
