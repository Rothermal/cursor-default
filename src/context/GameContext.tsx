import {
  createContext,
  useContext,
  useReducer,
  useState,
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
import {
  syncGameSnapshotToCloud,
  loadLatestCloudGame,
  loadCloudGameById,
  getLastOpenedPreferenceSupport,
} from '../lib/cloudSync'
import { supabase } from '../lib/supabase'
import { sports } from '../config/sports'

/** Persisted game state key; clear this when finalizing so the game no longer appears as in progress. */
export const GAME_STORAGE_KEY = 'statkeeper_game'
const STORAGE_KEY = GAME_STORAGE_KEY
const CLOUD_RESUME_TARGETS_KEY = 'statkeeper_cloud_resume_targets'
const PENDING_SYNC_KEY = 'statkeeper_pending_sync'

function getPendingSyncFlag(): boolean {
  try {
    return localStorage.getItem(PENDING_SYNC_KEY) === '1'
  } catch {
    return false
  }
}

function setPendingSyncFlag(pending: boolean): void {
  try {
    if (pending) {
      localStorage.setItem(PENDING_SYNC_KEY, '1')
    } else {
      localStorage.removeItem(PENDING_SYNC_KEY)
    }
  } catch {
    // ignore
  }
}

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
    gameStatus: null,
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
    homeScoreAdjustment: 0,
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
    homeScoreAdjustment: state.homeScoreAdjustment,
    players: state.players.map(player => ({
      id: player.id,
      name: player.name,
      number: player.number,
      stats: player.stats,
    })),
  })
}

function hasSyncPrereqs(state: GameState, isConfigured: boolean, userId: string | null): boolean {
  return Boolean(
    isConfigured &&
    userId &&
    supabase &&
    state.sport &&
    state.gameInfo &&
    state.cloudSync.gameStatus !== 'final'
  )
}

function canSyncState(
  state: GameState,
  isConfigured: boolean,
  userId: string | null,
  isOnline: boolean
): boolean {
  return Boolean(isOnline && hasSyncPrereqs(state, isConfigured, userId))
}

function getInitialOnlineState(): boolean {
  if (typeof navigator === 'undefined') {
    return true
  }
  return navigator.onLine
}

function isLikelyNetworkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /(network|offline|failed to fetch|fetch failed|timeout)/i.test(message)
}

function loadResumeTargets(): Record<string, string> {
  try {
    const saved = localStorage.getItem(CLOUD_RESUME_TARGETS_KEY)
    if (!saved) return {}
    const parsed = JSON.parse(saved) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as Record<string, string>
  } catch {
    return {}
  }
}

function getResumeTarget(userId: string): string | null {
  const targets = loadResumeTargets()
  const gameId = targets[userId]
  return typeof gameId === 'string' && gameId.length > 0 ? gameId : null
}

function setResumeTarget(userId: string, gameId: string | null): void {
  const targets = loadResumeTargets()
  if (gameId) {
    targets[userId] = gameId
  } else {
    delete targets[userId]
  }
  localStorage.setItem(CLOUD_RESUME_TARGETS_KEY, JSON.stringify(targets))
}

function canHydrateAsActiveGame(status: string): boolean {
  return status === 'in_progress' || status === 'scheduled'
}

