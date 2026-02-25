import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGame } from '../context/GameContext'

export default function PlayerSetup() {
  const navigate = useNavigate()
  const { state, dispatch } = useGame()
  const sport = state.sport

  const [name, setName] = useState('')
  const [number, setNumber] = useState('')

  if (!sport || !state.gameInfo) {
    navigate('/')
    return null
  }

  const handleAddPlayer = () => {
    if (!name.trim()) return
    dispatch({
      type: 'ADD_PLAYER',
      player: {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        name: name.trim(),
        number: number.trim(),
        stats: {},
      },
    })
    setName('')
    setNumber('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAddPlayer()
  }

  const canStart = state.players.length > 0

  const handleStart = () => {
    if (!canStart) return
    if (!state.activePlayerId && state.players.length > 0) {
      dispatch({ type: 'SET_ACTIVE_PLAYER', playerId: state.players[0].id })
    }
    navigate('/game')
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
              onClick={handleAddPlayer}
              disabled={!name.trim()}
              className="btn-primary px-4 py-2"
            >
              Add
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
                  onClick={() => dispatch({ type: 'REMOVE_PLAYER', playerId: player.id })}
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
            disabled={!canStart}
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
