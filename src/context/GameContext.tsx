import {
  createContext,
  useContext,
  useReducer,
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  type ReactNode,
} from 'react'
import type {
  GameState,
  GameAction,
  CloudSyncState,
  CloudSyncStatus,
  SportConfig,
} from '../types'
import { useAuth } from './AuthContext'
import {
  syncGameSnapshotToCloud,
  loadLatestCloudGame,
  loadCloudGameById,
  getLastOpenedPreferenceSupport,
} from '../lib/cloudSync'
import { supabase } from '../lib/supabase'
import { isPersistedSyncLastErrorNetworkish, logClientSyncError } from '../lib/logClientSyncError'
import { sanitizePlayerIdMapForCloud } from '../lib/uuidValidation'
import { playerIdMapForRoster, shotChartForRoster } from '../lib/rosterAlignment'
import { sports } from '../config/sports'
import {
  buildGameSyncFingerprint,
  canHydrateAsActiveGame,
  currentPeriodForCloudHydrate,
  shouldBlockDiscardUnsyncedGame,
  shouldDeferCloudResumeHydration,
  shouldRejectSkippedFinalSync,
  shouldSkipAutoHydrateForDifferentCloudGame,
  withLastSyncedGameFingerprint,
} from '../lib/gameSyncFingerprint'
import {
  createInitialCloudSyncState,
  createInitialState,
  gameReducer,
} from '../lib/gameReducer'
import {
  activateParkedGame,
  beginNewActiveParkedGame,
  discardParkedGame as discardParkedGameStorage,
  getActiveLocalGameId,
  getParkedGameRecord,
  hasDirtyParkedGames,
  listDirtyParkedGameRecords,
  listParkedGameRecords,
  listParkedGames,
  loadActiveParkedGameState,
  parkActiveGame,
  parkedGameStorageErrorMessage,
  saveActiveGameState,
  saveParkedGameRecordState,
  type ParkedGameRecord,
  type ParkedGameSummary,
} from '../lib/gameParking'

import {
  GAME_STORAGE_KEY,
  getPendingSyncFlag,
  setPendingSyncFlag,
} from '../lib/gameStorageKeys'

export { GAME_STORAGE_KEY } from '../lib/gameStorageKeys'

const CLOUD_RESUME_TARGETS_KEY = 'statkeeper_cloud_resume_targets'
/** One row per user+message: persisted `cloudSync.lastError` uploaded to `client_sync_errors`. */
const SYNC_LAST_ERROR_BACKFILL_PREFIX = 'statkeeper_sync_err_backfill:'

const CLOUD_SYNC_STATUSES: CloudSyncStatus[] = [
  'offline',
  'idle',
  'syncing',
  'synced',
  'error',
]

