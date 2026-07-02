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
  ActionLogEntry,
  CloudSyncState,
  CloudSyncStatus,
  ShotRecord,
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
import { activePlayerIdAfterRosterChange } from '../lib/activePlayerIdForRoster'
import { sanitizePlayerIdMapForCloud } from '../lib/uuidValidation'
import { playerIdMapForRoster, shotChartForRoster } from '../lib/rosterAlignment'
import { sports } from '../config/sports'
import { getDisplayedHomeScore } from '../lib/gameScore'
import {
  buildGameSyncFingerprint,
  currentPeriodForCloudHydrate,
  shouldDeferCloudResumeHydration,
  shouldRejectSkippedFinalSync,
  withLastSyncedGameFingerprint,
} from '../lib/gameSyncFingerprint'

import {
  GAME_OWNER_KEY,
  GAME_STORAGE_KEY,
  PENDING_SYNC_KEY,
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

function createInitialCloudSyncState(status: CloudSyncStatus = 'idle'): CloudSyncState {
  return {
    seasonId: null,
    teamId: null,
    gameId: null,
    gameStatus: null,
    playerIdMap: {},
    status,
    lastSyncedAt: null,
    lastError: null,
    lastSyncedGameFingerprint: null,
    shotChartHydrationDroppedRows: 0,
  }
}

function createInitialState(status: CloudSyncStatus = 'idle'): GameState {
  return {
    sport: null,
    gameInfo: null,
    players: [],
    activePlayerId: null,
    opponentScore: 0,
    homeTeamScore: null,
    homeScoreAdjustment: 0,
    notes: '',
    actionLog: [],
    cloudSync: createInitialCloudSyncState(status),
    currentPeriod: 1,
    teamStatsConfig: null,
    shotChart: [],
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

/** Stat key to increment when adding a shot from the chart. */
function statIdForShotRecord(shot: ShotRecord): string {
  if (shot.shotType === '3pt') {
    return shot.made ? '3pt' : '3pt_miss'
  }
  return shot.made ? '2pt' : '2pt_miss'
}

/** Clear every chart shot and revert linked stats/log rows (works even when non-shot actions trail the log). */
function clearEntireShotChart(state: GameState): GameState {
  if (state.shotChart.length === 0) return state
  const shotIds = new Set(state.shotChart.map(s => s.id))
  const statDeltas = new Map<string, Record<string, number>>()
  for (const shot of state.shotChart) {
    const sid = statIdForShotRecord(shot)
    const prev = statDeltas.get(shot.playerId) ?? {}
    prev[sid] = (prev[sid] ?? 0) + 1
    statDeltas.set(shot.playerId, prev)
  }
  const players = state.players.map(p => {
    const deltas = statDeltas.get(p.id)
    if (!deltas) return p
    const nextStats = { ...p.stats }
    for (const [statId, n] of Object.entries(deltas)) {
      const v = (nextStats[statId] ?? 0) - n
      nextStats[statId] = Math.max(0, v)
    }
    return { ...p, stats: nextStats }
  })
  const actionLog = state.actionLog.filter(
    e => !(e.type === 'increment' && e.shotId && shotIds.has(e.shotId))
  )
  // User cleared the chart — local is authoritative; allow delete+replace on next sync.
  return {
    ...state,
    shotChart: [],
    players,
    actionLog,
    cloudSync: {
      ...state.cloudSync,
      shotChartHydrationDroppedRows: 0,
    },
  }
}

/** Revert the last `actionLog` entry (and linked shot when `shotId` is set). Returns null if log empty. */
function applyUndoLastEntry(state: GameState): GameState | null {
  if (state.actionLog.length === 0) return null
  const lastAction = state.actionLog[state.actionLog.length - 1]
  let newState: GameState = { ...state, actionLog: state.actionLog.slice(0, -1) }

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
      if (lastAction.type === 'increment' && lastAction.shotId) {
        newState = {
          ...newState,
          shotChart: newState.shotChart.filter(s => s.id !== lastAction.shotId),
        }
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
    case 'home_team_score_up':
    case 'home_team_score_down':
      if (lastAction.previousHomeTeamScore == null) {
        newState = {
          ...newState,
          homeTeamScore: null,
          homeScoreAdjustment: lastAction.previousHomeScoreAdjustment ?? 0,
        }
      } else {
        newState = { ...newState, homeTeamScore: lastAction.previousHomeTeamScore }
      }
      break
    default:
      return newState
  }
  return newState
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
                lastSyncedGameFingerprint: null,
                shotChartHydrationDroppedRows: 0,
              }
            : state.cloudSync,
      }

    case 'ADD_PLAYER':
      return { ...state, players: [...state.players, action.player] }

    case 'SET_PLAYERS': {
      const players = action.players
      const prevPlayers = state.players
      const nextIds = new Set(players.map(p => p.id))
      // Strip chart rows only when someone left the roster. Prepending team placeholders
      // (GameTracker / GameCheckout) adds ids without removing any — filtering there would
      // wipe every shot because markers still use real player ids.
      const removedAnyPlayer = prevPlayers.some(p => !nextIds.has(p.id))
      const shotChart =
        removedAnyPlayer || prevPlayers.length === 0 || players.length === 0
          ? shotChartForRoster(state.shotChart, players)
          : state.shotChart
      return {
        ...state,
        players,
        activePlayerId: activePlayerIdAfterRosterChange(state.activePlayerId, players),
        shotChart,
        cloudSync: {
          ...state.cloudSync,
          playerIdMap: playerIdMapForRoster(state.cloudSync.playerIdMap, players),
        },
      }
    }

    case 'HYDRATE_STATE': {
      const s = action.state
      const cs = s.cloudSync
      return {
        ...s,
        shotChart: shotChartForRoster(s.shotChart, s.players),
        cloudSync: {
          ...cs,
          playerIdMap: playerIdMapForRoster(cs.playerIdMap, s.players),
          shotChartHydrationDroppedRows:
            typeof cs.shotChartHydrationDroppedRows === 'number'
              ? Math.max(0, Math.floor(cs.shotChartHydrationDroppedRows))
              : 0,
        },
      }
    }

    case 'REMOVE_PLAYER': {
      // Keep local->remote player mapping aligned with the current roster.
      // Removed players are not automatically deleted in Supabase to preserve history.
      const players = state.players.filter(p => p.id !== action.playerId)
      return {
        ...state,
        players,
        activePlayerId: state.activePlayerId === action.playerId ? null : state.activePlayerId,
        shotChart: shotChartForRoster(state.shotChart, players),
        cloudSync: {
          ...state.cloudSync,
          playerIdMap: playerIdMapForRoster(state.cloudSync.playerIdMap, players),
        },
      }
    }

    case 'SET_ACTIVE_PLAYER':
      return { ...state, activePlayerId: action.playerId }

    case 'ADD_SHOT': {
      const shot = action.shot
      const player = state.players.find(p => p.id === shot.playerId)
      if (!player) return state
      const statId = statIdForShotRecord(shot)
      const prevValue = player.stats[statId] || 0
      const logEntry: ActionLogEntry = {
        id: generateId(),
        timestamp: Date.now(),
        type: 'increment',
        playerId: shot.playerId,
        statId,
        previousValue: prevValue,
        shotId: shot.id,
      }
      return {
        ...state,
        shotChart: [...state.shotChart, shot],
        players: state.players.map(p =>
          p.id === shot.playerId
            ? { ...p, stats: { ...p.stats, [statId]: prevValue + 1 } }
            : p
        ),
        actionLog: [...state.actionLog, logEntry],
      }
    }

    case 'REMOVE_LAST_SHOT': {
      if (state.shotChart.length === 0) return state
      const popped = state.shotChart[state.shotChart.length - 1]
      const last = state.actionLog[state.actionLog.length - 1]
      const logMatchesShot =
        last?.type === 'increment' &&
        last.shotId === popped.id &&
        last.playerId === popped.playerId &&
        last.statId === statIdForShotRecord(popped)
      if (logMatchesShot) {
        return applyUndoLastEntry(state) ?? state
      }
      return { ...state, shotChart: state.shotChart.slice(0, -1) }
    }

    case 'UNDO_LAST_SHOT': {
      const last = state.actionLog[state.actionLog.length - 1]
      if (!last?.shotId) return state
      return applyUndoLastEntry(state) ?? state
    }

    case 'CLEAR_SHOT_CHART': {
      return clearEntireShotChart(state)
    }

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
      if (state.homeTeamScore != null) {
        const prev = state.homeTeamScore
        const logEntry: ActionLogEntry = {
          id: generateId(),
          timestamp: Date.now(),
          type: 'home_team_score_up',
          previousValue: prev,
          previousHomeTeamScore: prev,
        }
        return {
          ...state,
          homeTeamScore: prev + 1,
          actionLog: [...state.actionLog, logEntry],
        }
      }
      const sport = state.sport
      if (!sport) return state
      const baseline = getDisplayedHomeScore(sport, state.players, null, state.homeScoreAdjustment)
      const logEntry: ActionLogEntry = {
        id: generateId(),
        timestamp: Date.now(),
        type: 'home_team_score_up',
        previousValue: baseline,
        previousHomeTeamScore: null,
        previousHomeScoreAdjustment: state.homeScoreAdjustment,
      }
      return {
        ...state,
        homeTeamScore: baseline + 1,
        homeScoreAdjustment: 0,
        actionLog: [...state.actionLog, logEntry],
      }
    }

    case 'SET_NOTES':
      return { ...state, notes: action.notes }

    case 'DECREMENT_HOME_SCORE': {
      if (state.homeTeamScore != null) {
        if (state.homeTeamScore <= 0) return state
        const prev = state.homeTeamScore
        const logEntry: ActionLogEntry = {
          id: generateId(),
          timestamp: Date.now(),
          type: 'home_team_score_down',
          previousValue: prev,
          previousHomeTeamScore: prev,
        }
        return {
          ...state,
          homeTeamScore: prev - 1,
          actionLog: [...state.actionLog, logEntry],
        }
      }
      const sport = state.sport
      if (!sport) return state
      const baseline = getDisplayedHomeScore(sport, state.players, null, state.homeScoreAdjustment)
      if (baseline <= 0) return state
      const logEntry: ActionLogEntry = {
        id: generateId(),
        timestamp: Date.now(),
        type: 'home_team_score_down',
        previousValue: baseline,
        previousHomeTeamScore: null,
        previousHomeScoreAdjustment: state.homeScoreAdjustment,
      }
      return {
        ...state,
        homeTeamScore: Math.max(0, baseline - 1),
        homeScoreAdjustment: 0,
        actionLog: [...state.actionLog, logEntry],
      }
    }

    case 'UNDO':
      return applyUndoLastEntry(state) ?? state

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

    case 'SET_PERIOD': {
      const next =
        Number.isFinite(action.period) && action.period >= 1 ? Math.floor(action.period) : 1
      return { ...state, currentPeriod: next }
    }

    case 'SET_TEAM_STATS_CONFIG':
      return { ...state, teamStatsConfig: action.config }

    default:
      return state
  }
}

