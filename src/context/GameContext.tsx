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
import {
  SoccerCloudRecoveryError,
  syncSoccerEventGameToCloud,
} from '../lib/soccer/cloudSync'
import {
  BasketballCloudRecoveryError,
  syncBasketballEventGameToCloud,
} from '../lib/basketball/cloudSync'
import { enableBasketballEventCloud } from '../lib/basketball/enableCloudSync'
import {
  applyBasketballReopenHandoff,
  loadBasketballReopenHandoff,
  type BasketballReopenHandoff,
} from '../lib/basketball/reopenHandoff'
import {
  pauseRunningBasketballClockForWorkflow,
  shouldInterceptRunningBasketballClock,
  type BasketballWorkflowAction,
} from '../lib/basketball/productionClockPolicy'
import {
  eventConflictRecoveryFingerprint,
  resolveEventConflictInState,
} from '../lib/gameEvents/eventConflictResolution'
import { deletedSourcePlayerRecoverySettlementPatch } from '../lib/gameEvents/deletedSourceRecovery'
import { eventCloudTransportAdapterForSport } from '../lib/eventCloudTransportAdapters'
import { supabase } from '../lib/supabase'
import { isPersistedSyncLastErrorNetworkish, logClientSyncError } from '../lib/logClientSyncError'
import { sanitizePlayerIdMapForCloud } from '../lib/uuidValidation'
import { playerIdMapForRoster, shotChartForRoster } from '../lib/rosterAlignment'
import { normalizeGameEventStream } from '../lib/gameEvents/stream'
import { normalizeSportGameState } from '../lib/sportGameState/state'
import { normalizeBasketballEventCloudPolicyState } from '../lib/basketball/eventCloudPolicy'
import { normalizeGameDataAuthority } from '../lib/gameEvents/authority'
import { getBasketballEventCreationPolicy } from '../lib/sportAvailability'
import { loadSettingsFromStorage } from '../lib/settingsStorage'
import { rebuildGameEventProjection } from '../lib/gameEvents/projection'
import { gameEventProjectors, gameEventRegistry } from '../lib/gameEvents/runtime'
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
  cloudSyncRouteForState,
  isEventCloudSyncEligible,
  isCloudSyncEligible,
  isSoccerEventCloudSyncEligible,
} from '../lib/gameSyncFingerprint'
import {
  createInitialCloudSyncState,
  createInitialState,
  gameReducer,
} from '../lib/gameReducer'
import {
  activeCloudSyncStateAction,
  resolvedCloudGameStatus,
} from '../lib/cloudSyncState'
import {
  activateParkedGame,
  beginNewActiveParkedGame,
  commitGameSetupState,
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
  saveParkedGameRecordStateAtomically,
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

function workflowConfirmationMessage(action: BasketballWorkflowAction): string {
  switch (action) {
    case 'park_commit':
      return 'Park the current game and continue?'
    case 'setup_replace_commit':
      return 'Park the current game and continue with this setup?'
    case 'new_game_commit':
      return 'Park the current game and start another?'
    case 'resume_commit':
      return 'Park the current game and open the selected game?'
    case 'reload_commit':
      return 'Reload to apply the app update? Your current game remains saved.'
    case 'setup_visit':
    case 'setup_edit':
    case 'setup_cancel':
    case 'route_navigation':
    case 'workspace_tab':
      return 'Continue?'
  }
}

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
    isCloudSyncEligible(state) &&
    (
      state.cloudSync.gameStatus !== 'final' ||
      isSoccerEventCloudSyncEligible(state)
    )
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
    gameDataAuthority: null,
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
    eventStream: null,
    sportGameState: null,
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

      const restoredState = normalizeBasketballEventCloudPolicyState({
        ...createInitialState(restoredStatus),
        ...parsed,
        gameDataAuthority: normalizeGameDataAuthority(parsed.gameDataAuthority),
        homeTeamScore: typeof parsed.homeTeamScore === 'number' ? parsed.homeTeamScore : null,
        homeScoreAdjustment: typeof parsed.homeScoreAdjustment === 'number' ? parsed.homeScoreAdjustment : 0,
        notes: typeof parsed.notes === 'string' ? parsed.notes : '',
        currentPeriod:
          typeof parsed.currentPeriod === 'number' && parsed.currentPeriod >= 1
            ? Math.floor(parsed.currentPeriod)
            : 1,
        teamStatsConfig: parsed.teamStatsConfig ?? null,
        eventStream: normalizeGameEventStream(parsed.eventStream),
        sportGameState: normalizeSportGameState(parsed.sportGameState),
        basketballCourtOrientation:
          parsed.basketballCourtOrientation === 'flipped' ? 'flipped' : 'standard',
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
          eventSyncBase:
            parsed.cloudSync?.eventSyncBase && typeof parsed.cloudSync.eventSyncBase === 'object'
              ? parsed.cloudSync.eventSyncBase
              : {},
          eventConflicts: Array.isArray(parsed.cloudSync?.eventConflicts)
            ? parsed.cloudSync.eventConflicts
            : [],
          pendingEventConflictResolutions: Array.isArray(
            parsed.cloudSync?.pendingEventConflictResolutions
          )
            ? parsed.cloudSync.pendingEventConflictResolutions
            : [],
        },
      })
      return rebuildGameEventProjection(
        restoredState,
        gameEventRegistry,
        gameEventProjectors
      ).state
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
  prepareActiveGameMutation: (action: BasketballWorkflowAction) => boolean
  startNewGame: (sport: SportConfig) => boolean
  commitGameSetup: (
    nextState: GameState,
    expectedLocalGameId?: string | null
  ) => CommitGameSetupResult
  openGameSnapshot: (state: GameState) => boolean
  parkCurrentGame: () => boolean
  resumeParkedGame: (localGameId: string) => GameState | null
  discardParkedGame: (localGameId: string) => boolean
  /** Trigger an immediate cloud sync; resolves when the sync attempt finishes. */
  flushCloudSync: () => Promise<FlushCloudSyncResult>
  flushCloudGameSync: (gameId: string) => Promise<FlushCloudSyncResult>
  recoverDeletedEventParticipantSources: () => Promise<FlushCloudSyncResult>
  enableBasketballCloudSync: () => Promise<FlushCloudSyncResult>
  markEventCloudGameReopened: (
    gameId: string,
    handoff?: BasketballReopenHandoff | null
  ) => Promise<void>
  resolveEventConflict: (
    eventId: string,
    resolution: 'local' | 'remote'
  ) => { ok: true } | { ok: false; reason: string }
}

