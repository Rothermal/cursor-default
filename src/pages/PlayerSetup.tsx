import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGame } from '../context/GameContext'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

function generateLocalId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

function splitName(value: string): { firstName: string; lastName: string } {
  const parts = value.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) {
    return { firstName: 'Player', lastName: '' }
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  }
}

export default function PlayerSetup() {
  const navigate = useNavigate()
  const { state, dispatch } = useGame()
  const { user, isConfigured } = useAuth()
  const sport = state.sport
  const cloudTeamId = state.cloudSync.teamId
  const isCloudRoster = Boolean(cloudTeamId && isConfigured && user && supabase)

  const [name, setName] = useState('')
  const [number, setNumber] = useState('')
  const [rosterLoading, setRosterLoading] = useState(Boolean(cloudTeamId && state.players.length === 0))
  const [rosterError, setRosterError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const cloudRosterLoadedRef = useRef(false)

  useEffect(() => {
    if (!isCloudRoster || !cloudTeamId || cloudRosterLoadedRef.current) return
    if (state.players.length > 0) {
      cloudRosterLoadedRef.current = true
      setRosterLoading(false)
      return
    }

    let cancelled = false
    const loadRoster = async () => {
      setRosterLoading(true)
      setRosterError(null)
      const { data, error } = await supabase!
        .from('players')
        .select('id,first_name,last_name,jersey_number')
        .eq('team_id', cloudTeamId)
        .eq('is_active', true)
        .order('created_at', { ascending: true })

      if (cancelled) return
      if (error) {
        setRosterError(error.message)
        setRosterLoading(false)
        return
      }

      const loadedPlayers = (data ?? []).map(row => ({
        id: row.id as string,
        name: `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim(),
        number: (row.jersey_number as string | null) ?? '',
        stats: {},
      }))

      const idMap = loadedPlayers.reduce<Record<string, string>>((map, player) => {
        map[player.id] = player.id
        return map
      }, {})

      dispatch({ type: 'SET_PLAYERS', players: loadedPlayers })
      dispatch({
        type: 'SET_CLOUD_SYNC_STATE',
        cloudSync: {
          playerIdMap: idMap,
          lastError: null,
        },
      })
      if (loadedPlayers.length > 0 && !state.activePlayerId) {
        dispatch({ type: 'SET_ACTIVE_PLAYER', playerId: loadedPlayers[0].id })
      }

      cloudRosterLoadedRef.current = true
      setRosterLoading(false)
    }

    void loadRoster()
    return () => {
      cancelled = true
    }
  }, [cloudTeamId, dispatch, isCloudRoster, state.activePlayerId, state.players.length])

  const handleAddPlayer = async () => {
    if (!name.trim()) return

    setRosterError(null)
    let playerId = generateLocalId()
    if (isCloudRoster && cloudTeamId) {
      setSaving(true)
      const { firstName, lastName } = splitName(name)
      const { data, error } = await supabase!
        .from('players')
        .insert({
          team_id: cloudTeamId,
          first_name: firstName,
          last_name: lastName || null,
          jersey_number: number.trim() || null,
          is_active: true,
        })
        .select('id')
        .single()

      setSaving(false)
      if (error || !data) {
        setRosterError(error?.message ?? 'Could not save player')
        return
      }

      playerId = data.id as string
      dispatch({
        type: 'SET_CLOUD_SYNC_STATE',
        cloudSync: {
          playerIdMap: {
            ...state.cloudSync.playerIdMap,
            [playerId]: playerId,
          },
          lastError: null,
        },
      })
    }

    dispatch({
      type: 'ADD_PLAYER',
      player: {
        id: playerId,
        name: name.trim(),
        number: number.trim(),
        stats: {},
      },
    })
    if (!state.activePlayerId) {
      dispatch({ type: 'SET_ACTIVE_PLAYER', playerId })
    }
    setName('')
    setNumber('')
  }

  const handleRemovePlayer = async (playerId: string) => {
    setRosterError(null)
    if (isCloudRoster) {
      const remotePlayerId = state.cloudSync.playerIdMap[playerId] ?? playerId
      setSaving(true)
      const { error } = await supabase!
        .from('players')
        .update({ is_active: false })
        .eq('id', remotePlayerId)
      setSaving(false)
      if (error) {
        setRosterError(error.message)
        return
      }
    }

    dispatch({ type: 'REMOVE_PLAYER', playerId })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      void handleAddPlayer()
    }
  }

  const canStart = state.players.length > 0

  if (!sport || !state.gameInfo) {
    navigate('/')
    return null
  }

  const handleStart = () => {
    if (!canStart) return
    if (!state.activePlayerId && state.players.length > 0) {
      dispatch({ type: 'SET_ACTIVE_PLAYER', playerId: state.players[0].id })
    }
    if (state.cloudSync.teamId) {
      navigate('/checkout')
    } else {
      navigate('/game')
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className={`bg-gradient-to-r ${sport.theme.gradient} text-white px-4 py-4`}>
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button
            onClick={() => navigate('/setup')}
            className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center
                       active:scale-90 transition-transform"
          >
            ←
          </button>
          <div>
            <h1 className="text-lg font-bold">{sport.icon} {sport.name}</h1>
            <p className="text-sm opacity-80">
              {state.gameInfo.teamName} vs {state.gameInfo.opponentName}
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 px-4 py-6 max-w-lg mx-auto w-full">
        <h2 className="text-lg font-semibold text-slate-700 mb-4">Add Players</h2>

        {isCloudRoster && (
          <div className="card mb-3 bg-blue-50 border-blue-200 text-blue-800 text-xs">
            Roster is synced with your selected cloud team.
          </div>
        )}
        {rosterLoading && (
          <div className="card mb-3 text-sm text-slate-500 animate-pulse">
            Loading saved roster...
          </div>
        )}
        {rosterError && (
          <div className="card mb-3 bg-red-50 border-red-200 text-red-700 text-sm">
            {rosterError}
          </div>
        )}

        <div className="card mb-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={number}
              onChange={e => setNumber(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="#"
              className="input-field w-16 text-center"
              inputMode="numeric"
            />
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Player name"
              className="input-field flex-1"
            />
            <button
              onClick={() => { void handleAddPlayer() }}
              disabled={!name.trim() || saving || rosterLoading}
              className="btn-primary px-4 py-2"
            >
              {saving ? 'Saving...' : 'Add'}
            </button>
          </div>
        </div>

        {state.players.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <p className="text-4xl mb-2">👥</p>
            <p>Add at least one player to start</p>
          </div>
        ) : (
          <div className="space-y-2">
            {state.players.map(player => (
              <div key={player.id} className="card flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <span className={`
                    ${sport.theme.bg} text-white w-10 h-10 rounded-full
                    flex items-center justify-center font-bold text-sm
                  `}>
                    {player.number || '—'}
                  </span>
                  <span className="font-medium text-slate-700">{player.name}</span>
                </div>
                <button
                  onClick={() => { void handleRemovePlayer(player.id) }}
                  disabled={saving || rosterLoading}
                  className="text-slate-400 hover:text-red-500 transition-colors px-2 py-1"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 space-y-3">
          <button
            onClick={handleStart}
            disabled={!canStart || rosterLoading || saving}
            className="btn-primary w-full"
          >
            Start Game ({state.players.length} player{state.players.length !== 1 ? 's' : ''}) →
          </button>
          <p className="text-center text-xs text-slate-400">
            You can add more players during the game
          </p>
        </div>
      </div>
    </div>
  )
}
