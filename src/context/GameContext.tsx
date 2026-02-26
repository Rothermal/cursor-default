import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from 'react'
import type {
  GameState,
  GameAction,
  ActionLogEntry,
  CloudSyncState,
  CloudSyncStatus,
} from '../types'
import { useAuth } from './AuthContext'
import { syncGameSnapshotToCloud } from '../lib/cloudSync'
import { supabase } from '../lib/supabase'

const STORAGE_KEY = 'statkeeper_game'

const CLOUD_SYNC_STATUSES: CloudSyncStatus[] = [
  'offline',
  'idle',
  'syncing',
  'synced',
  'error',
]

function createInitialCloudSyncState(status: CloudSyncStatus = 'idle'): CloudSyncState {
  return {
    teamId: null,
    gameId: null,
    playerIdMap: {},
    status,
    lastSyncedAt: null,
    lastError: null,
  }
}

function createInitialState(status: CloudSyncStatus = 'idle'): GameState {
  return {
    sport: null,
    gameInfo: null,
    players: [],
    activePlayerId: null,
    opponentScore: 0,
    actionLog: [],
    cloudSync: createInitialCloudSyncState(status),
  }
}

function normalizeCloudStatus(value: unknown, fallback: CloudSyncStatus): CloudSyncStatus {
  if (typeof value === 'string' && CLOUD_SYNC_STATUSES.includes(value as CloudSyncStatus)) {
    return value as CloudSyncStatus
  }

  return fallback
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

function buildSyncFingerprint(state: GameState): string {
  return JSON.stringify({
    sportId: state.sport?.id ?? null,
    gameInfo: state.gameInfo,
    opponentScore: state.opponentScore,
    players: state.players.map(player => ({
      id: player.id,
      name: player.name,
      number: player.number,
      stats: player.stats,
    })),
  })
}

function canSyncState(state: GameState, isConfigured: boolean, userId: string | null): boolean {
  return Boolean(isConfigured && userId && supabase && state.sport && state.gameInfo)
}

function gameReducer(state: GameState, action: GameAction): GameState {
  const resetStatus: CloudSyncStatus = state.cloudSync.status === 'offline' ? 'offline' : 'idle'

  switch (action.type) {
    case 'SET_SPORT':
      return { ...createInitialState(resetStatus), sport: action.sport }

    case 'SET_GAME_INFO':
      return {
        ...state,
        gameInfo: action.gameInfo,
        cloudSync:
          state.gameInfo && state.gameInfo.teamName !== action.gameInfo.teamName
            ? {
                ...state.cloudSync,
                teamId: null,
                gameId: null,
                playerIdMap: {},
                lastSyncedAt: null,
              }
            : state.cloudSync,
      }

    case 'ADD_PLAYER':
      return { ...state, players: [...state.players, action.player] }

    case 'SET_PLAYERS':
      return {
        ...state,
        players: action.players,
        activePlayerId: action.players.length > 0 ? state.activePlayerId ?? action.players[0].id : null,
      }

    case 'REMOVE_PLAYER':
      // Keep local->remote player mapping aligned with the current roster.
      // Removed players are not automatically deleted in Supabase to preserve history.
      return {
        ...state,
        players: state.players.filter(p => p.id !== action.playerId),
        activePlayerId: state.activePlayerId === action.playerId ? null : state.activePlayerId,
        cloudSync: {
          ...state.cloudSync,
          playerIdMap: Object.fromEntries(
            Object.entries(state.cloudSync.playerIdMap).filter(([localId]) => localId !== action.playerId)
          ),
        },
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
      return createInitialState(resetStatus)

    case 'SET_CLOUD_SYNC_STATE':
      return {
        ...state,
        cloudSync: {
          ...state.cloudSync,
          ...action.cloudSync,
        },
      }

    default:
      return state
  }
}

function loadState(): GameState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<GameState>
      const fallbackStatus = normalizeCloudStatus(parsed.cloudSync?.status, 'idle')
      const restoredStatus = fallbackStatus === 'syncing' ? 'idle' : fallbackStatus

      return {
        ...createInitialState(restoredStatus),
        ...parsed,
        players: Array.isArray(parsed.players) ? parsed.players : [],
        actionLog: Array.isArray(parsed.actionLog) ? parsed.actionLog : [],
        cloudSync: {
          ...createInitialCloudSyncState(restoredStatus),
          ...(parsed.cloudSync ?? {}),
          playerIdMap: parsed.cloudSync?.playerIdMap ?? {},
          status: restoredStatus,
        },
      }
    }
  } catch {
    // ignore parse errors
  }

  return createInitialState()
}

