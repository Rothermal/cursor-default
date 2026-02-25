import { createContext, useContext, useReducer, useEffect, type ReactNode } from 'react'
import type { GameState, GameAction, ActionLogEntry } from '../types'

const STORAGE_KEY = 'statkeeper_game'

const initialState: GameState = {
  sport: null,
  gameInfo: null,
  players: [],
  activePlayerId: null,
  opponentScore: 0,
  actionLog: [],
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'SET_SPORT':
      return { ...initialState, sport: action.sport }

    case 'SET_GAME_INFO':
      return { ...state, gameInfo: action.gameInfo }

    case 'ADD_PLAYER':
      return { ...state, players: [...state.players, action.player] }

    case 'REMOVE_PLAYER':
      return {
        ...state,
        players: state.players.filter(p => p.id !== action.playerId),
        activePlayerId: state.activePlayerId === action.playerId ? null : state.activePlayerId,
      }

    case 'SET_ACTIVE_PLAYER':
      return { ...state, activePlayerId: action.playerId }

    case 'INCREMENT_STAT': {
      const player = state.players.find(p => p.id === action.playerId)
      if (!player) return state
      const prevValue = player.stats[action.statId] || 0
      const logEntry: ActionLogEntry = {
        id: generateId(),
        timestamp: Date.now(),
        type: 'increment',
        playerId: action.playerId,
        statId: action.statId,
        previousValue: prevValue,
      }
      return {
        ...state,
        players: state.players.map(p =>
          p.id === action.playerId
            ? { ...p, stats: { ...p.stats, [action.statId]: prevValue + 1 } }
            : p
        ),
        actionLog: [...state.actionLog, logEntry],
      }
    }

    case 'DECREMENT_STAT': {
      const player = state.players.find(p => p.id === action.playerId)
      if (!player) return state
      const prevValue = player.stats[action.statId] || 0
      if (prevValue <= 0) return state
      const logEntry: ActionLogEntry = {
        id: generateId(),
        timestamp: Date.now(),
        type: 'decrement',
        playerId: action.playerId,
        statId: action.statId,
        previousValue: prevValue,
      }
      return {
        ...state,
        players: state.players.map(p =>
          p.id === action.playerId
            ? { ...p, stats: { ...p.stats, [action.statId]: prevValue - 1 } }
            : p
        ),
        actionLog: [...state.actionLog, logEntry],
      }
    }

    case 'INCREMENT_OPPONENT_SCORE': {
      const logEntry: ActionLogEntry = {
        id: generateId(),
        timestamp: Date.now(),
        type: 'opponent_score_up',
        previousValue: state.opponentScore,
      }
      return {
        ...state,
        opponentScore: state.opponentScore + 1,
        actionLog: [...state.actionLog, logEntry],
      }
    }

    case 'DECREMENT_OPPONENT_SCORE': {
      if (state.opponentScore <= 0) return state
      const logEntry: ActionLogEntry = {
        id: generateId(),
        timestamp: Date.now(),
        type: 'opponent_score_down',
        previousValue: state.opponentScore,
      }
      return {
        ...state,
        opponentScore: state.opponentScore - 1,
        actionLog: [...state.actionLog, logEntry],
      }
    }

    case 'UNDO': {
      if (state.actionLog.length === 0) return state
      const lastAction = state.actionLog[state.actionLog.length - 1]
      let newState = { ...state, actionLog: state.actionLog.slice(0, -1) }

      switch (lastAction.type) {
        case 'increment':
        case 'decrement':
          newState = {
            ...newState,
            players: newState.players.map(p =>
              p.id === lastAction.playerId
                ? { ...p, stats: { ...p.stats, [lastAction.statId!]: lastAction.previousValue } }
                : p
            ),
          }
          break
        case 'opponent_score_up':
        case 'opponent_score_down':
          newState = { ...newState, opponentScore: lastAction.previousValue }
          break
      }
      return newState
    }

    case 'RESET_GAME':
      return initialState

    default:
      return state
  }
}

function loadState(): GameState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      return JSON.parse(saved) as GameState
    }
  } catch {
    // ignore parse errors
  }
  return initialState
}

interface GameContextType {
  state: GameState
  dispatch: React.Dispatch<GameAction>
}

const GameContext = createContext<GameContextType | null>(null)

export function GameProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(gameReducer, undefined, loadState)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  return (
    <GameContext.Provider value={{ state, dispatch }}>
      {children}
    </GameContext.Provider>
  )
}

export function useGame(): GameContextType {
  const context = useContext(GameContext)
  if (!context) {
    throw new Error('useGame must be used within a GameProvider')
  }
  return context
}