function loadState(userId: string | null): GameState {
  try {
    if (userId) {
      const owner = localStorage.getItem(GAME_OWNER_KEY)
      if (owner && owner !== userId) {
        localStorage.removeItem(GAME_STORAGE_KEY)
        localStorage.removeItem(PENDING_SYNC_KEY)
        return createInitialState()
      }
    }

    const saved = localStorage.getItem(GAME_STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<GameState>
      // Don't restore a game that was already finalized (fixes existing stale "in progress" state).
      if (parsed.cloudSync?.gameStatus === 'final') {
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
    localStorage.setItem(GAME_STORAGE_KEY, JSON.stringify(state))
    if (userId) {
      localStorage.setItem(GAME_OWNER_KEY, userId)
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
      hydratedUserRef.current = null
      prevUserIdRef.current = userId
    }
  }, [isConfigured, isOnline, userId])

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
        const snapshotFingerprint = buildGameSyncFingerprint(snapshot)
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

        const isStale = snapshotFingerprint !== buildGameSyncFingerprint(stateRef.current)
        if (isStale) {
          queueAnotherSyncRef.current = true
          continue
        }

        // Cloud row is already `final` — syncGameSnapshotToCloud skips all writes. Do not mark
        // success or advance the fingerprint when local stats are still ahead of the last sync;
        // otherwise flushCloudSync (e.g. before finalize) returns ok while stats never upload.
        if (
          synced.skippedFinalGame &&
          shouldRejectSkippedFinalSync(snapshot, getPendingSyncFlag())
        ) {
          pendingSyncRef.current = true
          setPendingSyncFlag(true)
          dispatch({
            type: 'SET_CLOUD_SYNC_STATE',
            cloudSync: {
              status: 'error',
              lastError:
                'This game is already finalized in the cloud. Latest stats could not be saved.',
              gameStatus: 'final',
            },
          })
          break
        }

        dispatch({
          type: 'SET_CLOUD_SYNC_STATE',
          cloudSync: {
            seasonId: synced.seasonId,
            teamId: synced.teamId,
            gameId: synced.gameId,
            gameStatus: synced.skippedFinalGame ? 'final' : 'in_progress',
            playerIdMap: synced.playerIdMap,
            status: 'synced',
            lastSyncedAt: synced.syncedAt,
            lastError: null,
            shotChartHydrationDroppedRows:
              synced.shotChartCloudSync === 'synced' ? 0 : snapshot.cloudSync.shotChartHydrationDroppedRows,
            lastSyncedGameFingerprint: buildGameSyncFingerprint(snapshot),
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
      const errMsg = error instanceof Error ? error.message : 'Cloud sync failed'
      pendingSyncRef.current = true
      setPendingSyncFlag(true)
      dispatch({
        type: 'SET_CLOUD_SYNC_STATE',
        cloudSync: {
          status: 'error',
          lastError: errMsg,
        },
      })
      if (userId) {
        void logClientSyncError(userId, errMsg, stateRef.current)
      }
    } finally {
      syncInFlightRef.current = false
    }
  }, [isConfigured, isOnline, userId])

  const flushCloudSync = useCallback(async (): Promise<FlushCloudSyncResult> => {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    await runCloudSync()
    const s = stateRef.current
    if (s.cloudSync.status === 'error') {
      return { ok: false, reason: s.cloudSync.lastError ?? 'Cloud sync failed' }
    }
    if (!isOnline || s.cloudSync.status === 'offline') {
      return { ok: false, reason: 'Offline — connect to sync before continuing' }
    }
    if (getPendingSyncFlag() || shouldDeferCloudResumeHydration(s, getPendingSyncFlag())) {
      return { ok: false, reason: 'Latest changes could not be synced. Try again.' }
    }
    return { ok: true }
  }, [isOnline, runCloudSync])

  const syncFingerprint = buildGameSyncFingerprint(state)
  const shouldSync = canSyncState(state, isConfigured, userId, isOnline)

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