interface GameContextType {
  state: GameState
  dispatch: React.Dispatch<GameAction>
}

const GameContext = createContext<GameContextType | null>(null)

export function GameProvider({ children }: { children: ReactNode }) {
  const { user, isConfigured } = useAuth()
  const userId = user?.id ?? null
  const [state, dispatch] = useReducer(gameReducer, undefined, loadState)
  const stateRef = useRef(state)
  const syncInFlightRef = useRef(false)
  const queueAnotherSyncRef = useRef(false)
  const debounceTimerRef = useRef<number | null>(null)
  const prevUserIdRef = useRef<string | null>(userId)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  useEffect(() => {
    if (prevUserIdRef.current !== userId) {
      dispatch({
        type: 'SET_CLOUD_SYNC_STATE',
        cloudSync: {
          teamId: null,
          gameId: null,
          playerIdMap: {},
          status: !isConfigured ? 'offline' : 'idle',
          lastSyncedAt: null,
          lastError: null,
        },
      })
      prevUserIdRef.current = userId
    }
  }, [isConfigured, userId])

  useEffect(() => {
    if (!isConfigured && state.cloudSync.status !== 'offline') {
      dispatch({
        type: 'SET_CLOUD_SYNC_STATE',
        cloudSync: {
          status: 'offline',
          lastError: null,
        },
      })
      return
    }

    if (isConfigured && state.cloudSync.status === 'offline') {
      dispatch({
        type: 'SET_CLOUD_SYNC_STATE',
        cloudSync: {
          status: 'idle',
          lastError: null,
        },
      })
    }
  }, [isConfigured, state.cloudSync.status])

  const runCloudSync = useCallback(async () => {
    if (!canSyncState(stateRef.current, isConfigured, userId)) {
      return
    }

    if (syncInFlightRef.current) {
      queueAnotherSyncRef.current = true
      return
    }

    syncInFlightRef.current = true
    try {
      do {
        queueAnotherSyncRef.current = false

        const snapshot = stateRef.current
        const snapshotFingerprint = buildSyncFingerprint(snapshot)
        const snapshotUserId = userId

        if (!canSyncState(snapshot, isConfigured, snapshotUserId)) {
          dispatch({
            type: 'SET_CLOUD_SYNC_STATE',
            cloudSync: {
              status: !isConfigured ? 'offline' : 'idle',
            },
          })
          break
        }

        dispatch({
          type: 'SET_CLOUD_SYNC_STATE',
          cloudSync: {
            status: 'syncing',
            lastError: null,
          },
        })

        const synced = await syncGameSnapshotToCloud({
          state: snapshot,
          userId: snapshotUserId!,
        })

        const isStale = snapshotFingerprint !== buildSyncFingerprint(stateRef.current)
        if (isStale) {
          queueAnotherSyncRef.current = true
          continue
        }

        dispatch({
          type: 'SET_CLOUD_SYNC_STATE',
          cloudSync: {
            teamId: synced.teamId,
            gameId: synced.gameId,
            playerIdMap: synced.playerIdMap,
            status: 'synced',
            lastSyncedAt: synced.syncedAt,
            lastError: null,
          },
        })
      } while (queueAnotherSyncRef.current)
    } catch (error) {
      dispatch({
        type: 'SET_CLOUD_SYNC_STATE',
        cloudSync: {
          status: 'error',
          lastError: error instanceof Error ? error.message : 'Cloud sync failed',
        },
      })
    } finally {
      syncInFlightRef.current = false
    }
  }, [isConfigured, userId])

  const syncFingerprint = buildSyncFingerprint(state)
  const shouldSync = canSyncState(state, isConfigured, userId)

  useEffect(() => {
    if (!shouldSync) return

    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current)
    }

    debounceTimerRef.current = window.setTimeout(() => {
      void runCloudSync()
    }, 300)

    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
  }, [runCloudSync, shouldSync, syncFingerprint])

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