export type FlushCloudSyncResult =
  | { ok: true }
  | { ok: false; reason: string }

export type CommitGameSetupResult =
  | { ok: true; localGameId: string }
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
  const eventCloudEligible = isEventCloudSyncEligible(state)

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

  const prepareActiveGameMutation = useCallback(
    (action: BasketballWorkflowAction) => {
      const current = stateRef.current
      const hasActiveGame = Boolean(
        current.sport &&
        (current.gameInfo || current.players.length > 0 || current.eventStream || current.sportGameState)
      )
      if (!hasActiveGame) return true

      const runningClock = shouldInterceptRunningBasketballClock(current, action)
      if (action === 'reload_commit' && !runningClock) return true

      const message = runningClock
        ? 'The Basketball clock is running. Pause and continue?'
        : workflowConfirmationMessage(action)
      if (!window.confirm(message)) return false
      if (!runningClock) return true

      const paused = pauseRunningBasketballClockForWorkflow(current, action, {
        recorderUserId: userId,
      })
      if (!paused.ok) {
        setParkingError(paused.message)
        return false
      }
      try {
        setParkedGames(saveActiveGameState(paused.state, userId))
        setActiveLocalGameId(getActiveLocalGameId(userId))
      } catch (error) {
        setParkingError(parkedGameStorageErrorMessage(error))
        return false
      }
      stateRef.current = paused.state
      dispatch({ type: 'HYDRATE_STATE', state: paused.state })
      setParkingError(null)
      return true
    },
    [userId]
  )

  const blockUnpreparedRunningClock = useCallback(
    (action: BasketballWorkflowAction) => {
      if (!shouldInterceptRunningBasketballClock(stateRef.current, action)) return false
      setParkingError('Pause the running Basketball clock before parking or opening another game.')
      return true
    },
    []
  )

  const startNewGame = useCallback(
    (sport: SportConfig) => {
      if (blockUnpreparedRunningClock('new_game_commit')) return false
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
    [blockUnpreparedRunningClock, userId]
  )

  const commitGameSetup = useCallback(
    (
      nextState: GameState,
      expectedLocalGameId: string | null = null
    ): CommitGameSetupResult => {
      if (
        !expectedLocalGameId &&
        blockUnpreparedRunningClock('setup_replace_commit')
      ) {
        return {
          ok: false,
          reason: 'Pause the running Basketball clock before replacing this game.',
        }
      }
      try {
        const committed = commitGameSetupState(
          stateRef.current,
          nextState,
          userId,
          expectedLocalGameId,
          // Persisted state is authoritative here so stale tabs and failed preference writes refuse.
          getBasketballEventCreationPolicy(
            loadSettingsFromStorage().basketball.eventTrackerPreviewEnabled
          ).canCreateNewEventGame
        )
        stateRef.current = nextState
        dispatch({ type: 'HYDRATE_STATE', state: nextState })
        setActiveLocalGameId(committed.localGameId)
        setParkedGames(committed.summaries)
        setParkingError(null)
        return { ok: true, localGameId: committed.localGameId }
      } catch (error) {
        const reason = error instanceof Error
          ? error.message
          : parkedGameStorageErrorMessage(error)
        setParkingError(reason)
        return { ok: false, reason }
      }
    },
    [blockUnpreparedRunningClock, userId]
  )

  const openGameSnapshot = useCallback(
    (nextState: GameState) => {
      if (blockUnpreparedRunningClock('resume_commit')) return false
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
    [blockUnpreparedRunningClock, userId]
  )

  const parkCurrentGame = useCallback(() => {
    if (blockUnpreparedRunningClock('park_commit')) return false
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
  }, [blockUnpreparedRunningClock, userId])

  const resumeParkedGame = useCallback(
    (localGameId: string) => {
      if (
        getActiveLocalGameId(userId) !== localGameId &&
        blockUnpreparedRunningClock('resume_commit')
      ) return null
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
    [blockUnpreparedRunningClock, userId]
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
    if (!state.cloudSync.gameId || eventCloudEligible) return
    if (!canHydrateAsActiveGame(state.cloudSync.gameStatus ?? '')) return
    setResumeTarget(userId, state.cloudSync.gameId)
  }, [eventCloudEligible, state.cloudSync.gameId, state.cloudSync.gameStatus, userId])

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
      const snapshotRecoveryFingerprint = eventConflictRecoveryFingerprint(snapshot)
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
        const syncRoute = cloudSyncRouteForState(snapshot)
        const synced = syncRoute === 'soccer_events'
          ? await syncSoccerEventGameToCloud({
              state: snapshot,
              userId: snapshotUserId!,
              localGameId: record.localGameId,
            })
          : syncRoute === 'basketball_events'
          ? await syncBasketballEventGameToCloud({
              state: snapshot,
              userId: snapshotUserId!,
              localGameId: record.localGameId,
              assertCurrent: () => {
                if (prevUserIdRef.current !== snapshotUserId) {
                  throw new Error('The signed-in account changed before Basketball cloud sync.')
                }
              },
            })
          : syncRoute === 'aggregate'
          ? await syncGameSnapshotToCloud({
              state: snapshot,
              userId: snapshotUserId!,
            })
          : (() => {
              throw new Error('This game does not support cloud sync.')
            })()
        const latestRecord = getParkedGameRecord(record.localGameId, snapshotUserId)
        if (!latestRecord) return

        const latestState = latestRecord.gameState
        const isStillActiveRecord = getActiveLocalGameId(snapshotUserId) === record.localGameId

        // Reject when either the sync-start snapshot OR post-await local state still has
        // unsynced edits. Checking only `snapshot` let mid-sync edits report success while
        // cloud stayed final and `gameStatus: 'final'` cleared the dirty queue forever.
        if (
          'skippedFinalGame' in synced &&
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

        const syncedPayloadState = 'syncedState' in synced ? synced.syncedState : snapshot
        const localUnchanged =
          buildGameSyncFingerprint(latestState) === snapshotFingerprint &&
          eventConflictRecoveryFingerprint(latestState) === snapshotRecoveryFingerprint
        const payloadState =
          'syncedState' in synced && localUnchanged ? synced.syncedState : latestState
        const cloudSyncPatch: Partial<CloudSyncState> = {
          seasonId: synced.seasonId,
          teamId: synced.teamId,
          gameId: synced.gameId,
          gameStatus: resolvedCloudGameStatus(
            snapshot.cloudSync.gameStatus,
            synced
          ),
          playerIdMap: synced.playerIdMap,
          status: 'synced',
          lastSyncedAt: synced.syncedAt,
          lastError: null,
          shotChartHydrationDroppedRows:
            'shotChartCloudSync' in synced && synced.shotChartCloudSync === 'synced'
              ? 0
              : snapshot.cloudSync.shotChartHydrationDroppedRows,
          // Sticky until a sync completes with nothing left to repair, so the notice
          // survives the re-render that follows the repairing sync.
          repairedPlayerLinks:
            'repairedPlayerLinks' in synced ? synced.repairedPlayerLinks : undefined,
          lastSyncedGameFingerprint: buildGameSyncFingerprint(syncedPayloadState),
          eventSyncBase: localUnchanged
            ? syncedPayloadState.cloudSync.eventSyncBase ?? {}
            : latestState.cloudSync.eventSyncBase ?? {},
          eventConflicts: localUnchanged
            ? syncedPayloadState.cloudSync.eventConflicts ?? []
            : latestState.cloudSync.eventConflicts ?? [],
          pendingEventConflictResolutions: localUnchanged
            ? syncedPayloadState.cloudSync.pendingEventConflictResolutions ?? []
            : (latestState.cloudSync.pendingEventConflictResolutions ?? []).filter(
                pending => !(snapshot.cloudSync.pendingEventConflictResolutions ?? []).some(
                  uploaded => uploaded.conflictId === pending.conflictId
                )
              ),
          ...deletedSourcePlayerRecoverySettlementPatch(),
        }
        const nextState: GameState = {
          ...payloadState,
          cloudSync: {
            ...payloadState.cloudSync,
            ...cloudSyncPatch,
          },
        }
        saveParkedGameRecordState(record.localGameId, nextState, snapshotUserId, {
          attempts: 0,
          lastError: null,
          nextAttemptAt: null,
        })
        if (
          snapshotUserId &&
          isStillActiveRecord &&
          !isEventCloudSyncEligible(snapshot)
        ) {
          setResumeTarget(snapshotUserId, synced.gameId)
        }
        if (isStillActiveRecord) {
          dispatch(activeCloudSyncStateAction(
            nextState,
            cloudSyncPatch,
            'syncedState' in synced && localUnchanged
          ))
        }
      } catch (error) {
        const networkish = isLikelyNetworkError(error)
        const errMsg = error instanceof Error ? error.message : 'Cloud sync failed'
        const latestRecord = getParkedGameRecord(record.localGameId, snapshotUserId)
        if (!latestRecord) return

        const latestState = latestRecord.gameState
        const canApplyRecovery =
          (error instanceof SoccerCloudRecoveryError ||
            error instanceof BasketballCloudRecoveryError) &&
          buildGameSyncFingerprint(latestState) === snapshotFingerprint &&
          eventConflictRecoveryFingerprint(latestState) === snapshotRecoveryFingerprint
        const recoveredState = canApplyRecovery ? error.recoveredState : latestState
        const attempts = latestRecord.sync.attempts + 1
        const retryMs = Math.min(30_000, 1000 * 2 ** Math.min(attempts, 5))
        const errorState: GameState = {
          ...recoveredState,
          cloudSync: {
            ...recoveredState.cloudSync,
            ...deletedSourcePlayerRecoverySettlementPatch(),
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
          const errorPatch: Partial<CloudSyncState> = {
            ...deletedSourcePlayerRecoverySettlementPatch(),
            status: networkish ? 'offline' : 'error',
            lastError: networkish ? null : errMsg,
          }
          dispatch(activeCloudSyncStateAction(errorState, errorPatch, canApplyRecovery))
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

  const recoverDeletedEventParticipantSources = useCallback(
    async (): Promise<FlushCloudSyncResult> => {
      const localGameId = getActiveLocalGameId(userId)
      const current = stateRef.current
      if (!localGameId || !getParkedGameRecord(localGameId, userId)) {
        return { ok: false, reason: 'This local game is unavailable.' }
      }
      if (!isEventCloudSyncEligible(current) || !current.cloudSync.teamId) {
        return { ok: false, reason: 'Historical player recovery requires a team event game.' }
      }

      const recoveryState: GameState = {
        ...current,
        cloudSync: {
          ...current.cloudSync,
          allowDeletedSourcePlayerRecovery: true,
          status: 'idle',
          lastError: null,
        },
      }
      try {
        saveActiveGameState(recoveryState, userId)
      } catch (error) {
        return { ok: false, reason: parkedGameStorageErrorMessage(error) }
      }
      stateRef.current = recoveryState
      dispatch({ type: 'HYDRATE_STATE', state: recoveryState })
      await runCloudSync()

      const result = getParkedGameRecord(localGameId, userId)?.gameState ?? stateRef.current
      if (result.cloudSync.status === 'error') {
        return { ok: false, reason: result.cloudSync.lastError ?? 'Cloud sync failed' }
      }
      if (result.cloudSync.status === 'offline') {
        return { ok: false, reason: 'Offline - reconnect before preserving player history.' }
      }
      return { ok: true }
    },
    [runCloudSync, userId]
  )

  const flushCloudGameSync = useCallback(async (
    gameId: string
  ): Promise<FlushCloudSyncResult> => {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    await runCloudSync()
    if (!isOnline) {
      return { ok: false, reason: 'Offline - connect to sync before continuing' }
    }
    const matching = listParkedGameRecords(userId).filter(
      record => record.gameState.cloudSync.gameId === gameId
    )
    const failed = matching.find(
      record => record.gameState.cloudSync.status === 'error'
    )
    if (failed) {
      return {
        ok: false,
        reason: failed.gameState.cloudSync.lastError ?? 'Cloud sync failed',
      }
    }
    const offline = matching.some(
      record => record.gameState.cloudSync.status === 'offline'
    )
    if (offline) {
      return { ok: false, reason: 'Offline - connect to sync before continuing' }
    }
    if (
      matching.some(record =>
        record.sync.dirty ||
        shouldBlockDiscardUnsyncedGame(record.gameState, record.sync.dirty)
      )
    ) {
      return {
        ok: false,
        reason: 'This game still has local changes that could not be synced.',
      }
    }
    return { ok: true }
  }, [isOnline, runCloudSync, userId])

  const enableBasketballCloudSync = useCallback(async (): Promise<FlushCloudSyncResult> => {
    if (!isConfigured || !supabase) {
      return { ok: false, reason: 'Basketball cloud sync requires Supabase configuration.' }
    }
    if (!userId) {
      return { ok: false, reason: 'Sign in before enabling Basketball cloud sync.' }
    }
    if (!isOnline) {
      return { ok: false, reason: 'Reconnect before enabling Basketball cloud sync.' }
    }

    const localGameId = getActiveLocalGameId(userId)
    const snapshot = stateRef.current
    const snapshotFingerprint = buildGameSyncFingerprint(snapshot)
    if (!localGameId || !getParkedGameRecord(localGameId, userId)) {
      return { ok: false, reason: 'This local Basketball game is unavailable.' }
    }

    const assertCurrent = () => {
      const currentRecord = getParkedGameRecord(localGameId, userId)
      if (
        getActiveLocalGameId(userId) !== localGameId ||
        !currentRecord ||
        buildGameSyncFingerprint(stateRef.current) !== snapshotFingerprint ||
        buildGameSyncFingerprint(currentRecord.gameState) !== snapshotFingerprint ||
        stateRef.current.cloudSync.eventCloudPolicy !== 'local_only' ||
        currentRecord.gameState.cloudSync.eventCloudPolicy !== 'local_only'
      ) {
        throw new Error('This game changed while cloud sync was being enabled. Try again.')
      }
    }
    const validateBinding = (gameId: string) => {
      assertCurrent()
      const duplicate = listParkedGameRecords(userId).find(record =>
        record.localGameId !== localGameId && record.gameState.cloudSync.gameId === gameId
      )
      if (duplicate) {
        throw new Error('Another local game already owns this cloud Basketball game.')
      }
    }

    let enabled: Awaited<ReturnType<typeof enableBasketballEventCloud>>
    let summaries: ParkedGameSummary[]
    try {
      enabled = await enableBasketballEventCloud({
        state: snapshot,
        userId,
        localGameId,
        assertCurrent,
        validateBinding,
      })
      assertCurrent()
      validateBinding(enabled.cloudGameId)
      summaries = saveParkedGameRecordStateAtomically(
        localGameId,
        enabled.state,
        userId,
        {
          dirty: false,
          attempts: 0,
          lastError: null,
          nextAttemptAt: null,
        }
      )
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error
          ? error.message
          : 'Basketball cloud sync could not be enabled.',
      }
    }

    stateRef.current = enabled.state
    dispatch({ type: 'HYDRATE_STATE', state: enabled.state })
    try {
      setResumeTarget(userId, enabled.cloudGameId)
    } catch {
      // The resume preference is optional; the confirmed local/cloud binding remains authoritative.
    }
    setParkedGames(summaries)
    setActiveLocalGameId(localGameId)
    pendingSyncRef.current = summaries.some(
      game => game.syncDirty && game.eventCloudPolicy !== 'local_only'
    )
    setPendingSyncFlag(pendingSyncRef.current)
    setParkingError(null)
    return { ok: true }
  }, [isConfigured, isOnline, userId])

  const markEventCloudGameReopened = useCallback(async (
    gameId: string,
    suppliedHandoff?: BasketballReopenHandoff | null
  ) => {
    try {
      const handoff = suppliedHandoff === undefined
        ? await loadBasketballReopenHandoff(gameId)
        : suppliedHandoff
      const matches = listParkedGameRecords(userId).filter(
        record => record.gameState.cloudSync.gameId === gameId
      )
      for (const record of matches) {
        const cloudStateChanged = record.gameState.cloudSync.gameStatus !== 'in_progress' ||
          record.gameState.cloudSync.status !== 'idle' ||
          record.gameState.cloudSync.lastError !== null
        const cloudReopenedState: GameState = cloudStateChanged
          ? {
              ...record.gameState,
              cloudSync: {
                ...record.gameState.cloudSync,
                gameStatus: 'in_progress',
                status: 'idle',
                lastError: null,
              },
            }
          : record.gameState
        const applied = handoff && userId
          ? applyBasketballReopenHandoff(cloudReopenedState, userId, gameId, handoff)
          : { ok: true as const, state: cloudReopenedState, changed: cloudStateChanged }
        if (!applied.ok) {
          setParkingError(applied.reason)
          return
        }
        if (!applied.changed) continue
        const dirty = Boolean(handoff && applied.changed)
        saveParkedGameRecordStateAtomically(record.localGameId, applied.state, userId, {
          dirty: dirty ? true : record.sync.dirty,
          nextAttemptAt: dirty ? null : record.sync.nextAttemptAt,
        })
        if (record.localGameId === activeLocalGameId) {
          stateRef.current = applied.state
          dispatch({ type: 'HYDRATE_STATE', state: applied.state })
        }
      }
      setParkedGames(listParkedGames(userId))
      setParkingError(null)
    } catch (error) {
      setParkingError(parkedGameStorageErrorMessage(error))
    }
  }, [activeLocalGameId, userId])

  const resolveEventConflict = useCallback(
    (eventId: string, resolution: 'local' | 'remote') => {
      const current = stateRef.current
      const sportId = current.sportGameState?.sportId
      const adapter = eventCloudTransportAdapterForSport(sportId)
      if (!adapter) {
        return { ok: false as const, reason: 'This game does not support event conflict recovery.' }
      }
      const resolved = resolveEventConflictInState(
        current,
        eventId,
        resolution,
        adapter,
        new Date().toISOString()
      )
      if (!resolved.ok) {
        return { ok: false as const, reason: resolved.reason }
      }
      stateRef.current = resolved.state
      dispatch({ type: 'HYDRATE_STATE', state: resolved.state })
      return { ok: true as const }
    },
    []
  )

  const syncFingerprint = buildGameSyncFingerprint(state)
  const queueFingerprint = parkedGames
    .map(
      game =>
        `${game.localGameId}:${game.updatedAt}:${game.syncStatus}:${game.syncDirty}:${game.eventCloudPolicy ?? ''}:${game.syncLastError ?? ''}`
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
        prepareActiveGameMutation,
        startNewGame,
        commitGameSetup,
        openGameSnapshot,
        parkCurrentGame,
        resumeParkedGame,
        discardParkedGame,
        flushCloudSync,
        flushCloudGameSync,
        recoverDeletedEventParticipantSources,
        enableBasketballCloudSync,
        markEventCloudGameReopened,
        resolveEventConflict,
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