function normalizeCloudStatus(value: unknown, fallback: CloudSyncStatus): CloudSyncStatus {
  if (typeof value === 'string' && CLOUD_SYNC_STATUSES.includes(value as CloudSyncStatus)) {
    return value as CloudSyncStatus
  }

  return fallback
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

function buildHydratedStateFromCloudGame(
  cloudGame: Awaited<ReturnType<typeof loadLatestCloudGame>>,
  localState?: GameState
): GameState | null {
  if (!cloudGame) return null
  const sport = sports.find(item => item.id === cloudGame.sportId)
  if (!sport) return null

  return withLastSyncedGameFingerprint({
    sport,
    gameInfo: cloudGame.gameInfo,
    players: cloudGame.players,
    activePlayerId: cloudGame.activePlayerId,
    opponentScore: cloudGame.opponentScore,
    homeTeamScore: cloudGame.homeTeamScore,
    homeScoreAdjustment: cloudGame.homeScoreAdjustment,
    notes: cloudGame.notes,
    currentPeriod: localState
      ? currentPeriodForCloudHydrate(localState, cloudGame.gameId)
      : 1,
    teamStatsConfig: cloudGame.teamStatsConfig,
    actionLog: [],
    shotChart: cloudGame.shotChart ?? [],
    cloudSync: {
      ...createInitialCloudSyncState('synced'),
      seasonId: cloudGame.seasonId ?? null,
      teamId: cloudGame.teamId,
      gameId: cloudGame.gameId,
      gameStatus: cloudGame.status,
      playerIdMap: cloudGame.playerIdMap,
      lastSyncedAt: cloudGame.hydratedAt,
      status: 'synced',
      lastError: null,
      shotChartHydrationDroppedRows: cloudGame.shotChartHydrationDroppedRows ?? 0,
    },
  })
}

function loadState(userId: string | null): GameState {
  try {
    const parkedState = loadActiveParkedGameState(userId)
    const saved = parkedState ? JSON.stringify(parkedState) : localStorage.getItem(GAME_STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<GameState>
      // Drop cleanly synced finals. Keep skipped-final / fingerprint-ahead locals so reload
      // cannot wipe stats that discard guards are meant to protect. Use pendingDurable=false
      // so a dirty *other* parked game does not force restoring a clean final.
      if (
        parsed.cloudSync?.gameStatus === 'final' &&
        !shouldBlockDiscardUnsyncedGame(parsed as GameState, false)
      ) {
        return createInitialState()
      }
      const fallbackStatus = normalizeCloudStatus(parsed.cloudSync?.status, 'idle')
      const restoredStatus = fallbackStatus === 'syncing' ? 'idle' : fallbackStatus

      const restoredPlayers = Array.isArray(parsed.players) ? parsed.players : []
      const sanitizedMap = sanitizePlayerIdMapForCloud(parsed.cloudSync?.playerIdMap ?? {})

      return {
        ...createInitialState(restoredStatus),
        ...parsed,
        homeTeamScore: typeof parsed.homeTeamScore === 'number' ? parsed.homeTeamScore : null,
        homeScoreAdjustment: typeof parsed.homeScoreAdjustment === 'number' ? parsed.homeScoreAdjustment : 0,
        notes: typeof parsed.notes === 'string' ? parsed.notes : '',
        currentPeriod:
          typeof parsed.currentPeriod === 'number' && parsed.currentPeriod >= 1
            ? Math.floor(parsed.currentPeriod)
            : 1,
        teamStatsConfig: parsed.teamStatsConfig ?? null,
        shotChart: shotChartForRoster(Array.isArray(parsed.shotChart) ? parsed.shotChart : [], restoredPlayers),
        players: restoredPlayers,
        actionLog: Array.isArray(parsed.actionLog) ? parsed.actionLog : [],
        cloudSync: {
          ...createInitialCloudSyncState(restoredStatus),
          ...(parsed.cloudSync ?? {}),
          playerIdMap: playerIdMapForRoster(sanitizedMap, restoredPlayers),
          gameStatus: parsed.cloudSync?.gameStatus ?? null,
          status: restoredStatus,
          shotChartHydrationDroppedRows:
            typeof parsed.cloudSync?.shotChartHydrationDroppedRows === 'number'
              ? Math.max(0, Math.floor(parsed.cloudSync.shotChartHydrationDroppedRows))
              : 0,
          lastSyncedGameFingerprint:
            typeof parsed.cloudSync?.lastSyncedGameFingerprint === 'string'
              ? parsed.cloudSync.lastSyncedGameFingerprint
              : null,
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
  activeLocalGameId: string | null
  parkedGames: ParkedGameSummary[]
  parkingError: string | null
  clearParkingError: () => void
  startNewGame: (sport: SportConfig) => boolean
  openGameSnapshot: (state: GameState) => boolean
  parkCurrentGame: () => boolean
  resumeParkedGame: (localGameId: string) => GameState | null
  discardParkedGame: (localGameId: string) => boolean
  /** Trigger an immediate cloud sync; resolves when the sync attempt finishes. */
  flushCloudSync: () => Promise<FlushCloudSyncResult>
}

export type FlushCloudSyncResult =
  | { ok: true }
  | { ok: false; reason: string }

const GameContext = createContext<GameContextType | null>(null)

export function GameProvider({ children }: { children: ReactNode }) {
  const { user, isConfigured } = useAuth()
  const userId = user?.id ?? null
  const [state, dispatch] = useReducer(gameReducer, userId, loadState)
  const [isOnline, setIsOnline] = useState(getInitialOnlineState)
  const [parkedGames, setParkedGames] = useState<ParkedGameSummary[]>(() =>
    listParkedGames(userId)
  )
  const [activeLocalGameId, setActiveLocalGameId] = useState<string | null>(() =>
    getActiveLocalGameId(userId)
  )
  const [parkingError, setParkingError] = useState<string | null>(null)
  const [syncRetryTick, setSyncRetryTick] = useState(0)
  const stateRef = useRef(state)
  const syncInFlightRef = useRef(false)
  const queueAnotherSyncRef = useRef(false)
  /** Seeded from localStorage so cloud hydration cannot race ahead of the pending-sync restore effect. */
  const pendingSyncRef = useRef(getPendingSyncFlag())
  const debounceTimerRef = useRef<number | null>(null)
  const prevUserIdRef = useRef<string | null>(userId)
  const hydratedUserRef = useRef<string | null>(null)

  useLayoutEffect(() => {
    stateRef.current = state
  }, [state])

  /** Upload a previously persisted sync error once (before `client_sync_errors` existed or insert failed). */
  useEffect(() => {
    if (!isConfigured || !userId || !supabase || !isOnline) return
    const msg = state.cloudSync.lastError?.trim()
    if (!msg || state.cloudSync.status !== 'error') return
    if (isPersistedSyncLastErrorNetworkish(msg)) return

    const key = `${SYNC_LAST_ERROR_BACKFILL_PREFIX}${userId}:${msg}`
    try {
      if (localStorage.getItem(key) === '1') return
    } catch {
      return
    }

    let cancelled = false
    void (async () => {
      const ok = await logClientSyncError(userId, msg, stateRef.current, {
        bypassThrottle: true,
        extraContext: { source: 'localStorage_backfill' },
      })
      if (cancelled || !ok) return
      try {
        localStorage.setItem(key, '1')
      } catch {
        // ignore
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    isConfigured,
    userId,
    isOnline,
    state.cloudSync.lastError,
    state.cloudSync.status,
  ])

  useEffect(() => {
    try {
      setParkedGames(saveActiveGameState(state, userId))
      setActiveLocalGameId(getActiveLocalGameId(userId))
    } catch (error) {
      setParkingError(parkedGameStorageErrorMessage(error))
    }
  }, [state, userId])

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
      setParkedGames(listParkedGames(userId))
      setActiveLocalGameId(getActiveLocalGameId(userId))
      hydratedUserRef.current = null
      prevUserIdRef.current = userId
    }
  }, [isConfigured, isOnline, userId])

  const startNewGame = useCallback(
    (sport: SportConfig) => {
      try {
        saveActiveGameState(stateRef.current, userId)
        beginNewActiveParkedGame(userId)
        setActiveLocalGameId(getActiveLocalGameId(userId))
        setParkedGames(listParkedGames(userId))
        setParkingError(null)
        dispatch({ type: 'SET_SPORT', sport })
        return true
      } catch (error) {
        setParkingError(parkedGameStorageErrorMessage(error))
        return false
      }
    },
    [userId]
  )

  const openGameSnapshot = useCallback(
    (nextState: GameState) => {
      let createdLocalGameId: string | null = null
      let previousActiveLocalGameId: string | null = null
      try {
        saveActiveGameState(stateRef.current, userId)
        previousActiveLocalGameId = getActiveLocalGameId(userId)
        createdLocalGameId = beginNewActiveParkedGame(userId)
        saveActiveGameState(nextState, userId)
        stateRef.current = nextState
        dispatch({ type: 'HYDRATE_STATE', state: nextState })
        setActiveLocalGameId(getActiveLocalGameId(userId))
        setParkedGames(listParkedGames(userId))
        setParkingError(null)
        return true
      } catch (error) {
        if (createdLocalGameId) {
          try {
            discardParkedGameStorage(createdLocalGameId, userId)
          } catch {
            // Ignore rollback cleanup failures; the original storage error is surfaced below.
          }
        }
        if (previousActiveLocalGameId) {
          try {
            activateParkedGame(previousActiveLocalGameId, userId)
          } catch {
            // Ignore rollback restore failures; the in-memory game remains unchanged.
          }
        }
        try {
          setActiveLocalGameId(getActiveLocalGameId(userId))
          setParkedGames(listParkedGames(userId))
        } catch {
          // ignore secondary refresh failures
        }
        setParkingError(parkedGameStorageErrorMessage(error))
        return false
      }
    },
    [userId]
  )

  const parkCurrentGame = useCallback(() => {
    try {
      saveActiveGameState(stateRef.current, userId)
      setParkedGames(parkActiveGame(userId))
      setActiveLocalGameId(null)
      setParkingError(null)
      dispatch({ type: 'RESET_GAME' })
      return true
    } catch (error) {
      setParkingError(parkedGameStorageErrorMessage(error))
      return false
    }
  }, [userId])

  const resumeParkedGame = useCallback(
    (localGameId: string) => {
      try {
        saveActiveGameState(stateRef.current, userId)
        const nextState = activateParkedGame(localGameId, userId)
        if (!nextState) return null
        stateRef.current = nextState
        dispatch({ type: 'HYDRATE_STATE', state: nextState })
        setActiveLocalGameId(localGameId)
        setParkedGames(listParkedGames(userId))
        setParkingError(null)
        return nextState
      } catch (error) {
        setParkingError(parkedGameStorageErrorMessage(error))
        return null
      }
    },
    [userId]
  )

  const discardParkedGame = useCallback(
    (localGameId: string) => {
      const record = getParkedGameRecord(localGameId, userId)
      if (
        record &&
        shouldBlockDiscardUnsyncedGame(record.gameState, record.sync.dirty)
      ) {
        setParkingError(
          'This parked game has unsynced cloud stats. Resume and sync it before discarding.'
        )
        return false
      }

      const wasActive = getActiveLocalGameId(userId) === localGameId
      try {
        setParkedGames(discardParkedGameStorage(localGameId, userId))
        setActiveLocalGameId(getActiveLocalGameId(userId))
        setParkingError(null)
        if (wasActive) {
          dispatch({ type: 'RESET_GAME' })
        }
        return true
      } catch (error) {
        setParkingError(parkedGameStorageErrorMessage(error))
        return false
      }
    },
    [userId]
  )

  useEffect(() => {
    if (!isConfigured || !userId || !supabase) return
    if (hydratedUserRef.current === userId) return

    let cancelled = false
    const hydrateFromCloud = async () => {
      // Skip auto-resume when local progress is not yet reflected in the last synced fingerprint,
      // when there is no cloud game id yet, or when `statkeeper_pending_sync` is set (offline / network
      // failure path). Otherwise a cloud fetch can overwrite newer localStorage state (silent data loss).
      if (shouldDeferCloudResumeHydration(stateRef.current, getPendingSyncFlag())) {
        hydratedUserRef.current = userId
        return
      }

      const fingerprintBeforeFetch = buildGameSyncFingerprint(stateRef.current)

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

        const nextState = buildHydratedStateFromCloudGame(cloudGame, stateRef.current)
        if (!nextState) {
          // `null` from API: nothing to resume. Non-null `cloudGame` but null state (e.g. unknown sport):
          // do not mark hydrated — a later retry may succeed if data changes.
          if (cloudGame === null) {
            hydratedUserRef.current = userId
          }
          return
        }

        if (
          shouldSkipAutoHydrateForDifferentCloudGame(
            stateRef.current,
            nextState.cloudSync.gameId
          )
        ) {
          // Local session is already bound to a different cloud game. Manual open parks first;
          // auto-hydrate must not overwrite that active localStorage slot.
          hydratedUserRef.current = userId
          return
        }

        if (nextState.cloudSync.gameId && canHydrateAsActiveGame(nextState.cloudSync.gameStatus ?? '')) {
          setResumeTarget(userId, nextState.cloudSync.gameId)
        }

        if (buildGameSyncFingerprint(stateRef.current) !== fingerprintBeforeFetch) {
          // Local game changed while the cloud fetch was in flight; do not replace it with stale data.
          hydratedUserRef.current = userId
          return
        }

        hydratedUserRef.current = userId
        stateRef.current = nextState
        dispatch({ type: 'HYDRATE_STATE', state: nextState })
      } catch (error) {
        if (cancelled) return
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
  }, [isConfigured, isOnline, userId])

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

  const refreshParkingState = useCallback(() => {
    setParkedGames(listParkedGames(userId))
    setActiveLocalGameId(getActiveLocalGameId(userId))
    pendingSyncRef.current = hasDirtyParkedGames(userId)
    setPendingSyncFlag(pendingSyncRef.current)
  }, [userId])

  const syncParkedRecord = useCallback(
    async (record: ParkedGameRecord) => {
      const snapshot = record.gameState
      const snapshotFingerprint = buildGameSyncFingerprint(snapshot)
      const snapshotUserId = userId
      if (!getParkedGameRecord(record.localGameId, snapshotUserId)) return

      const isActiveRecord = getActiveLocalGameId(snapshotUserId) === record.localGameId

      if (!canSyncState(snapshot, isConfigured, snapshotUserId, isOnline)) {
        if (!isOnline && hasSyncPrereqs(snapshot, isConfigured, snapshotUserId)) {
          const offlineState: GameState = {
            ...snapshot,
            cloudSync: {
              ...snapshot.cloudSync,
              status: 'offline',
              lastError: null,
            },
          }
          saveParkedGameRecordState(record.localGameId, offlineState, snapshotUserId, {
            dirty: true,
            lastError: null,
            nextAttemptAt: null,
          })
          if (isActiveRecord) {
            dispatch({
              type: 'SET_CLOUD_SYNC_STATE',
              cloudSync: {
                status: 'offline',
                lastError: null,
              },
            })
          }
        }
        return
      }

      const syncingState: GameState = {
        ...snapshot,
        cloudSync: {
          ...snapshot.cloudSync,
          status: 'syncing',
          lastError: null,
        },
      }
      saveParkedGameRecordState(record.localGameId, syncingState, snapshotUserId, {
        dirty: true,
        lastError: null,
        nextAttemptAt: null,
      })
      refreshParkingState()
      if (isActiveRecord) {
        dispatch({
          type: 'SET_CLOUD_SYNC_STATE',
          cloudSync: {
            status: 'syncing',
            lastError: null,
          },
        })
      }

      try {
        const synced = await syncGameSnapshotToCloud({
          state: snapshot,
          userId: snapshotUserId!,
        })
        const latestRecord = getParkedGameRecord(record.localGameId, snapshotUserId)
        if (!latestRecord) return

        const latestState = latestRecord.gameState
        const isStillActiveRecord = getActiveLocalGameId(snapshotUserId) === record.localGameId

        // Reject when either the sync-start snapshot OR post-await local state still has
        // unsynced edits. Checking only `snapshot` let mid-sync edits report success while
        // cloud stayed final and `gameStatus: 'final'` cleared the dirty queue forever.
        if (
          synced.skippedFinalGame &&
          (shouldRejectSkippedFinalSync(snapshot) ||
            shouldRejectSkippedFinalSync(latestState))
        ) {
          const errorState: GameState = {
            ...latestState,
            cloudSync: {
              ...latestState.cloudSync,
              gameStatus: 'final',
              status: 'error',
              lastError: 'Game was finalized elsewhere. Unsynced stats could not be saved.',
            },
          }
          saveParkedGameRecordState(record.localGameId, errorState, snapshotUserId, {
            // Stop auto-retry (cloud is final / hasSyncPrereqs false). Fingerprint mismatch
            // still blocks discard via shouldBlockDiscardUnsyncedGame.
            dirty: false,
            attempts: latestRecord.sync.attempts + 1,
            lastError: errorState.cloudSync.lastError,
            nextAttemptAt: null,
          })
          if (isStillActiveRecord) {
            dispatch({
              type: 'SET_CLOUD_SYNC_STATE',
              cloudSync: {
                gameStatus: 'final',
                status: 'error',
                lastError: errorState.cloudSync.lastError,
              },
            })
          }
          return
        }

        const cloudSyncPatch: Partial<CloudSyncState> = {
          seasonId: synced.seasonId,
          teamId: synced.teamId,
          gameId: synced.gameId,
          gameStatus: synced.skippedFinalGame ? 'final' : 'in_progress',
          playerIdMap: synced.playerIdMap,
          status: 'synced',
          lastSyncedAt: synced.syncedAt,
          lastError: null,
          shotChartHydrationDroppedRows:
            synced.shotChartCloudSync === 'synced'
              ? 0
              : snapshot.cloudSync.shotChartHydrationDroppedRows,
          lastSyncedGameFingerprint: snapshotFingerprint,
        }
        const nextState: GameState = {
          ...latestState,
          cloudSync: {
            ...latestState.cloudSync,
            ...cloudSyncPatch,
          },
        }
        saveParkedGameRecordState(record.localGameId, nextState, snapshotUserId, {
          attempts: 0,
          lastError: null,
          nextAttemptAt: null,
        })
        if (snapshotUserId && isStillActiveRecord) {
          setResumeTarget(snapshotUserId, synced.gameId)
        }
        if (isStillActiveRecord) {
          dispatch({
            type: 'SET_CLOUD_SYNC_STATE',
            cloudSync: cloudSyncPatch,
          })
        }
      } catch (error) {
        const networkish = isLikelyNetworkError(error)
        const errMsg = error instanceof Error ? error.message : 'Cloud sync failed'
        const latestRecord = getParkedGameRecord(record.localGameId, snapshotUserId)
        if (!latestRecord) return

        const latestState = latestRecord.gameState
        const attempts = latestRecord.sync.attempts + 1
        const retryMs = Math.min(30_000, 1000 * 2 ** Math.min(attempts, 5))
        const errorState: GameState = {
          ...latestState,
          cloudSync: {
            ...latestState.cloudSync,
            status: networkish ? 'offline' : 'error',
            lastError: networkish ? null : errMsg,
          },
        }
        saveParkedGameRecordState(record.localGameId, errorState, snapshotUserId, {
          dirty: true,
          attempts,
          lastError: networkish ? null : errMsg,
          nextAttemptAt: retryMs > 0 ? new Date(Date.now() + retryMs).toISOString() : null,
        })
        if (getActiveLocalGameId(snapshotUserId) === record.localGameId) {
          dispatch({
            type: 'SET_CLOUD_SYNC_STATE',
            cloudSync: {
              status: networkish ? 'offline' : 'error',
              lastError: networkish ? null : errMsg,
            },
          })
        }
        if (!networkish && snapshotUserId) {
          void logClientSyncError(snapshotUserId, errMsg, latestState)
        }
      } finally {
        refreshParkingState()
      }
    },
    [isConfigured, isOnline, refreshParkingState, userId]
  )

  const runCloudSync = useCallback(async () => {
    if (!isConfigured || !userId || !supabase) return

    if (!isOnline) {
      pendingSyncRef.current = hasDirtyParkedGames(userId)
      setPendingSyncFlag(pendingSyncRef.current)
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
        const dirtyRecords = listDirtyParkedGameRecords(userId)
        if (dirtyRecords.length === 0) break

        for (const record of dirtyRecords) {
          await syncParkedRecord(record)
        }
      } while (queueAnotherSyncRef.current)
    } finally {
      syncInFlightRef.current = false
      refreshParkingState()
    }
  }, [isConfigured, isOnline, refreshParkingState, syncParkedRecord, userId])

  const flushCloudSync = useCallback(async (): Promise<FlushCloudSyncResult> => {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    await runCloudSync()
    const activeId = getActiveLocalGameId(userId)
    const activeRecord = activeId ? getParkedGameRecord(activeId, userId) : null
    const s = activeRecord?.gameState ?? stateRef.current
    if (s.cloudSync.status === 'error') {
      return { ok: false, reason: s.cloudSync.lastError ?? 'Cloud sync failed' }
    }
    if (!isOnline || s.cloudSync.status === 'offline') {
      return { ok: false, reason: 'Offline — connect to sync before continuing' }
    }
    if (activeRecord?.sync.dirty || shouldDeferCloudResumeHydration(s, getPendingSyncFlag())) {
      return { ok: false, reason: 'Latest changes could not be synced. Try again.' }
    }
    return { ok: true }
  }, [isOnline, runCloudSync, userId])

  const syncFingerprint = buildGameSyncFingerprint(state)
  const queueFingerprint = parkedGames
    .map(
      game =>
        `${game.localGameId}:${game.updatedAt}:${game.syncStatus}:${game.syncDirty}:${game.syncLastError ?? ''}`
    )
    .join('|')
  const shouldSync = Boolean(
    isConfigured &&
      userId &&
      supabase &&
      isOnline &&
      hasDirtyParkedGames(userId)
  )

  // Restore durable pending-sync flag on load so we sync after reopen when user had been offline
  useEffect(() => {
    pendingSyncRef.current = hasDirtyParkedGames(userId)
    setPendingSyncFlag(pendingSyncRef.current)
  }, [isConfigured, isOnline, queueFingerprint, userId])

  useEffect(() => {
    if (!isOnline || !hasDirtyParkedGames(userId)) return
    if (!isConfigured || !userId || !supabase) return
    void runCloudSync()
  }, [isConfigured, isOnline, queueFingerprint, runCloudSync, syncRetryTick, userId])

  useEffect(() => {
    if (!isConfigured || !isOnline || !userId || !supabase) return
    const nextAttemptMs = listParkedGameRecords(userId)
      .filter(record => record.sync.dirty && record.sync.nextAttemptAt)
      .map(record => Date.parse(record.sync.nextAttemptAt!))
      .filter(ms => !Number.isNaN(ms))
      .sort((a, b) => a - b)[0]
    if (nextAttemptMs == null) return

    const delay = Math.max(0, nextAttemptMs - Date.now())
    const timer = window.setTimeout(() => {
      setSyncRetryTick(tick => tick + 1)
    }, Math.min(delay, 30_000))

    return () => {
      window.clearTimeout(timer)
    }
  }, [isConfigured, isOnline, queueFingerprint, userId])

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
  }, [runCloudSync, shouldSync, syncFingerprint, queueFingerprint])

  return (
    <GameContext.Provider
      value={{
        state,
        dispatch,
        activeLocalGameId,
        parkedGames,
        parkingError,
        clearParkingError: () => setParkingError(null),
        startNewGame,
        openGameSnapshot,
        parkCurrentGame,
        resumeParkedGame,
        discardParkedGame,
        flushCloudSync,
      }}
    >
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
