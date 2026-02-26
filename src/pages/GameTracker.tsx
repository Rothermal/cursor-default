import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGame } from '../context/GameContext'
import { computeCategoryTotal } from '../config/sports'
import Scoreboard from '../components/Scoreboard'
import StatButton from '../components/StatButton'

export default function GameTracker() {
  const navigate = useNavigate()
  const { state, dispatch, flushCloudSync } = useGame()
  const { sport, players, activePlayerId, actionLog } = state

  const [showAddPlayer, setShowAddPlayer] = useState(false)
  const [newName, setNewName] = useState('')
  const [newNumber, setNewNumber] = useState('')

  if (!sport || !state.gameInfo || players.length === 0) {
    navigate('/')
    return null
  }

  const activePlayer = players.find(p => p.id === activePlayerId) || players[0]

  // Flush cloud sync when leaving Game Tracker so latest stats are saved
  useEffect(() => {
    return () => {
      flushCloudSync()
    }
  }, [flushCloudSync])

  const handleUndo = () => {
    dispatch({ type: 'UNDO' })
  }

  const lastAction = actionLog.length > 0 ? actionLog[actionLog.length - 1] : null
  const lastActionLabel = (() => {
    if (!lastAction) return null
    if (lastAction.type === 'opponent_score_up') return 'Opp +1'
    if (lastAction.type === 'opponent_score_down') return 'Opp -1'
    const player = players.find(p => p.id === lastAction.playerId)
    if (!player) return null
    const statId = lastAction.statId
    let statLabel = statId || ''
    for (const cat of sport.categories) {
      for (const action of cat.actions) {
        if (action.id === statId) {
          statLabel = action.shortLabel
          break
        }
      }
    }
    const direction = lastAction.type === 'increment' ? '+' : '-'
    return `#${player.number || '?'} ${statLabel} ${direction}`
  })()

  const handleAddPlayer = () => {
    if (!newName.trim()) return
    const player = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      name: newName.trim(),
      number: newNumber.trim(),
      stats: {},
    }
    dispatch({ type: 'ADD_PLAYER', player })
    dispatch({ type: 'SET_ACTIVE_PLAYER', playerId: player.id })
    setNewName('')
    setNewNumber('')
    setShowAddPlayer(false)
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 max-w-lg mx-auto w-full">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => navigate('/')}
            className="text-sm text-slate-500 font-medium active:scale-95 transition-transform"
          >
            ← Home
          </button>
          <button
            onClick={() => navigate('/summary')}
            className="text-sm text-blue-600 font-semibold active:scale-95 transition-transform"
          >
            Summary →
          </button>
        </div>

        <Scoreboard />
      </div>

      {/* Player selector */}
      <div className="px-3 py-2 max-w-lg mx-auto w-full">
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {players.map(player => (
            <button
              key={player.id}
              onClick={() => dispatch({ type: 'SET_ACTIVE_PLAYER', playerId: player.id })}
              className={`
                flex-shrink-0 px-3 py-2 rounded-xl text-sm font-semibold
                transition-all duration-150 active:scale-95
                ${player.id === activePlayer.id
                  ? `${sport.theme.bg} text-white shadow-md`
                  : 'bg-white text-slate-600 border border-slate-200'
                }
              `}
            >
              <span className="opacity-70">#{player.number || '?'}</span>{' '}
              {player.name.split(' ')[0]}
            </button>
          ))}
          <button
            onClick={() => setShowAddPlayer(!showAddPlayer)}
            className="flex-shrink-0 w-10 h-10 rounded-xl bg-white border-2 border-dashed
                       border-slate-300 text-slate-400 text-xl font-bold
                       active:scale-95 transition-transform flex items-center justify-center"
          >
            +
          </button>
        </div>

        {showAddPlayer && (
          <div className="card mt-2 flex gap-2 items-end">
            <input
              type="text"
              value={newNumber}
              onChange={e => setNewNumber(e.target.value)}
              placeholder="#"
              className="input-field w-14 text-center text-sm py-2"
              inputMode="numeric"
            />
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Player name"
              className="input-field flex-1 text-sm py-2"
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') handleAddPlayer() }}
            />
            <button
              onClick={handleAddPlayer}
              disabled={!newName.trim()}
              className="btn-primary px-3 py-2 text-sm"
            >
              Add
            </button>
          </div>
        )}
      </div>

      {/* Stats grid */}
      <div className="flex-1 overflow-y-auto px-3 pb-20 max-w-lg mx-auto w-full">
        <div className="space-y-4 mt-2">
          {sport.categories.map(category => {
            const catTotal = computeCategoryTotal(category, activePlayer.stats)
            let displayTotal: number | null = null

            if (category.showTotal) {
              if (category.actions.some(a => a.pointValue)) {
                displayTotal = category.actions.reduce(
                  (sum, a) => sum + (activePlayer.stats[a.id] || 0) * (a.pointValue || 0),
                  0
                )
              } else {
                displayTotal = catTotal
              }
            }

            return (
              <div key={category.id}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">
                    {category.name}
                  </h3>
                  {displayTotal !== null && (
                    <span className="text-sm font-bold text-slate-700">
                      {category.totalLabel}: {displayTotal}
                    </span>
                  )}
                </div>
                <div className={`grid gap-2 ${
                  category.actions.length === 1 ? 'grid-cols-1' :
                  category.actions.length === 2 ? 'grid-cols-2' :
                  'grid-cols-3'
                }`}>
                  {category.actions.map(action => (
                    <StatButton
                      key={action.id}
                      label={action.label}
                      shortLabel={action.shortLabel}
                      value={activePlayer.stats[action.id] || 0}
                      color={category.color}
                      pointValue={action.pointValue}
                      onIncrement={() =>
                        dispatch({
                          type: 'INCREMENT_STAT',
                          playerId: activePlayer.id,
                          statId: action.id,
                        })
                      }
                      onDecrement={() =>
                        dispatch({
                          type: 'DECREMENT_STAT',
                          playerId: activePlayer.id,
                          statId: action.id,
                        })
                      }
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Undo bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur border-t border-slate-200 px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="text-xs text-slate-400">
            {lastActionLabel && (
              <span>Last: <span className="font-medium text-slate-600">{lastActionLabel}</span></span>
            )}
          </div>
          <button
            onClick={handleUndo}
            disabled={actionLog.length === 0}
            className="btn-secondary py-2 px-4 text-sm disabled:opacity-30"
          >
            ↩ Undo
          </button>
        </div>
      </div>
    </div>
  )
}