function buildHydratedStateFromCloudGame(
  cloudGame: Awaited<ReturnType<typeof loadLatestCloudGame>>
): GameState | null {
  if (!cloudGame) return null
  const sport = sports.find(item => item.id === cloudGame.sportId)
  if (!sport) return null

  return {
    sport,
    gameInfo: cloudGame.gameInfo,
    players: cloudGame.players,
    activePlayerId: cloudGame.activePlayerId,
    opponentScore: cloudGame.opponentScore,
    homeScoreAdjustment: cloudGame.homeScoreAdjustment,
    actionLog: [],
    cloudSync: {
      ...createInitialCloudSyncState('synced'),
      teamId: cloudGame.teamId,
      gameId: cloudGame.gameId,
      gameStatus: cloudGame.status,
      playerIdMap: cloudGame.playerIdMap,
      lastSyncedAt: cloudGame.hydratedAt,
      status: 'synced',
      lastError: null,
    },
  }
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
                gameStatus: null,
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

    case 'HYDRATE_STATE':
      return action.state

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

    case 'INCREMENT_HOME_SCORE': {
      const logEntry: ActionLogEntry = {
        id: generateId(),
        timestamp: Date.now(),
        type: 'home_score_up',
        previousValue: state.homeScoreAdjustment,
      }
      return {
        ...state,
        homeScoreAdjustment: state.homeScoreAdjustment + 1,
        actionLog: [...state.actionLog, logEntry],
      }
    }

    case 'DECREMENT_HOME_SCORE': {
      if (state.homeScoreAdjustment <= 0) return state
      const logEntry: ActionLogEntry = {
        id: generateId(),
        timestamp: Date.now(),
        type: 'home_score_down',
        previousValue: state.homeScoreAdjustment,
      }
      return {
        ...state,
        homeScoreAdjustment: state.homeScoreAdjustment - 1,
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
        case 'home_score_up':
        case 'home_score_down':
          newState = { ...newState, homeScoreAdjustment: lastAction.previousValue }
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
      // Don't restore a game that was already finalized (fixes existing stale "in progress" state).
      if (parsed.cloudSync?.gameStatus === 'final') {
        return createInitialState()
      }
      const fallbackStatus = normalizeCloudStatus(parsed.cloudSync?.status, 'idle')
      const restoredStatus = fallbackStatus === 'syncing' ? 'idle' : fallbackStatus

  return {
    ...createInitialState(restoredStatus),
    ...parsed,
    homeScoreAdjustment: typeof parsed.homeScoreAdjustment === 'number' ? parsed.homeScoreAdjustment : 0,
    players: Array.isArray(parsed.players) ? parsed.players : [],
    actionLog: Array.isArray(parsed.actionLog) ? parsed.actionLog : [],
    cloudSync: {
          ...createInitialCloudSyncState(restoredStatus),
          ...(parsed.cloudSync ?? {}),
          playerIdMap: parsed.cloudSync?.playerIdMap ?? {},
          gameStatus: parsed.cloudSync?.gameStatus ?? null,
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
  /** Trigger an immediate cloud sync (e.g. when leaving Game Tracker). */
  flushCloudSync: () => void
}

const GameContext = createContext<GameContextType | null>(null)

export function GameProvider({ children }: { children: ReactNode }) {
  const { user, isConfigured } = useAuth()
  const userId = user?.id ?? null
  const [state, dispatch] = useReducer(gameReducer, undefined, loadState)
  const [isOnline, setIsOnline] = useState(getInitialOnlineState)
  const stateRef = useRef(state)
  const syncInFlightRef = useRef(false)
  const queueAnotherSyncRef = useRef(false)
  const pendingSyncRef = useRef(false)
  const debounceTimerRef = useRef<number | null>(null)
  const prevUserIdRef = useRef<string | null>(userId)
  const hydratedUserRef = useRef<string | null>(null)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  useEffect(() => {
    if (prevUserIdRef.current !== userId) {
      const resetState = createInitialState(!isConfigured || !isOnline ? 'offline' : 'idle')
      stateRef.current = resetState
      pendingSyncRef.current = false
      dispatch({ type: 'HYDRATE_STATE', state: resetState })
      hydratedUserRef.current = null
      prevUserIdRef.current = userId
    }
  }, [isConfigured, isOnline, userId])

  useEffect(() => {
    if (!isConfigured || !userId || !supabase) return
    if (hydratedUserRef.current === userId) return

    let cancelled = false
    const hydrateFromCloud = async () => {
      // Cloud-first: only skip hydration when there is unsynced local progress
      // (game in progress that has never been synced - no gameId yet).
      const hasUnsyncedLocal =
        stateRef.current.sport &&
        stateRef.current.gameInfo &&
        !stateRef.current.cloudSync.gameId
      if (hasUnsyncedLocal) {
        hydratedUserRef.current = userId
        return
      }

      try {
        const preferredGameId = getResumeTarget(userId)
        const latestCloudGame = await loadLatestCloudGame(userId)
        let cloudGame = latestCloudGame

        if (preferredGameId && getLastOpenedPreferenceSupport() === 'missing') {
          const preferredCloudGame = await loadCloudGameById(userId, preferredGameId)
          if (preferredCloudGame && canHydrateAsActiveGame(preferredCloudGame.status)) {
            cloudGame = preferredCloudGame
          } else {
            setResumeTarget(userId, null)
          }
        }
        if (cancelled) return

        hydratedUserRef.current = userId
        const nextState = buildHydratedStateFromCloudGame(cloudGame)
        if (!nextState) return

        if (nextState.cloudSync.gameId && canHydrateAsActiveGame(nextState.cloudSync.gameStatus ?? '')) {
          setResumeTarget(userId, nextState.cloudSync.gameId)
        }
        stateRef.current = nextState
        dispatch({ type: 'HYDRATE_STATE', state: nextState })
      } catch (error) {
        if (cancelled) return
        hydratedUserRef.current = userId
        dispatch({
          type: 'SET_CLOUD_SYNC_STATE',
          cloudSync: {
            status: 'error',
            lastError: error instanceof Error ? error.message : 'Cloud load failed',
          },
        })
      }
    }

    void hydrateFromCloud()
    return () => {
      cancelled = true
    }
  }, [isConfigured, userId])

  useEffect(() => {
    if (!userId) return
    if (!state.cloudSync.gameId) return
    if (!canHydrateAsActiveGame(state.cloudSync.gameStatus ?? '')) return
    setResumeTarget(userId, state.cloudSync.gameId)
  }, [state.cloudSync.gameId, state.cloudSync.gameStatus, userId])

  useEffect(() => {
    if ((!isConfigured || !isOnline) && state.cloudSync.status !== 'offline') {
      dispatch({
        type: 'SET_CLOUD_SYNC_STATE',
        cloudSync: {
          status: 'offline',
          lastError: null,
        },
      })
      return
    }

    if (isConfigured && isOnline && state.cloudSync.status === 'offline') {
      dispatch({
        type: 'SET_CLOUD_SYNC_STATE',
        cloudSync: {
          status: 'idle',
          lastError: null,
        },
      })
    }
  }, [isConfigured, isOnline, state.cloudSync.status])

  const runCloudSync = useCallback(async () => {
    if (!canSyncState(stateRef.current, isConfigured, userId, isOnline)) {
      if (!isOnline && hasSyncPrereqs(stateRef.current, isConfigured, userId)) {
        pendingSyncRef.current = true
        setPendingSyncFlag(true)
      }
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

        if (!canSyncState(snapshot, isConfigured, snapshotUserId, isOnline)) {
          dispatch({
            type: 'SET_CLOUD_SYNC_STATE',
            cloudSync: {
              status: !isConfigured || !isOnline ? 'offline' : 'idle',
            },
          })
          if (!isOnline && hasSyncPrereqs(snapshot, isConfigured, snapshotUserId)) {
            pendingSyncRef.current = true
            setPendingSyncFlag(true)
          }
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
            gameStatus: 'in_progress',
            playerIdMap: synced.playerIdMap,
            status: 'synced',
            lastSyncedAt: synced.syncedAt,
            lastError: null,
          },
        })
        if (snapshotUserId) {
          setResumeTarget(snapshotUserId, synced.gameId)
        }
        pendingSyncRef.current = false
        setPendingSyncFlag(false)
      } while (queueAnotherSyncRef.current)
    } catch (error) {
      if (isLikelyNetworkError(error)) {
        pendingSyncRef.current = true
        setPendingSyncFlag(true)
        dispatch({
          type: 'SET_CLOUD_SYNC_STATE',
          cloudSync: {
            status: 'offline',
            lastError: null,
          },
        })
        return
      }
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
  }, [isConfigured, isOnline, userId])

  const flushCloudSync = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    void runCloudSync()
  }, [runCloudSync])

  const syncFingerprint = buildSyncFingerprint(state)
  const shouldSync = canSyncState(state, isConfigured, userId, isOnline)

  useEffect(() => {
    if (!isOnline && hasSyncPrereqs(stateRef.current, isConfigured, userId)) {
      pendingSyncRef.current = true
      setPendingSyncFlag(true)
    }
  }, [isConfigured, isOnline, syncFingerprint, userId])

  // Restore durable pending-sync flag on load so we sync after reopen when user had been offline
  useEffect(() => {
    if (isConfigured && userId && isOnline && getPendingSyncFlag()) {
      pendingSyncRef.current = true
    }
  }, [isConfigured, isOnline, userId])

  useEffect(() => {
    if (!isOnline || !pendingSyncRef.current) return
    if (!canSyncState(stateRef.current, isConfigured, userId, isOnline)) return
    void runCloudSync()
  }, [isConfigured, isOnline, runCloudSync, userId])

  useEffect(() => {
    if (!shouldSync) return

    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current)
    }

    debounceTimerRef.current = window.setTimeout(() => {
      void runCloudSync()
    }, 150)

    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
  }, [runCloudSync, shouldSync, syncFingerprint])

  return (
    <GameContext.Provider value={{ state, dispatch, flushCloudSync }}>
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
